import os from "os";
import { isDbConfigured, jobsDb, type JobRow } from "@ai-lead-gen/database";
import { logger } from "../logger";
import { defaultBackoffMs, getJobHandler, jobTimeoutMs, registeredJobTypes, type JobType } from "./registry";

export { enqueueJob, registerJobHandler, PermanentJobError } from "./registry";
export type { JobPayloadMap, JobType, JobHandler, JobContext } from "./registry";

const POLL_INTERVAL_MS = 5_000;
const MAX_CONCURRENCY = Math.max(1, Number(process.env.JOB_CONCURRENCY) || 10);
/** A running job whose lock is older than this is considered crashed and re-claimed. */
const LOCK_TIMEOUT_SECONDS = 300;
/** Well under the lock timeout, so a live job's lock never expires. */
const HEARTBEAT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 25_000;

const log = logger.child({ module: "jobs" });
const workerId = `${os.hostname()}-${process.pid}`;

interface InFlight {
  job: JobRow;
  controller: AbortController;
  done: Promise<void>;
}

const inFlight = new Map<string, InFlight>();
let timer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let polling = false;
let stopped = false;
let backlog = false;

class JobTimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new JobTimeoutError(`Timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timeout));
}

async function runJob(job: JobRow, controller: AbortController): Promise<void> {
  const lock = { worker: workerId, attempt: job.attempts };
  const registered = getJobHandler(job.type);
  if (!registered) {
    await jobsDb.fail(job.id, `No handler registered for job type "${job.type}"`, null, lock);
    return;
  }
  const startedAt = Date.now();
  try {
    const work = Promise.resolve(
      registered.handler(job.payload, {
        job,
        type: job.type as JobType,
        orgId: job.org_id,
        attempt: job.attempts,
        signal: controller.signal,
      })
    );
    await withTimeout(work, jobTimeoutMs(job.type), controller);
    if (!(await jobsDb.complete(job.id, lock))) {
      log.warn("Job finished after losing its lock", { jobId: job.id, type: job.type });
    }
  } catch (err: any) {
    if (stopped && controller.signal.aborted && !(err instanceof JobTimeoutError)) return; // released on shutdown
    const message = String(err?.message || err).slice(0, 2000);
    const exhausted = err?.permanent === true || job.attempts >= job.max_attempts;
    const backoff = registered.options.backoffMs ?? defaultBackoffMs;
    const retryAt = exhausted ? null : new Date(Date.now() + backoff(job.attempts));
    log.warn("Job attempt failed", {
      jobId: job.id,
      type: job.type,
      orgId: job.org_id,
      attempt: job.attempts,
      maxAttempts: job.max_attempts,
      durationMs: Date.now() - startedAt,
      retryAt: retryAt?.toISOString() ?? null,
      error: message,
    });
    await jobsDb.fail(job.id, message, retryAt, lock);
  }
}

/** Starts a claimed job without waiting for it; its slot frees up when it settles. */
function start(job: JobRow): InFlight {
  const controller = new AbortController();
  const entry: InFlight = {
    job,
    controller,
    done: runJob(job, controller)
      .catch((err) => log.error("Job crashed", { jobId: job.id, type: job.type, err }))
      .finally(() => {
        inFlight.delete(job.id);
        // A full claim suggests more jobs are due: refill the slot now instead of on the next tick.
        if (timer && backlog && slotsFree() > 0) void poll();
      }),
  };
  inFlight.set(job.id, entry);
  return entry;
}

function slotsFree(): number {
  return MAX_CONCURRENCY - inFlight.size;
}

/** Claims as many due jobs as there are free slots and starts them; returns the started jobs. */
async function poll(): Promise<InFlight[]> {
  if (polling || stopped) return [];
  const free = slotsFree();
  if (free <= 0) return [];
  polling = true;
  try {
    const types = registeredJobTypes();
    if (types.length === 0) return [];
    const jobs = await jobsDb.claim(workerId, free, LOCK_TIMEOUT_SECONDS, types);
    backlog = jobs.length === free;
    return jobs.map(start);
  } catch (err: any) {
    log.error("Poll failed", { err });
    return [];
  } finally {
    polling = false;
  }
}

async function heartbeat(): Promise<void> {
  try {
    await jobsDb.heartbeat(workerId, [...inFlight.keys()]);
  } catch (err: any) {
    log.error("Extending job locks failed", { err });
  }
}

/**
 * Polls claim_jobs() every 5s and runs up to JOB_CONCURRENCY (default 10) jobs at once, each
 * independently. Only job types with a registered handler are claimed, so register handlers
 * before calling this.
 */
export function startJobRunner(): void {
  if (timer || !isDbConfigured) return;
  stopped = false;
  timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_MS);
  void poll();
  log.info("Runner started", { workerId, concurrency: MAX_CONCURRENCY, handlers: registeredJobTypes() });
}

/**
 * Stops claiming, waits up to `graceMs` for running jobs, then aborts the rest and puts them
 * back in the queue so another worker can pick them up right away.
 */
export async function stopJobRunner(graceMs = SHUTDOWN_GRACE_MS): Promise<void> {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
  if (inFlight.size === 0) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    return;
  }

  log.info("Waiting for running jobs", { count: inFlight.size });
  let graceTimer: NodeJS.Timeout | undefined;
  const allDone = Promise.all([...inFlight.values()].map((e) => e.done)).then(() => true);
  const timedOut = new Promise<false>((resolve) => {
    graceTimer = setTimeout(() => resolve(false), graceMs);
  });
  const finished = await Promise.race([allDone, timedOut]);
  clearTimeout(graceTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (finished) return;

  const remaining = [...inFlight.values()];
  for (const entry of remaining) entry.controller.abort();
  try {
    await jobsDb.release(
      workerId,
      remaining.map((e) => ({ id: e.job.id, attempts: e.job.attempts }))
    );
    log.warn("Released unfinished jobs", { jobIds: remaining.map((e) => e.job.id) });
  } catch (err: any) {
    log.error("Releasing unfinished jobs failed", { err });
  }
}

/** Runs one poll immediately and waits for the jobs it claimed (tests). */
export async function runJobsOnce(): Promise<void> {
  const started = await poll();
  await Promise.all(started.map((e) => e.done));
}
