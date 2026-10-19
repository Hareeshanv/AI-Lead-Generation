import { dbClient } from "../client";
import { dbError, type PageResult, type PageSpec } from "../helpers";

export type WorkflowRunStatus = "running" | "waiting" | "succeeded" | "failed" | "skipped";
export type WorkflowStepStatus = "pending" | "waiting" | "succeeded" | "failed" | "skipped";

export interface WorkflowRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: string | null;
  enabled: boolean;
  trigger: Record<string, any>;
  conditions: Record<string, any>;
  actions: Array<Record<string, any>>;
  triggers_count: number | null;
  total_runs: number | null;
  success_rate: number | string | null;
  last_run: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRow {
  id: string;
  org_id: string;
  workflow_id: string;
  trigger_event: string | null;
  trigger_payload: Record<string, any>;
  lead_id: string | null;
  deal_id: string | null;
  status: WorkflowRunStatus;
  dry_run: boolean;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface WorkflowRunStepRow {
  id: string;
  org_id: string;
  run_id: string;
  position: number;
  action_type: string;
  status: WorkflowStepStatus;
  input: Record<string, any>;
  output: Record<string, any> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface WorkflowInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  trigger: Record<string, any>;
  conditions: Record<string, any>;
  actions: Array<Record<string, any>>;
  createdBy?: string | null;
}

export type WorkflowPatch = Partial<Omit<WorkflowInput, "createdBy">>;

export interface WorkflowRunInput {
  workflowId: string;
  triggerEvent: string | null;
  triggerPayload: Record<string, any>;
  leadId?: string | null;
  dealId?: string | null;
  status: WorkflowRunStatus;
  dryRun?: boolean;
  error?: string | null;
  completedAt?: string | null;
}

export interface WorkflowRunFilter {
  workflowId?: string;
  status?: WorkflowRunStatus;
  leadId?: string;
  includeDryRuns?: boolean;
}

const statusFor = (enabled: boolean) => (enabled ? "active" : "paused");

/** Owned by the Workflows module; extend here. */
export const workflowsDb = {
  async list(orgId: string, filter: { enabled?: boolean; triggerType?: string } = {}): Promise<WorkflowRow[]> {
    let query = dbClient.from("workflows").select("*").eq("org_id", orgId);
    if (filter.enabled !== undefined) query = query.eq("enabled", filter.enabled);
    if (filter.triggerType) query = query.eq("trigger->>type", filter.triggerType);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw dbError("list workflows", error);
    return (data || []) as WorkflowRow[];
  },

  /** Enabled workflows across all orgs with the given trigger type (schedule bootstrap). */
  async listEnabledByTrigger(triggerType: string): Promise<WorkflowRow[]> {
    const { data, error } = await dbClient
      .from("workflows")
      .select("*")
      .eq("enabled", true)
      .eq("trigger->>type", triggerType);
    if (error) throw dbError("list workflows by trigger", error);
    return (data || []) as WorkflowRow[];
  },

  async get(orgId: string, id: string): Promise<WorkflowRow | null> {
    const { data, error } = await dbClient.from("workflows").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
    if (error) throw dbError("get workflow", error);
    return data as WorkflowRow | null;
  },

  async create(orgId: string, input: WorkflowInput): Promise<WorkflowRow> {
    const enabled = input.enabled ?? false;
    const { data, error } = await dbClient
      .from("workflows")
      .insert({
        org_id: orgId,
        name: input.name,
        description: input.description ?? null,
        enabled,
        status: enabled ? "active" : "draft",
        trigger: input.trigger,
        conditions: input.conditions,
        actions: input.actions,
        triggers_count: 1,
        total_runs: 0,
        success_rate: null,
        created_by: input.createdBy ?? null,
      })
      .select()
      .single();
    if (error) throw dbError("create workflow", error);
    return data as WorkflowRow;
  },

  /** Returns null when the org has no such workflow. */
  async update(orgId: string, id: string, patch: WorkflowPatch): Promise<WorkflowRow | null> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.trigger !== undefined) row.trigger = patch.trigger;
    if (patch.conditions !== undefined) row.conditions = patch.conditions;
    if (patch.actions !== undefined) row.actions = patch.actions;
    if (patch.enabled !== undefined) {
      row.enabled = patch.enabled;
      row.status = statusFor(patch.enabled);
    }
    const { data, error } = await dbClient
      .from("workflows")
      .update(row)
      .eq("org_id", orgId)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw dbError("update workflow", error);
    return data as WorkflowRow | null;
  },

  async remove(orgId: string, id: string): Promise<boolean> {
    const { data, error } = await dbClient.from("workflows").delete().eq("org_id", orgId).eq("id", id).select("id");
    if (error) throw dbError("delete workflow", error);
    return (data || []).length > 0;
  },

  /** Recomputes total_runs / success_rate / last_run from non-test, finished runs. */
  async refreshStats(orgId: string, workflowId: string): Promise<void> {
    const base = () =>
      dbClient
        .from("workflow_runs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("workflow_id", workflowId)
        .eq("dry_run", false);
    const [total, succeeded, failed, last] = await Promise.all([
      base().in("status", ["succeeded", "failed"]),
      base().eq("status", "succeeded"),
      base().eq("status", "failed"),
      dbClient
        .from("workflow_runs")
        .select("started_at")
        .eq("org_id", orgId)
        .eq("workflow_id", workflowId)
        .eq("dry_run", false)
        .neq("status", "skipped")
        .order("started_at", { ascending: false })
        .limit(1),
    ]);
    for (const r of [total, succeeded, failed, last]) if (r.error) throw dbError("compute workflow stats", r.error);
    const finished = (succeeded.count ?? 0) + (failed.count ?? 0);
    const { error } = await dbClient
      .from("workflows")
      .update({
        total_runs: total.count ?? 0,
        success_rate: finished > 0 ? Math.round(((succeeded.count ?? 0) / finished) * 10000) / 100 : null,
        last_run: (last.data?.[0] as { started_at?: string } | undefined)?.started_at ?? null,
      })
      .eq("org_id", orgId)
      .eq("id", workflowId);
    if (error) throw dbError("update workflow stats", error);
  },

  async createRun(orgId: string, input: WorkflowRunInput): Promise<WorkflowRunRow> {
    const { data, error } = await dbClient
      .from("workflow_runs")
      .insert({
        org_id: orgId,
        workflow_id: input.workflowId,
        trigger_event: input.triggerEvent,
        trigger_payload: input.triggerPayload,
        lead_id: input.leadId ?? null,
        deal_id: input.dealId ?? null,
        status: input.status,
        dry_run: input.dryRun ?? false,
        error: input.error ?? null,
        completed_at: input.completedAt ?? null,
      })
      .select()
      .single();
    if (error) throw dbError("create workflow run", error);
    return data as WorkflowRunRow;
  },

  async updateRun(
    orgId: string,
    runId: string,
    patch: { status?: WorkflowRunStatus; error?: string | null; completedAt?: string | null }
  ): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.error !== undefined) row.error = patch.error;
    if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
    const { error } = await dbClient.from("workflow_runs").update(row).eq("org_id", orgId).eq("id", runId);
    if (error) throw dbError("update workflow run", error);
  },

  /** Moves a run from `from` to `to` only if it is still in `from`; returns false if another worker got there first. */
  async transitionRun(orgId: string, runId: string, from: WorkflowRunStatus, to: WorkflowRunStatus): Promise<boolean> {
    const { data, error } = await dbClient
      .from("workflow_runs")
      .update({ status: to })
      .eq("org_id", orgId)
      .eq("id", runId)
      .eq("status", from)
      .select("id");
    if (error) throw dbError("transition workflow run", error);
    return (data || []).length > 0;
  },

  async getRun(orgId: string, runId: string): Promise<WorkflowRunRow | null> {
    const { data, error } = await dbClient
      .from("workflow_runs")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", runId)
      .maybeSingle();
    if (error) throw dbError("get workflow run", error);
    return data as WorkflowRunRow | null;
  },

  async listRuns(orgId: string, filter: WorkflowRunFilter, page: PageSpec): Promise<PageResult<WorkflowRunRow>> {
    let query = dbClient.from("workflow_runs").select("*", { count: "exact" }).eq("org_id", orgId);
    if (filter.workflowId) query = query.eq("workflow_id", filter.workflowId);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.leadId) query = query.eq("lead_id", filter.leadId);
    if (!filter.includeDryRuns) query = query.eq("dry_run", false);
    const sort = page.sort ?? { column: "started_at", ascending: false };
    const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).range(page.from, page.to);
    if (error) throw dbError("list workflow runs", error);
    return { rows: (data || []) as WorkflowRunRow[], total: count ?? 0 };
  },

  async createStep(
    orgId: string,
    input: {
      runId: string;
      position: number;
      actionType: string;
      status: WorkflowStepStatus;
      input: Record<string, any>;
      output?: Record<string, any> | null;
      error?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    }
  ): Promise<WorkflowRunStepRow> {
    const { data, error } = await dbClient
      .from("workflow_run_steps")
      .insert({
        org_id: orgId,
        run_id: input.runId,
        position: input.position,
        action_type: input.actionType,
        status: input.status,
        input: input.input,
        output: input.output ?? null,
        error: input.error ?? null,
        started_at: input.startedAt ?? null,
        completed_at: input.completedAt ?? null,
      })
      .select()
      .single();
    if (error) throw dbError("create workflow run step", error);
    return data as WorkflowRunStepRow;
  },

  async updateStep(
    orgId: string,
    stepId: string,
    patch: { status?: WorkflowStepStatus; output?: Record<string, any> | null; error?: string | null; completedAt?: string | null }
  ): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.output !== undefined) row.output = patch.output;
    if (patch.error !== undefined) row.error = patch.error;
    if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
    const { error } = await dbClient.from("workflow_run_steps").update(row).eq("org_id", orgId).eq("id", stepId);
    if (error) throw dbError("update workflow run step", error);
  },

  async listSteps(orgId: string, runId: string): Promise<WorkflowRunStepRow[]> {
    const { data, error } = await dbClient
      .from("workflow_run_steps")
      .select("*")
      .eq("org_id", orgId)
      .eq("run_id", runId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw dbError("list workflow run steps", error);
    return (data || []) as WorkflowRunStepRow[];
  },

  /** True when a queued job of `type` exists whose dedupe_key starts with `dedupeKeyPrefix`. */
  async hasQueuedJob(orgId: string, type: string, dedupeKeyPrefix: string): Promise<boolean> {
    const { count, error } = await dbClient
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("type", type)
      .eq("status", "queued")
      .like("dedupe_key", `${dedupeKeyPrefix}%`);
    if (error) throw dbError("check queued jobs", error);
    return (count ?? 0) > 0;
  },

  /** Leads among `leadIds` a "leads"-scoped schedule workflow has already run for. */
  async scheduleProcessedLeadIds(orgId: string, workflowId: string, leadIds: string[]): Promise<Set<string>> {
    const done = new Set<string>();
    for (let i = 0; i < leadIds.length; i += 200) {
      const { data, error } = await dbClient
        .from("workflow_schedule_leads")
        .select("lead_id")
        .eq("org_id", orgId)
        .eq("workflow_id", workflowId)
        .in("lead_id", leadIds.slice(i, i + 200));
      if (error) throw dbError("list processed schedule leads", error);
      for (const row of data || []) done.add(row.lead_id as string);
    }
    return done;
  },

  async markScheduleLeadProcessed(orgId: string, workflowId: string, leadId: string, runId: string | null): Promise<void> {
    const { error } = await dbClient
      .from("workflow_schedule_leads")
      .upsert({ org_id: orgId, workflow_id: workflowId, lead_id: leadId, run_id: runId }, { onConflict: "workflow_id,lead_id", ignoreDuplicates: true });
    if (error) throw dbError("mark schedule lead processed", error);
  },
};
