export type WorkflowTriggerType =
  | "lead.created"
  | "lead.status_changed"
  | "lead.score_above"
  | "deal.stage_changed"
  | "campaign.replied"
  | "agent.run_completed"
  | "schedule";

export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  /** lead.created */
  source?: string;
  /** lead.status_changed / deal.stage_changed */
  from?: string;
  to?: string;
  /** lead.score_above */
  threshold?: number;
  /** campaign.replied */
  campaignId?: string;
  channel?: "email" | "whatsapp";
  /** agent.run_completed */
  status?: "completed" | "completed_with_errors" | "failed";
  /** schedule */
  cron?: string;
  timezone?: string;
  scope?: "none" | "leads";
}

export type WorkflowConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty";

export interface WorkflowConditionRule {
  field: string;
  operator: WorkflowConditionOperator;
  value?: string | number | boolean | null | Array<string | number>;
}

export interface WorkflowConditionGroup {
  op: "and" | "or";
  rules: Array<WorkflowConditionRule | WorkflowConditionGroup>;
}

export type WorkflowActionType =
  | "assign_owner"
  | "set_status"
  | "set_stage"
  | "add_tag"
  | "create_task"
  | "create_deal"
  | "add_to_campaign"
  | "notify"
  | "slack"
  | "webhook"
  | "delay";

export interface WorkflowAction {
  type: WorkflowActionType;
  params: Record<string, any>;
}

export type WorkflowStatus = "active" | "paused" | "draft";

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  status: WorkflowStatus;
  trigger: WorkflowTrigger;
  conditions: WorkflowConditionGroup;
  actions: WorkflowAction[];
  stats: { totalRuns: number; successRate: number | null; lastRunAt: string | null };
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  trigger: WorkflowTrigger;
  conditions: WorkflowConditionGroup;
  actions: WorkflowAction[];
}

export type WorkflowRunStatus = "running" | "waiting" | "succeeded" | "failed" | "skipped";
export type WorkflowStepStatus = "pending" | "waiting" | "succeeded" | "failed" | "skipped";

export interface WorkflowRunStep {
  id: string;
  position: number;
  actionType: WorkflowActionType | string;
  status: WorkflowStepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowConditionTrace {
  matched: boolean;
  rules: Array<{ field: string; operator: string; expected: unknown; actual: unknown; matched: boolean }>;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string | null;
  triggerEvent: string | null;
  triggerPayload: Record<string, unknown>;
  conditions: WorkflowConditionTrace | null;
  leadId: string | null;
  dealId: string | null;
  status: WorkflowRunStatus;
  dryRun: boolean;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  steps?: WorkflowRunStep[];
}

export interface WorkflowRunListParams {
  page?: number;
  pageSize?: number;
  workflowId?: string;
  status?: WorkflowRunStatus;
  leadId?: string;
  includeTests?: boolean;
}

export interface WorkflowTestInput {
  leadId?: string | null;
  dealId?: string | null;
}

/** A lead or deal option for the test dialog picker. */
export interface WorkflowSubjectOption {
  id: string;
  label: string;
  detail?: string;
}
