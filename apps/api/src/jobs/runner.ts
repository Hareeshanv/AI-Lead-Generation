import os from "os";
import { isDbConfigured, jobsDb, type JobRow } from "@ai-lead-gen/database";
import { defaultBackoffMs, getJobHandler, registeredJobTypes, type JobType } from "./registry";

export { enqueueJob, registerJobHandler, PermanentJobError } from "./registry";
export type { JobPayloadMap, JobType, JobHandler, JobContext } from "./registry";

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;
const LOCK_TIMEOUT_SECONDS = 300;

const workerId = `${os.hostname()}-${process.pid}`;
let timer: NodeJS.Timeout | null = null;
let polling = false;
let stopped = false;

async function runJob(job: JobRow): Promise<void> {
  const registered = getJobHandler(job.type);
  if (!registered) {
    await jobsDb.fail(job.id, `No handler registered for job type "${job.type}"`, null);
    return;
  }
  try {
    await registered.handler(job.payload, {
      job,
      type: job.type as JobType,
      orgId: job.org_id,
      attempt: job.attempts,
    });
    await jobsDb.complete(job.id);
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 2000);
    const exhausted = err?.permanent === true || job.attempts >= job.max_attempts;
    const backoff = registered.options.backoffMs ?? defaultBackoffMs;
    const retryAt = exhausted ? null : new Date(Date.now() + backoff(job.attempts));
    console.warn(
      `[Jobs] ${job.type} ${job.id} attempt ${job.attempts}/${job.max_attempts} failed: ${message}` +
        (retryAt ? ` (retry at ${retryAt.toISOString()})` : " (giving up)")
    );
    await jobsDb.fail(job.id, message, retryAt);
  }
}

async function poll(): Promise<void> {
  if (polling || stopped) return;
  polling = true;
  try {
    const types = registeredJobTypes();
    if (types.length === 0) return;
    const jobs = await jobsDb.claim(workerId, BATCH_SIZE, LOCK_TIMEOUT_SECONDS, types);
    await Promise.all(jobs.map((job) => runJob(job).catch((err) => console.error(`[Jobs] ${job.id} crashed:`, err))));
  } catch (err: any) {
    console.error(`[Jobs] Poll failed: ${err?.message || err}`);
  } finally {
    polling = false;
  }
}

/**
 * Polls claim_jobs() every 5s and runs registered handlers. Only job types with a registered
 * handler are claimed, so register handlers before calling this.
 */
export function startJobRunner(): void {
  if (timer || !isDbConfigured) return;
  stopped = false;
  timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  void poll();
  console.log(`[Jobs] Runner started (${workerId}); handlers: ${registeredJobTypes().join(", ") || "none"}`);
}

export function stopJobRunner(): void {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}

/** Runs one poll immediately (tests). */
export function runJobsOnce(): Promise<void> {
  return poll();
}
