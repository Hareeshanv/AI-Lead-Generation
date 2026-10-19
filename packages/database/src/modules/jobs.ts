import { dbClient } from "../client";
import { dbError, UNIQUE_VIOLATION } from "../helpers";

export interface JobRow {
  id: string;
  org_id: string | null;
  type: string;
  payload: Record<string, any>;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  run_at: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  dedupe_key: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueJobInput {
  type: string;
  orgId?: string | null;
  payload?: Record<string, any>;
  runAt?: Date | string;
  maxAttempts?: number;
  /** While a job with this key is queued or running, enqueueing another one is a no-op. */
  dedupeKey?: string;
}

export const jobsDb = {
  /** Returns null when an active job with the same dedupeKey already exists. */
  async enqueue(input: EnqueueJobInput): Promise<JobRow | null> {
    const { data, error } = await dbClient
      .from("jobs")
      .insert({
        type: input.type,
        org_id: input.orgId ?? null,
        payload: input.payload ?? {},
        run_at: input.runAt ? new Date(input.runAt).toISOString() : new Date().toISOString(),
        max_attempts: input.maxAttempts ?? 5,
        dedupe_key: input.dedupeKey ?? null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION && input.dedupeKey) return null;
      throw dbError("enqueue job", error);
    }
    return data as JobRow;
  },

  async claim(worker: string, limit: number, lockTimeoutSeconds: number, types: string[] | null): Promise<JobRow[]> {
    const { data, error } = await dbClient.rpc("claim_jobs", {
      p_worker: worker,
      p_limit: limit,
      p_lock_timeout_seconds: lockTimeoutSeconds,
      p_types: types,
    });
    if (error) throw dbError("claim jobs", error);
    return (data || []) as JobRow[];
  },

  async complete(jobId: string): Promise<void> {
    const { error } = await dbClient
      .from("jobs")
      .update({ status: "succeeded", completed_at: new Date().toISOString(), locked_at: null, last_error: null })
      .eq("id", jobId);
    if (error) throw dbError("complete job", error);
  },

  /** Requeues at retryAt, or marks the job failed when retryAt is null. */
  async fail(jobId: string, message: string, retryAt: Date | null): Promise<void> {
    const patch = retryAt
      ? { status: "queued", run_at: retryAt.toISOString(), locked_at: null, locked_by: null, last_error: message }
      : { status: "failed", completed_at: new Date().toISOString(), locked_at: null, last_error: message };
    const { error } = await dbClient.from("jobs").update(patch).eq("id", jobId);
    if (error) throw dbError("fail job", error);
  },

  async cancel(filter: { orgId: string; type?: string; dedupeKeyPrefix?: string }): Promise<number> {
    let query = dbClient.from("jobs").update({ status: "cancelled" }).eq("org_id", filter.orgId).eq("status", "queued");
    if (filter.type) query = query.eq("type", filter.type);
    if (filter.dedupeKeyPrefix) query = query.like("dedupe_key", `${filter.dedupeKeyPrefix}%`);
    const { data, error } = await query.select("id");
    if (error) throw dbError("cancel jobs", error);
    return (data || []).length;
  },
};
