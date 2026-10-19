import { dbClient } from "../client";
import { dbError, type PageResult, type PageSpec } from "../helpers";

export type ActivityType =
  | "note"
  | "call"
  | "email"
  | "whatsapp"
  | "meeting"
  | "stage_change"
  | "status_change"
  | "task"
  | "campaign"
  | "workflow"
  | "agent"
  | "system";

export interface ActivityInput {
  type: ActivityType;
  leadId?: string | null;
  dealId?: string | null;
  title?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  occurredAt?: string;
}

export type TaskStatus = "open" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high";

export interface TaskInput {
  title: string;
  description?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  dueAt?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  createdBy?: string | null;
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  dueAt?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
}

/** Shared by Leads, CRM, Campaigns and Workflows: the timeline and follow-up tasks. */
export const activitiesDb = {
  async create(orgId: string, input: ActivityInput) {
    const { data, error } = await dbClient
      .from("activities")
      .insert({
        org_id: orgId,
        type: input.type,
        lead_id: input.leadId ?? null,
        deal_id: input.dealId ?? null,
        title: input.title ?? null,
        body: input.body ?? null,
        metadata: input.metadata ?? {},
        actor_id: input.actorId ?? null,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw dbError("create activity", error);
    return data;
  },

  async list(orgId: string, filter: { leadId?: string; dealId?: string; limit?: number }) {
    let query = dbClient.from("activities").select("*").eq("org_id", orgId);
    if (filter.leadId && filter.dealId) {
      query = query.or(`lead_id.eq.${filter.leadId},deal_id.eq.${filter.dealId}`);
    } else if (filter.leadId) {
      query = query.eq("lead_id", filter.leadId);
    } else if (filter.dealId) {
      query = query.eq("deal_id", filter.dealId);
    }
    const { data, error } = await query.order("occurred_at", { ascending: false }).limit(filter.limit ?? 100);
    if (error) throw dbError("list activities", error);
    return data || [];
  },

  async get(orgId: string, activityId: string) {
    const { data, error } = await dbClient.from("activities").select("*").eq("org_id", orgId).eq("id", activityId).maybeSingle();
    if (error) throw dbError("get activity", error);
    return data;
  },

  async remove(orgId: string, activityId: string): Promise<boolean> {
    const { data, error } = await dbClient.from("activities").delete().eq("org_id", orgId).eq("id", activityId).select("id");
    if (error) throw dbError("delete activity", error);
    return (data || []).length > 0;
  },
};

export interface TaskListFilter {
  leadId?: string;
  dealId?: string;
  assigneeId?: string;
  status?: TaskStatus;
  dueBefore?: string;
  withContext?: boolean;
}

/** Filtered tasks, soonest due first (undated last). */
function taskQuery(orgId: string, filter: TaskListFilter, withCount = false) {
  const columns = filter.withContext ? "*, lead:leads(id, name, company), deal:deals(id, title, stage)" : "*";
  let query = dbClient
    .from("tasks")
    .select(columns, withCount ? { count: "exact" } : undefined)
    .eq("org_id", orgId);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);
  if (filter.dealId) query = query.eq("deal_id", filter.dealId);
  if (filter.assigneeId) query = query.eq("assignee_id", filter.assigneeId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.dueBefore) query = query.lte("due_at", filter.dueBefore);
  return query.order("due_at", { ascending: true, nullsFirst: false });
}

export const tasksDb = {
  async create(orgId: string, input: TaskInput) {
    const { data, error } = await dbClient
      .from("tasks")
      .insert({
        org_id: orgId,
        title: input.title,
        description: input.description ?? null,
        lead_id: input.leadId ?? null,
        deal_id: input.dealId ?? null,
        due_at: input.dueAt ?? null,
        assignee_id: input.assigneeId ?? null,
        priority: input.priority ?? "normal",
        created_by: input.createdBy ?? null,
      })
      .select()
      .single();
    if (error) throw dbError("create task", error);
    return data;
  },

  async get(orgId: string, taskId: string) {
    const { data, error } = await dbClient.from("tasks").select("*").eq("org_id", orgId).eq("id", taskId).maybeSingle();
    if (error) throw dbError("get task", error);
    return data;
  },

  /** withContext adds `lead: { id, name, company }` and `deal: { id, title, stage }` to each row. */
  async list(orgId: string, filter: TaskListFilter & { limit?: number }) {
    const { data, error } = await taskQuery(orgId, filter).limit(filter.limit ?? 200);
    if (error) throw dbError("list tasks", error);
    return data || [];
  },

  /** One page of `list`, with the total matching count. */
  async listPage(orgId: string, filter: TaskListFilter, page: Pick<PageSpec, "from" | "to">): Promise<PageResult<any>> {
    const { data, error, count } = await taskQuery(orgId, filter, true).order("id", { ascending: true }).range(page.from, page.to);
    if (error) throw dbError("list tasks", error);
    return { rows: data || [], total: count ?? 0 };
  },

  /** Returns null when the org has no such task. */
  async update(orgId: string, taskId: string, patch: TaskPatch) {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.dueAt !== undefined) row.due_at = patch.dueAt;
    if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
    if (patch.priority !== undefined) row.priority = patch.priority;
    if (patch.status !== undefined) {
      row.status = patch.status;
      row.completed_at = patch.status === "done" ? new Date().toISOString() : null;
    }
    const { data, error } = await dbClient
      .from("tasks")
      .update(row)
      .eq("org_id", orgId)
      .eq("id", taskId)
      .select()
      .maybeSingle();
    if (error) throw dbError("update task", error);
    return data;
  },

  async remove(orgId: string, taskId: string): Promise<boolean> {
    const { data, error } = await dbClient.from("tasks").delete().eq("org_id", orgId).eq("id", taskId).select("id");
    if (error) throw dbError("delete task", error);
    return (data || []).length > 0;
  },
};
