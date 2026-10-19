export type DealStage = "New" | "Qualified" | "Proposal" | "Negotiation" | "Closed Won" | "Closed Lost";

export interface DealLeadSummary {
  id: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  status: string | null;
  score: number | null;
}

export interface Deal {
  id: string;
  title: string;
  company: string;
  contact: string;
  value: number;
  stage: DealStage;
  probability: number;
  /** YYYY-MM-DD or "". */
  expectedClose: string;
  /** Legacy free-text owner; prefer ownerId. */
  owner: string;
  ownerId?: string | null;
  leadId?: string | null;
  lead?: DealLeadSummary | null;
  nextFollowUpAt?: string | null;
  lostReason?: string | null;
  position?: number;
  closedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Writable deal fields (POST / PATCH /api/deals). */
export interface DealInput {
  title?: string;
  company?: string | null;
  contact?: string | null;
  value?: number;
  probability?: number;
  stage?: DealStage;
  expectedClose?: string | null;
  ownerId?: string | null;
  leadId?: string | null;
  nextFollowUpAt?: string | null;
  lostReason?: string | null;
}

export interface DealListParams {
  stage?: DealStage[];
  /** "me", "unassigned" or a user id. */
  ownerId?: string;
  leadId?: string;
  q?: string;
}

/** GET /api/deals/board: the first deals of each stage plus server-side totals for the whole stage. */
export interface DealBoardParams {
  /** "me", "unassigned" or a user id. */
  ownerId?: string;
  q?: string;
  perStage?: number;
  /** Larger limits for expanded columns. */
  expand?: Partial<Record<DealStage, number>>;
}

export interface DealBoardColumn {
  stage: DealStage;
  /** Ordered by position; at most the stage's limit. */
  deals: Deal[];
  count: number;
  value: number;
  /** Probability-weighted value. */
  weighted: number;
}

export interface DealBoard {
  stages: DealBoardColumn[];
}

export interface BulkCreateDealsInput {
  leadIds: string[];
  stage?: DealStage;
  ownerId?: string | null;
  value?: number;
}

export interface BulkCreateDealsResult {
  created: number;
  /** Lead ids that were not found in this workspace. */
  missing: string[];
  deals: Deal[];
}

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

/** Activity types a user can log by hand. */
export type ManualActivityType = "note" | "call" | "email" | "whatsapp" | "meeting";

export interface Activity {
  id: string;
  type: ActivityType;
  leadId: string | null;
  dealId: string | null;
  title: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  actorId: string | null;
  occurredAt: string;
}

export interface ActivityInput {
  type: ManualActivityType;
  title?: string | null;
  body?: string | null;
  occurredAt?: string;
}

export type TaskStatus = "open" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  leadId: string | null;
  dealId: string | null;
  dueAt: string | null;
  assigneeId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  lead?: { id: string; name: string; company: string | null } | null;
  deal?: { id: string; title: string; stage: string } | null;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  dueAt?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  dealId?: string | null;
}

export type TaskPatch = Partial<Omit<TaskInput, "dealId">> & { status?: TaskStatus };

export interface TaskListParams {
  /** "me" (default), "all" or a user id. */
  assignee?: string;
  status?: TaskStatus;
  due?: "overdue" | "today" | "week";
}
