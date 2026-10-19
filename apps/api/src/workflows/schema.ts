import { z } from "zod";
import { CronExpressionParser } from "cron-parser";

export const TRIGGER_TYPES = [
  "lead.created",
  "lead.status_changed",
  "lead.score_above",
  "deal.stage_changed",
  "campaign.replied",
  "agent.run_completed",
  "schedule",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const ACTION_TYPES = [
  "assign_owner",
  "set_status",
  "set_stage",
  "add_tag",
  "create_task",
  "create_deal",
  "add_to_campaign",
  "notify",
  "slack",
  "webhook",
  "delay",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Schedules may not fire more often than this. */
export const MIN_SCHEDULE_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_ACTIONS = 20;
export const MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONDITION_DEPTH = 3;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined));
const requiredText = (max: number, label: string) => z.string().trim().min(1, `${label} is required`).max(max);

// ---- Trigger ---------------------------------------------------------------------------------

const scheduleTrigger = z.object({
  type: z.literal("schedule"),
  cron: requiredText(120, "Cron expression"),
  timezone: optionalText(64),
  /** "leads": run once per lead that matches the conditions (capped); "none": run once without a lead. */
  scope: z.enum(["none", "leads"]).default("none"),
});

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lead.created"), source: optionalText(100) }),
  z.object({ type: z.literal("lead.status_changed"), from: optionalText(50), to: optionalText(50) }),
  z.object({
    type: z.literal("lead.score_above"),
    threshold: z.coerce.number().int().min(0, "Use 0-100").max(100, "Use 0-100"),
  }),
  z.object({ type: z.literal("deal.stage_changed"), from: optionalText(50), to: optionalText(50) }),
  z.object({
    type: z.literal("campaign.replied"),
    campaignId: z.string().uuid("Pick a campaign").optional().nullable().transform((v) => v ?? undefined),
    channel: z.enum(["email", "whatsapp"]).optional().nullable().transform((v) => v ?? undefined),
  }),
  z.object({
    type: z.literal("agent.run_completed"),
    status: z
      .enum(["completed", "completed_with_errors", "failed"])
      .optional()
      .nullable()
      .transform((v) => v ?? undefined),
  }),
  scheduleTrigger,
]);
export type WorkflowTrigger = z.output<typeof triggerSchema>;

// ---- Conditions ------------------------------------------------------------------------------

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value?: string | number | boolean | null | Array<string | number>;
}
export interface ConditionGroup {
  op: "and" | "or";
  rules: Array<ConditionRule | ConditionGroup>;
}

const conditionValue = z
  .union([
    z.string().max(500),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string().max(200), z.number()])).max(50),
  ])
  .optional();

export const conditionRuleSchema = z.object({
  field: z
    .string()
    .trim()
    .regex(/^(lead|deal|event|trigger)\.[A-Za-z0-9_.]+$/, "Use a field like lead.score, deal.stage or event.to"),
  operator: z.enum(CONDITION_OPERATORS),
  value: conditionValue,
});

export const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    op: z.enum(["and", "or"]).default("and"),
    rules: z.array(z.union([conditionRuleSchema, conditionGroupSchema])).max(25, "Use at most 25 rules per group"),
  })
) as z.ZodType<ConditionGroup>;

export const EMPTY_CONDITIONS: ConditionGroup = { op: "and", rules: [] };

function groupDepth(group: ConditionGroup, depth = 1): number {
  let max = depth;
  for (const rule of group.rules) {
    if ("rules" in rule) max = Math.max(max, groupDepth(rule, depth + 1));
  }
  return max;
}

// ---- Actions ---------------------------------------------------------------------------------

const uuid = (label: string) => z.string({ required_error: `${label} is required` }).uuid(`${label} is required`);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assign_owner"),
    params: z.object({ ownerId: uuid("Owner"), target: z.enum(["lead", "deal"]).default("lead") }),
  }),
  z.object({ type: z.literal("set_status"), params: z.object({ status: requiredText(50, "Status") }) }),
  z.object({ type: z.literal("set_stage"), params: z.object({ stage: requiredText(50, "Stage") }) }),
  z.object({ type: z.literal("add_tag"), params: z.object({ tag: requiredText(50, "Tag") }) }),
  z.object({
    type: z.literal("create_task"),
    params: z.object({
      title: requiredText(200, "Task title"),
      description: optionalText(2000),
      dueInDays: z.coerce.number().int().min(0).max(365).optional().nullable().transform((v) => v ?? undefined),
      assignTo: z.enum(["owner", "user", "none"]).default("owner"),
      assigneeId: z.string().uuid().optional().nullable().transform((v) => v ?? undefined),
      priority: z.enum(["low", "normal", "high"]).default("normal"),
    }),
  }),
  z.object({
    type: z.literal("create_deal"),
    params: z.object({
      title: optionalText(200),
      value: z.coerce.number().min(0).max(1e12).optional().nullable().transform((v) => v ?? undefined),
      stage: optionalText(50),
      probability: z.coerce.number().int().min(0).max(100).optional().nullable().transform((v) => v ?? undefined),
    }),
  }),
  z.object({ type: z.literal("add_to_campaign"), params: z.object({ campaignId: uuid("Campaign") }) }),
  z.object({
    type: z.literal("notify"),
    params: z.object({
      recipients: z.enum(["owner", "admins", "managers", "all", "user"]).default("owner"),
      userId: z.string().uuid().optional().nullable().transform((v) => v ?? undefined),
      title: requiredText(200, "Title"),
      body: optionalText(2000),
    }),
  }),
  z.object({ type: z.literal("slack"), params: z.object({ message: requiredText(2000, "Message") }) }),
  z.object({
    type: z.literal("webhook"),
    params: z.object({
      url: z
        .string()
        .trim()
        .url("Enter a valid URL")
        .refine((u) => u.startsWith("https://"), "Webhook URLs must use https")
        .optional()
        .or(z.literal("").transform(() => undefined))
        .nullable()
        .transform((v) => v ?? undefined),
      includeContext: z.boolean().default(true),
    }),
  }),
  z.object({
    type: z.literal("delay"),
    params: z.object({
      amount: z.coerce.number().int().min(1, "Wait at least 1 unit"),
      unit: z.enum(["minutes", "hours", "days"]).default("hours"),
    }),
  }),
]);
export type WorkflowAction = z.output<typeof actionSchema>;
export type ActionOf<T extends ActionType> = Extract<WorkflowAction, { type: T }>;

export function delayMs(params: { amount: number; unit: "minutes" | "hours" | "days" }): number {
  const unitMs = params.unit === "minutes" ? 60_000 : params.unit === "hours" ? 3_600_000 : 86_400_000;
  return params.amount * unitMs;
}

// ---- Subjects: what a trigger provides and what an action needs ------------------------------

type Subject = "lead" | "deal";

/** Records a trigger can put in context. Lead-only triggers can still reach a deal via create_deal. */
export const TRIGGER_SUBJECTS: Record<TriggerType, Subject[]> = {
  "lead.created": ["lead"],
  "lead.status_changed": ["lead"],
  "lead.score_above": ["lead"],
  "deal.stage_changed": ["deal", "lead"],
  "campaign.replied": ["lead"],
  "agent.run_completed": [],
  schedule: [],
};

function requiredSubject(action: WorkflowAction): Subject | null {
  switch (action.type) {
    case "assign_owner":
      return action.params.target;
    case "set_status":
    case "add_tag":
    case "create_deal":
    case "add_to_campaign":
      return "lead";
    case "set_stage":
      return "deal";
    default:
      return null;
  }
}

export function triggerSubjects(trigger: WorkflowTrigger): Subject[] {
  if (trigger.type === "schedule") return trigger.scope === "leads" ? ["lead"] : [];
  return TRIGGER_SUBJECTS[trigger.type];
}

// ---- Cron ------------------------------------------------------------------------------------

/** Next fire time after `after`; throws on an invalid expression. */
export function nextCronDate(cron: string, timezone: string | undefined, after: Date = new Date()): Date {
  const expr = CronExpressionParser.parse(cron, { currentDate: after, tz: timezone || "UTC" });
  return expr.next().toDate();
}

/** Returns an error message, or null when the expression is valid and not too frequent. */
export function validateCron(cron: string, timezone?: string): string | null {
  try {
    if (timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      } catch {
        return "Unsupported time zone";
      }
    }
    // Gaps differ within a day ("0,3 * * * *"), so check a full day of fire times, not just the next two.
    const expr = CronExpressionParser.parse(cron, { currentDate: new Date(), tz: timezone || "UTC" });
    const first = expr.next().getTime();
    let previous = first;
    while (previous - first <= 24 * 60 * 60 * 1000) {
      const next = expr.next().getTime();
      if (next - previous < MIN_SCHEDULE_INTERVAL_MS) return "Schedules can run at most every 5 minutes";
      previous = next;
    }
    return null;
  } catch (err: any) {
    return `Invalid cron expression${err?.message ? `: ${err.message}` : ""}`;
  }
}

// ---- Whole definition ------------------------------------------------------------------------

const definitionFields = {
  name: requiredText(120, "Name"),
  description: z.string().trim().max(1000).optional().nullable(),
  enabled: z.boolean().optional(),
  trigger: triggerSchema,
  conditions: conditionGroupSchema.default(EMPTY_CONDITIONS),
  actions: z.array(actionSchema).min(1, "Add at least one action").max(MAX_ACTIONS, `Use at most ${MAX_ACTIONS} actions`),
};

type DefinitionShape = {
  trigger: WorkflowTrigger;
  conditions: ConditionGroup;
  actions: WorkflowAction[];
};

function checkDefinition(def: DefinitionShape, ctx: z.RefinementCtx) {
  if (def.trigger.type === "schedule") {
    const cronError = validateCron(def.trigger.cron, def.trigger.timezone);
    if (cronError) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["trigger", "cron"], message: cronError });
  }

  if (groupDepth(def.conditions) > MAX_CONDITION_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["conditions"],
      message: `Condition groups can be nested at most ${MAX_CONDITION_DEPTH} levels deep`,
    });
  }

  const available = new Set<Subject>(triggerSubjects(def.trigger));
  let totalDelay = 0;
  def.actions.forEach((action, index) => {
    const need = requiredSubject(action);
    if (need && !available.has(need)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actions", index, "type"],
        message:
          need === "deal"
            ? "This action needs a deal: use a deal trigger or add a \"Create deal\" action before it"
            : "This action needs a lead, but the trigger doesn't provide one",
      });
    }
    if (action.type === "create_deal") available.add("deal");
    if (action.type === "notify" && action.params.recipients === "user" && !action.params.userId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", index, "params", "userId"], message: "Pick a user" });
    }
    if (action.type === "create_task" && action.params.assignTo === "user" && !action.params.assigneeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actions", index, "params", "assigneeId"],
        message: "Pick an assignee",
      });
    }
    if (action.type === "delay") {
      totalDelay += delayMs(action.params);
      if (index === def.actions.length - 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", index, "type"],
          message: "A delay must be followed by another action",
        });
      }
    }
  });
  if (totalDelay > MAX_DELAY_MS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actions"], message: "Delays can add up to at most 30 days" });
  }
}

export const workflowDefinitionSchema = z.object(definitionFields).strict().superRefine(checkDefinition);
export type WorkflowDefinition = z.output<typeof workflowDefinitionSchema>;

/** PATCH body: every field optional; the merged result is re-validated with workflowDefinitionSchema. */
export const workflowPatchSchema = z
  .object({
    name: definitionFields.name.optional(),
    description: definitionFields.description,
    enabled: definitionFields.enabled,
    trigger: z.unknown().optional(),
    conditions: z.unknown().optional(),
    actions: z.unknown().optional(),
  })
  .strict();

/** Parses a stored row's definition (rows written before validation existed may fail). */
export function parseStoredDefinition(row: {
  name: string;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
}): { ok: true; definition: DefinitionShape } | { ok: false; error: string } {
  const result = workflowDefinitionSchema.safeParse({
    name: row.name || "Untitled workflow",
    trigger: row.trigger,
    conditions: row.conditions ?? EMPTY_CONDITIONS,
    actions: row.actions,
  });
  if (result.success) return { ok: true, definition: result.data };
  const issue = result.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "definition"}: ${issue.message}` };
}
