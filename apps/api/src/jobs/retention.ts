import { auditDb, jobsDb } from "@ai-lead-gen/database";
import { logger } from "../logger";
import { enqueueJob, registerJobHandler } from "./registry";

const log = logger.child({ module: "retention" });
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 1000;
/** Caps one run at 100k rows per table; the next daily run continues. */
const MAX_BATCHES = 100;

/** Days to keep; 0 (or a negative value) disables that cleanup. */
function retentionDays(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

async function purge(purgeBatch: (before: Date) => Promise<number>, before: Date, signal: AbortSignal): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES && !signal.aborted; i++) {
    const deleted = await purgeBatch(before);
    total += deleted;
    if (deleted < BATCH) break;
  }
  return total;
}

registerJobHandler("maintenance.retention", async (_payload, { signal }) => {
  const jobDays = retentionDays("JOB_RETENTION_DAYS", 14);
  const auditDays = retentionDays("AUDIT_LOG_RETENTION_DAYS", 365);
  const result: Record<string, number> = {};
  if (jobDays > 0) {
    result.jobs = await purge((before) => jobsDb.purgeFinished(before, BATCH), new Date(Date.now() - jobDays * DAY_MS), signal);
  }
  if (auditDays > 0) {
    result.auditLog = await purge((before) => auditDb.purgeBefore(before, BATCH), new Date(Date.now() - auditDays * DAY_MS), signal);
  }
  log.info("Retention cleanup finished", { jobDays, auditDays, deleted: result });
});

let retentionTimer: NodeJS.Timeout | null = null;

/** Enqueues the retention job shortly after start and then daily (one queued run at a time). */
export function scheduleRetention(): void {
  if (retentionTimer) return;
  const enqueue = () =>
    enqueueJob("maintenance.retention", {}, { dedupeKey: "maintenance.retention", maxAttempts: 2 }).catch((err) =>
      log.error("Could not schedule retention cleanup", { err })
    );
  setTimeout(() => void enqueue(), 60_000).unref();
  retentionTimer = setInterval(() => void enqueue(), DAY_MS);
  retentionTimer.unref();
}
