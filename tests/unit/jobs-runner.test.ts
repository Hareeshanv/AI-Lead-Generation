import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobsDb = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  heartbeat: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@ai-lead-gen/database", () => ({ isDbConfigured: true, jobsDb }));
vi.mock("../../apps/api/src/logger", () => {
  const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => log };
  return { logger: log };
});

type Runner = typeof import("../../apps/api/src/jobs/runner") & typeof import("../../apps/api/src/jobs/registry");

/** Fresh runner + registry (both keep module-level state) with the given JOB_CONCURRENCY. */
async function loadRunner(concurrency = 10): Promise<Runner> {
  vi.resetModules();
  vi.stubEnv("JOB_CONCURRENCY", String(concurrency));
  const registry = await import("../../apps/api/src/jobs/registry");
  const runner = await import("../../apps/api/src/jobs/runner");
  return { ...registry, ...runner };
}

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "lead.rescore",
    payload: { leadId: `lead-${id}` },
    org_id: "org-1",
    attempts: 1,
    max_attempts: 3,
    ...overrides,
  } as any;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

let runner: Runner | null = null;

beforeEach(() => {
  for (const fn of Object.values(jobsDb)) fn.mockReset();
  jobsDb.claim.mockResolvedValue([]);
  jobsDb.complete.mockResolvedValue(true);
  jobsDb.fail.mockResolvedValue(true);
  jobsDb.heartbeat.mockResolvedValue(undefined);
  jobsDb.release.mockResolvedValue(undefined);
});

afterEach(async () => {
  await runner?.stopJobRunner(0);
  runner = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("job runner", () => {
  it("claims only registered job types, up to the free slots", async () => {
    runner = await loadRunner(4);
    runner.registerJobHandler("lead.rescore", async () => {});
    await runner.runJobsOnce();
    expect(jobsDb.claim).toHaveBeenCalledWith(expect.any(String), 4, 300, ["lead.rescore"]);
  });

  it("does not claim anything when no handler is registered", async () => {
    runner = await loadRunner();
    await runner.runJobsOnce();
    expect(jobsDb.claim).not.toHaveBeenCalled();
  });

  it("runs jobs independently: a slow job does not hold back the others, and a freed slot is refilled", async () => {
    runner = await loadRunner(2);
    const gates = { slow: deferred(), fast: deferred() };
    runner.registerJobHandler("lead.rescore", async (payload) => {
      await gates[payload.leadId === "lead-slow" ? "slow" : "fast"].promise;
    });
    jobsDb.claim.mockResolvedValueOnce([job("slow"), job("fast")]).mockResolvedValue([]);

    runner.startJobRunner();
    await vi.waitFor(() => expect(jobsDb.claim).toHaveBeenCalledTimes(1));

    gates.fast.resolve();
    await vi.waitFor(() => expect(jobsDb.complete).toHaveBeenCalledWith("fast", expect.objectContaining({ attempt: 1 })));
    expect(jobsDb.complete).not.toHaveBeenCalledWith("slow", expect.anything());

    // The first claim filled every slot, so finishing a job polls again right away for the one free slot.
    await vi.waitFor(() => expect(jobsDb.claim).toHaveBeenCalledTimes(2));
    expect(jobsDb.claim.mock.calls[1][1]).toBe(1);

    gates.slow.resolve();
    await vi.waitFor(() => expect(jobsDb.complete).toHaveBeenCalledWith("slow", expect.anything()));
  });

  it("schedules a retry with the default backoff when a job fails", async () => {
    runner = await loadRunner();
    runner.registerJobHandler("lead.rescore", async () => {
      throw new Error("provider unavailable");
    });
    jobsDb.claim.mockResolvedValueOnce([job("j1", { attempts: 2 })]);

    const before = Date.now();
    await runner.runJobsOnce();

    expect(jobsDb.complete).not.toHaveBeenCalled();
    const [id, message, retryAt, lock] = jobsDb.fail.mock.calls[0];
    expect(id).toBe("j1");
    expect(message).toBe("provider unavailable");
    expect(lock).toEqual(expect.objectContaining({ attempt: 2 }));
    // Attempt 2: 30s * 2^(2-1) = 60s.
    expect((retryAt as Date).getTime() - before).toBeGreaterThanOrEqual(60_000);
    expect((retryAt as Date).getTime() - before).toBeLessThan(61_000);
  });

  it("uses a handler's own backoff", async () => {
    runner = await loadRunner();
    runner.registerJobHandler(
      "lead.rescore",
      async () => {
        throw new Error("nope");
      },
      { backoffMs: () => 5_000 }
    );
    jobsDb.claim.mockResolvedValueOnce([job("j1")]);
    const before = Date.now();
    await runner.runJobsOnce();
    const retryAt = jobsDb.fail.mock.calls[0][2] as Date;
    expect(retryAt.getTime() - before).toBeGreaterThanOrEqual(5_000);
    expect(retryAt.getTime() - before).toBeLessThan(6_000);
  });

  it("does not retry permanent errors or exhausted jobs", async () => {
    runner = await loadRunner();
    runner.registerJobHandler("lead.rescore", async (payload) => {
      if (payload.leadId === "lead-permanent") throw new runner!.PermanentJobError("lead was deleted");
      throw new Error("still failing");
    });
    jobsDb.claim.mockResolvedValueOnce([job("permanent"), job("last", { attempts: 3, max_attempts: 3 })]);
    await runner.runJobsOnce();

    expect(jobsDb.fail).toHaveBeenCalledWith("permanent", "lead was deleted", null, expect.anything());
    expect(jobsDb.fail).toHaveBeenCalledWith("last", "still failing", null, expect.anything());
  });

  it("fails a job whose type has no handler", async () => {
    runner = await loadRunner();
    runner.registerJobHandler("lead.rescore", async () => {});
    jobsDb.claim.mockResolvedValueOnce([job("j1", { type: "campaign.send_step" })]);
    await runner.runJobsOnce();
    expect(jobsDb.fail).toHaveBeenCalledWith("j1", expect.stringContaining("No handler registered"), null, expect.anything());
  });

  it("times out a hung job, aborts its signal and schedules a retry", async () => {
    runner = await loadRunner();
    let signal: AbortSignal | undefined;
    runner.registerJobHandler(
      "lead.rescore",
      (_payload, ctx) => {
        signal = ctx.signal;
        return new Promise<void>(() => {});
      },
      { timeoutMs: 20 }
    );
    jobsDb.claim.mockResolvedValueOnce([job("hung")]);
    await runner.runJobsOnce();

    expect(signal?.aborted).toBe(true);
    expect(jobsDb.fail).toHaveBeenCalledWith("hung", expect.stringMatching(/^Timed out after/), expect.any(Date), expect.anything());
    expect(jobsDb.complete).not.toHaveBeenCalled();
  });

  it("uses the per-type default timeout when a handler sets none", async () => {
    runner = await loadRunner();
    expect(runner.jobTimeoutMs("workflow.schedule_tick")).toBe(15 * 60 * 1000);
    expect(runner.jobTimeoutMs("lead.rescore")).toBe(5 * 60 * 1000);
    runner.registerJobHandler("lead.rescore", async () => {}, { timeoutMs: 1234 });
    expect(runner.jobTimeoutMs("lead.rescore")).toBe(1234);
  });

  it("caps the default backoff at one hour", async () => {
    runner = await loadRunner();
    expect(runner.defaultBackoffMs(1)).toBe(30_000);
    expect(runner.defaultBackoffMs(3)).toBe(120_000);
    expect(runner.defaultBackoffMs(20)).toBe(60 * 60 * 1000);
  });

  it("extends the locks of running jobs every minute", async () => {
    vi.useFakeTimers();
    runner = await loadRunner();
    const gate = deferred();
    runner.registerJobHandler("lead.rescore", () => gate.promise);
    jobsDb.claim.mockResolvedValueOnce([job("long")]).mockResolvedValue([]);

    runner.startJobRunner();
    await vi.advanceTimersByTimeAsync(0);
    expect(jobsDb.heartbeat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(jobsDb.heartbeat).toHaveBeenCalledWith(expect.any(String), ["long"]);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(jobsDb.heartbeat).toHaveBeenLastCalledWith(expect.any(String), []);
  });

  it("waits for running jobs on shutdown and stops claiming", async () => {
    runner = await loadRunner();
    const gate = deferred();
    runner.registerJobHandler("lead.rescore", () => gate.promise);
    jobsDb.claim.mockResolvedValueOnce([job("j1")]).mockResolvedValue([]);

    runner.startJobRunner();
    await vi.waitFor(() => expect(jobsDb.claim).toHaveBeenCalledTimes(1));

    const stopped = runner.stopJobRunner(5_000);
    setTimeout(() => gate.resolve(), 20);
    await stopped;

    expect(jobsDb.complete).toHaveBeenCalledWith("j1", expect.anything());
    expect(jobsDb.release).not.toHaveBeenCalled();
    await runner.runJobsOnce();
    expect(jobsDb.claim).toHaveBeenCalledTimes(1);
  });

  it("requeues jobs still running when the shutdown grace period ends, without counting a failure", async () => {
    runner = await loadRunner();
    let signal: AbortSignal | undefined;
    runner.registerJobHandler("lead.rescore", (_payload, ctx) => {
      signal = ctx.signal;
      return new Promise<void>((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    jobsDb.claim.mockResolvedValueOnce([job("j1", { attempts: 2 })]).mockResolvedValue([]);

    runner.startJobRunner();
    await vi.waitFor(() => expect(jobsDb.claim).toHaveBeenCalledTimes(1));
    await runner.stopJobRunner(20);

    expect(signal?.aborted).toBe(true);
    expect(jobsDb.release).toHaveBeenCalledWith(expect.any(String), [{ id: "j1", attempts: 2 }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(jobsDb.fail).not.toHaveBeenCalled();
    expect(jobsDb.complete).not.toHaveBeenCalled();
  });
});
