import { jobsDb, type EnqueueJobInput, type JobRow } from "@ai-lead-gen/database";

/**
 * Job types and their payloads. Add a line here for every new job type so enqueueJob and
 * registerJobHandler stay type-checked.
 */
export interface JobPayloadMap {
  "campaign.send_step": { campaignId: string; recipientId: string; stepPosition: number };
  "workflow.delayed_action": { workflowId: string; runId: string; stepPosition: number };
  "workflow.schedule_tick": { workflowId: string; cron: string };
  "lead.rescore": { leadId: string };
  /** Enqueued by a DB trigger (not enqueueJob) for leads inserted by the lead-webhook edge function. */
  "lead.ingested": { leadId: string };
  "integration.health_check": { provider?: string };
  "maintenance.retention": Record<string, never>;
}

export type JobType = keyof JobPayloadMap;

export interface JobContext<T extends JobType = JobType> {
  job: JobRow;
  type: T;
  orgId: string | null;
  attempt: number;
  /** Aborted when the job times out or the server shuts down; long handlers should stop early. */
  signal: AbortSignal;
}

export type JobHandler<T extends JobType> = (payload: JobPayloadMap[T], ctx: JobContext<T>) => Promise<void> | void;

export interface JobHandlerOptions {
  /** Delay before retry n (1-based). Default: 30s * 2^(n-1), capped at 1h. */
  backoffMs?: (attempt: number) => number;
  /** The attempt fails (and may retry) after this long. Default: DEFAULT_TIMEOUTS_MS[type] or 5 minutes. */
  timeoutMs?: number;
}

/** Timeouts for job types whose handlers are registered without one. */
const DEFAULT_TIMEOUTS_MS: Partial<Record<string, number>> = {
  // Matches the discovery module's stale-run cutoff (30 min).
  "agent.run": 30 * 60 * 1000,
  "workflow.schedule_tick": 15 * 60 * 1000,
  "maintenance.retention": 15 * 60 * 1000,
};
const FALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export class PermanentJobError extends Error {
  readonly permanent = true;
}

interface Registered {
  handler: JobHandler<any>;
  options: JobHandlerOptions;
}

const registry = new Map<string, Registered>();

/** Register at module load (e.g. top level of your route or service file). One handler per type. */
export function registerJobHandler<T extends JobType>(type: T, handler: JobHandler<T>, options: JobHandlerOptions = {}) {
  if (registry.has(type)) throw new Error(`A job handler for "${type}" is already registered.`);
  registry.set(type, { handler, options });
}

export function getJobHandler(type: string): Registered | undefined {
  return registry.get(type);
}

export function registeredJobTypes(): string[] {
  return [...registry.keys()];
}

/** Queues a job; returns null when an active job with the same dedupeKey exists. */
export function enqueueJob<T extends JobType>(
  type: T,
  payload: JobPayloadMap[T],
  options: Omit<EnqueueJobInput, "type" | "payload"> = {}
): Promise<JobRow | null> {
  return jobsDb.enqueue({ ...options, type, payload });
}

export function jobTimeoutMs(type: string): number {
  return registry.get(type)?.options.timeoutMs ?? DEFAULT_TIMEOUTS_MS[type] ?? FALLBACK_TIMEOUT_MS;
}

export function defaultBackoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}
