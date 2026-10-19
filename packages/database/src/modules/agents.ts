import { dbClient } from "../client";
import { dbError, UNIQUE_VIOLATION, type PageResult, type PageSpec } from "../helpers";

export type PipelineRunStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed";

export interface PipelineRunRow {
  id: string;
  org_id: string;
  campaign_name: string;
  query: string;
  /** Comma-separated discovery sources, e.g. "web,places". */
  category: string | null;
  location: string | null;
  target_count: number | null;
  status: PipelineRunStatus | string;
  total_leads_found: number | null;
  high_score_leads: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AgentExecutionRow {
  id: string;
  org_id: string | null;
  pipeline_run_id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  input: Record<string, any> | null;
  output: Record<string, any> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  tokens_used: number | null;
  created_at: string;
}

export interface AgentLogRow {
  id: string;
  agent_id: string;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
}

export interface ExistingLeadContact {
  id: string;
  email: string | null;
  phone: string | null;
  profile_url: string | null;
}

export interface InsertAgentLeadsResult {
  inserted: any[];
  /** Rows skipped because a unique index (org + email) already had them. */
  conflicts: number;
}

const RUN_COLUMNS =
  "id, org_id, campaign_name, query, category, location, target_count, status, total_leads_found, high_score_leads, duration_ms, started_at, completed_at, created_at";

const RUN_STAT_COLUMNS = "id, status, duration_ms, total_leads_found, high_score_leads, created_at";

/** Owned by the AI Agents module: pipeline runs, executions, logs and agent-sourced leads/signals. */
export const agentsDb = {
  async createRun(
    orgId: string,
    input: Pick<PipelineRunRow, "campaign_name" | "query" | "category" | "location" | "target_count"> & { status?: string }
  ): Promise<PipelineRunRow> {
    const { data, error } = await dbClient
      .from("pipeline_runs")
      .insert({ ...input, status: input.status ?? "queued", org_id: orgId })
      .select(RUN_COLUMNS)
      .single();
    if (error) throw dbError("create pipeline run", error);
    return data as PipelineRunRow;
  },

  /** Moves a queued run to running; null when it was already claimed (or does not exist). */
  async claimRun(orgId: string, runId: string): Promise<PipelineRunRow | null> {
    const { data, error } = await dbClient
      .from("pipeline_runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", runId)
      .eq("status", "queued")
      .select(RUN_COLUMNS);
    if (error) throw dbError("claim pipeline run", error);
    return (data?.[0] as PipelineRunRow) ?? null;
  },

  async updateRun(orgId: string, runId: string, patch: Partial<PipelineRunRow>): Promise<PipelineRunRow | null> {
    const { data, error } = await dbClient
      .from("pipeline_runs")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", runId)
      .select(RUN_COLUMNS);
    if (error) throw dbError("update pipeline run", error);
    return (data?.[0] as PipelineRunRow) ?? null;
  },

  async getRun(orgId: string, runId: string): Promise<PipelineRunRow | null> {
    const { data, error } = await dbClient
      .from("pipeline_runs")
      .select(RUN_COLUMNS)
      .eq("org_id", orgId)
      .eq("id", runId)
      .maybeSingle();
    if (error) throw dbError("get pipeline run", error);
    return (data as PipelineRunRow) ?? null;
  },

  async listRuns(orgId: string, page: PageSpec, filter: { status?: string } = {}): Promise<PageResult<PipelineRunRow>> {
    let query = dbClient.from("pipeline_runs").select(RUN_COLUMNS, { count: "exact" }).eq("org_id", orgId);
    if (filter.status) query = query.eq("status", filter.status);
    const sort = page.sort ?? { column: "created_at", ascending: false };
    const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).range(page.from, page.to);
    if (error) throw dbError("list pipeline runs", error);
    return { rows: (data || []) as PipelineRunRow[], total: count ?? 0 };
  },

  /** Lightweight run rows for stats, newest first. */
  async listRunStats(orgId: string, options: { since?: string; limit?: number } = {}): Promise<PipelineRunRow[]> {
    let query = dbClient.from("pipeline_runs").select(RUN_STAT_COLUMNS).eq("org_id", orgId);
    if (options.since) query = query.gte("created_at", options.since);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(options.limit ?? 2000);
    if (error) throw dbError("list pipeline run stats", error);
    return (data || []) as unknown as PipelineRunRow[];
  },

  async countActiveRuns(orgId: string): Promise<number> {
    const { count, error } = await dbClient
      .from("pipeline_runs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .in("status", ["queued", "running"]);
    if (error) throw dbError("count active runs", error);
    return count ?? 0;
  },

  /** Runs stuck in queued/running since before `olderThan` (crashed worker) are marked failed. */
  async failStaleRuns(orgId: string, olderThan: string, message: string): Promise<string[]> {
    const { data, error } = await dbClient
      .from("pipeline_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .in("status", ["queued", "running"])
      .lt("created_at", olderThan)
      .select("id");
    if (error) throw dbError("fail stale runs", error);
    const ids = (data || []).map((r: { id: string }) => r.id);
    if (ids.length > 0) {
      await dbClient.from("agent_executions").insert(
        ids.map((id) => ({
          org_id: orgId,
          pipeline_run_id: id,
          agent_id: "run",
          agent_name: "Run",
          status: "failed",
          error: message,
          completed_at: new Date().toISOString(),
        }))
      );
    }
    return ids;
  },

  async logExecution(
    orgId: string,
    row: Omit<AgentExecutionRow, "id" | "org_id" | "created_at" | "started_at" | "completed_at"> & {
      started_at?: string | null;
      completed_at?: string | null;
    }
  ): Promise<AgentExecutionRow> {
    const { data, error } = await dbClient
      .from("agent_executions")
      .insert({ ...row, org_id: orgId })
      .select()
      .single();
    if (error) throw dbError("log agent execution", error);
    return data as AgentExecutionRow;
  },

  async listExecutions(orgId: string, runId: string): Promise<AgentExecutionRow[]> {
    const { data, error } = await dbClient
      .from("agent_executions")
      .select("*")
      .eq("org_id", orgId)
      .eq("pipeline_run_id", runId)
      .order("created_at", { ascending: true });
    if (error) throw dbError("list agent executions", error);
    return (data || []) as AgentExecutionRow[];
  },

  /** Executions of one step (agent_id) for many runs, e.g. the save step that holds per-run totals. */
  async listStepExecutions(orgId: string, stepId: string, runIds: string[]): Promise<AgentExecutionRow[]> {
    if (runIds.length === 0) return [];
    const rows: AgentExecutionRow[] = [];
    for (let i = 0; i < runIds.length; i += 200) {
      const { data, error } = await dbClient
        .from("agent_executions")
        .select("pipeline_run_id, output, status")
        .eq("org_id", orgId)
        .eq("agent_id", stepId)
        .in("pipeline_run_id", runIds.slice(i, i + 200));
      if (error) throw dbError("list step executions", error);
      rows.push(...((data || []) as AgentExecutionRow[]));
    }
    return rows;
  },

  /** Telemetry must never break a run: failures are logged, not thrown. */
  async log(orgId: string, agentId: string, level: "info" | "warn" | "error", message: string): Promise<void> {
    try {
      const { error } = await dbClient
        .from("agent_logs")
        .insert({ org_id: orgId, agent_id: agentId, level, message: message.slice(0, 4000) });
      if (error) console.warn(`[DB] Agent log insert failed: ${error.message}`);
    } catch (err: any) {
      console.warn(`[DB] Agent log insert failed: ${err?.message}`);
    }
  },

  /** runId keeps only lines written for that run (messages are prefixed with "[runId]"). */
  async listLogs(
    orgId: string,
    agentId: string,
    options: { limit?: number; before?: string; runId?: string } = {}
  ): Promise<AgentLogRow[]> {
    let query = dbClient
      .from("agent_logs")
      .select("id, agent_id, level, message, created_at")
      .eq("org_id", orgId)
      .eq("agent_id", agentId);
    if (options.before) query = query.lt("created_at", options.before);
    if (options.runId) query = query.like("message", `[${options.runId.replace(/[%_\\]/g, "\\$&")}]%`);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(options.limit ?? 100);
    if (error) throw dbError("list agent logs", error);
    return (data || []) as AgentLogRow[];
  },

  /** Contact columns of the org's newest leads, for duplicate detection. */
  async listLeadContacts(orgId: string, limit = 10_000): Promise<ExistingLeadContact[]> {
    const rows: ExistingLeadContact[] = [];
    const pageSize = 1000;
    for (let from = 0; from < limit; from += pageSize) {
      const { data, error } = await dbClient
        .from("leads")
        .select("id, email, phone, profile_url")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .range(from, Math.min(from + pageSize, limit) - 1);
      if (error) throw dbError("list lead contacts", error);
      rows.push(...((data || []) as ExistingLeadContact[]));
      if (!data || data.length < pageSize) break;
    }
    return rows;
  },

  /** Inserts leads; rows hitting the (org, lower(email)) unique index are skipped and counted. */
  async insertLeads(orgId: string, leads: Record<string, any>[]): Promise<InsertAgentLeadsResult> {
    if (leads.length === 0) return { inserted: [], conflicts: 0 };
    const rows = leads.map((l) => ({ ...l, org_id: orgId }));
    const { data, error } = await dbClient.from("leads").insert(rows).select();
    if (!error) return { inserted: data || [], conflicts: 0 };
    if (error.code !== UNIQUE_VIOLATION) throw dbError("insert leads", error);

    const inserted: any[] = [];
    let conflicts = 0;
    for (const row of rows) {
      const res = await dbClient.from("leads").insert(row).select();
      if (res.error) {
        if (res.error.code === UNIQUE_VIOLATION) {
          conflicts++;
          continue;
        }
        throw dbError("insert lead", res.error);
      }
      if (res.data?.[0]) inserted.push(res.data[0]);
    }
    return { inserted, conflicts };
  },

  async getLeadsByIds(orgId: string, ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const { data, error } = await dbClient.from("leads").select("*").eq("org_id", orgId).in("id", ids.slice(0, 500));
    if (error) throw dbError("get leads", error);
    return data || [];
  },

  async findLeadByProfileUrl(orgId: string, profileUrl: string): Promise<any | null> {
    const { data, error } = await dbClient
      .from("leads")
      .select("*")
      .eq("org_id", orgId)
      .eq("profile_url", profileUrl)
      .limit(1);
    if (error) throw dbError("find lead", error);
    return data?.[0] ?? null;
  },

  async getSignalsByIds(orgId: string, ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const { data, error } = await dbClient
      .from("intent_signals")
      .select("*")
      .eq("org_id", orgId)
      .in("id", ids.slice(0, 500));
    if (error) throw dbError("get intent signals", error);
    return data || [];
  },

  async setSignalsStatus(orgId: string, ids: string[], status: string): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await dbClient
      .from("intent_signals")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .in("id", ids);
    if (error) throw dbError("update intent signals", error);
  },
};
