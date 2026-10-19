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
}

export type JobType = keyof JobPayloadMap;

export interface JobContext<T extends JobType = JobType> {
  job: JobRow;
  type: T;
  orgId: string | null;
  attempt: number;
}

export type JobHandler<T extends JobType> = (payload: JobPayloadMap[T], ctx: JobContext<T>) => Promise<void> | void;

export interface JobHandlerOptions {
  /** Delay before retry n (1-based). Default: 30s * 2^(n-1), capped at 1h. */
  backoffMs?: (attempt: number) => number;
}

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

export function defaultBackoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}
