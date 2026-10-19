import type {
  WorkflowAction,
  WorkflowActionType,
  WorkflowConditionGroup,
  WorkflowConditionOperator,
  WorkflowConditionRule,
  WorkflowInput,
  WorkflowTrigger,
  WorkflowTriggerType,
} from "@/types";

export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Hot", "Warm", "Cold", "Closed"];
export const DEAL_STAGES = ["New", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

export const TRIGGERS: { type: WorkflowTriggerType; label: string; description: string; subjects: ("lead" | "deal")[] }[] = [
  { type: "lead.created", label: "Lead is created", description: "A new lead is added from any source.", subjects: ["lead"] },
  { type: "lead.status_changed", label: "Lead status changes", description: "A lead moves to a new status.", subjects: ["lead"] },
  { type: "lead.score_above", label: "Lead score crosses a threshold", description: "A lead's score rises to or above a value.", subjects: ["lead"] },
  { type: "deal.stage_changed", label: "Deal stage changes", description: "A deal moves to another pipeline stage.", subjects: ["deal", "lead"] },
  { type: "campaign.replied", label: "Lead replies to a campaign", description: "An email or WhatsApp reply arrives.", subjects: ["lead"] },
  { type: "agent.run_completed", label: "AI agent run finishes", description: "A lead discovery run completes.", subjects: [] },
  { type: "schedule", label: "On a schedule", description: "Runs at set times (cron).", subjects: [] },
];

export const triggerMeta = (type: WorkflowTriggerType | undefined) => TRIGGERS.find((t) => t.type === type);

export const ACTIONS: { type: WorkflowActionType; label: string; description: string; needs?: "lead" | "deal" }[] = [
  { type: "assign_owner", label: "Assign owner", description: "Set the owner of the lead or deal." },
  { type: "set_status", label: "Set lead status", description: "Change the lead's status.", needs: "lead" },
  { type: "set_stage", label: "Move deal stage", description: "Move the deal to another stage.", needs: "deal" },
  { type: "add_tag", label: "Add tag", description: "Tag the lead.", needs: "lead" },
  { type: "create_task", label: "Create follow-up task", description: "Add a task for someone on the team." },
  { type: "create_deal", label: "Create deal", description: "Open a deal for the lead (skipped if one is open).", needs: "lead" },
  { type: "add_to_campaign", label: "Add to campaign", description: "Enroll the lead in a campaign.", needs: "lead" },
  { type: "notify", label: "Send in-app notification", description: "Notify the owner, managers or a teammate." },
  { type: "slack", label: "Send Slack message", description: "Post to the connected Slack channel." },
  { type: "webhook", label: "Send webhook", description: "POST the run's data to a URL." },
  { type: "delay", label: "Wait", description: "Pause before the next action." },
];

export const actionMeta = (type: WorkflowActionType | string) => ACTIONS.find((a) => a.type === type);

export const CONDITION_FIELDS: { value: string; label: string; kind: "text" | "number" | "list" | "date" }[] = [
  { value: "lead.score", label: "Lead score", kind: "number" },
  { value: "lead.status", label: "Lead status", kind: "text" },
  { value: "lead.source", label: "Lead source", kind: "text" },
  { value: "lead.tags", label: "Lead tags", kind: "list" },
  { value: "lead.industry", label: "Lead industry", kind: "text" },
  { value: "lead.location", label: "Lead location", kind: "text" },
  { value: "lead.company", label: "Lead company", kind: "text" },
  { value: "lead.email", label: "Lead email", kind: "text" },
  { value: "lead.owner_id", label: "Lead owner", kind: "text" },
  { value: "lead.course_interest", label: "Course interest", kind: "text" },
  { value: "lead.created_at", label: "Lead created at", kind: "date" },
  { value: "deal.stage", label: "Deal stage", kind: "text" },
  { value: "deal.value", label: "Deal value", kind: "number" },
  { value: "deal.probability", label: "Deal probability", kind: "number" },
  { value: "event.from", label: "Changed from", kind: "text" },
  { value: "event.to", label: "Changed to", kind: "text" },
  { value: "event.channel", label: "Reply channel", kind: "text" },
  { value: "event.leadsCreated", label: "Agent: leads created", kind: "number" },
];

export const OPERATORS: { value: WorkflowConditionOperator; label: string; unary?: boolean }[] = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "at least" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "at most" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "in", label: "is one of (comma separated)" },
  { value: "not_in", label: "is not one of" },
  { value: "is_empty", label: "is empty", unary: true },
  { value: "is_not_empty", label: "is not empty", unary: true },
];

export const isUnary = (op: WorkflowConditionOperator) => OPERATORS.some((o) => o.value === op && o.unary);
export const isRule = (r: WorkflowConditionRule | WorkflowConditionGroup): r is WorkflowConditionRule => !("rules" in r);

export function defaultTrigger(type: WorkflowTriggerType): WorkflowTrigger {
  switch (type) {
    case "lead.score_above":
      return { type, threshold: 80 };
    case "schedule":
      return { type, cron: "0 9 * * 1-5", timezone: "Asia/Kolkata", scope: "none" };
    default:
      return { type };
  }
}

export function defaultParams(type: WorkflowActionType): Record<string, any> {
  switch (type) {
    case "assign_owner":
      return { ownerId: "", target: "lead" };
    case "set_status":
      return { status: "Contacted" };
    case "set_stage":
      return { stage: "Qualified" };
    case "add_tag":
      return { tag: "" };
    case "create_task":
      return { title: "Follow up with {{lead.name}}", dueInDays: 1, assignTo: "owner", priority: "normal" };
    case "create_deal":
      return { title: "{{lead.company}}", stage: "New" };
    case "add_to_campaign":
      return { campaignId: "" };
    case "notify":
      return { recipients: "owner", title: "", body: "" };
    case "slack":
      return { message: "" };
    case "webhook":
      return { url: "", includeContext: true };
    case "delay":
      return { amount: 1, unit: "days" };
  }
}

export function describeTrigger(t: WorkflowTrigger | undefined): string {
  if (!t?.type) return "No trigger";
  switch (t.type) {
    case "lead.created":
      return t.source ? `A lead is created from ${t.source}` : "A lead is created";
    case "lead.status_changed":
      return `Lead status changes${t.from ? ` from ${t.from}` : ""}${t.to ? ` to ${t.to}` : ""}`;
    case "lead.score_above":
      return `Lead score reaches ${t.threshold ?? "?"}+`;
    case "deal.stage_changed":
      return `Deal moves${t.from ? ` from ${t.from}` : ""}${t.to ? ` to ${t.to}` : ""}`;
    case "campaign.replied":
      return `A lead replies${t.channel ? ` on ${t.channel}` : ""}${t.campaignId ? " to a specific campaign" : ""}`;
    case "agent.run_completed":
      return `An AI agent run ${t.status ? t.status.replace(/_/g, " ") : "finishes"}`;
    case "schedule":
      return `Schedule ${t.cron ?? ""}${t.timezone ? ` (${t.timezone})` : ""}${t.scope === "leads" ? ", for each matching lead" : ""}`;
  }
}

export function describeAction(a: WorkflowAction): string {
  const p = a.params || {};
  switch (a.type) {
    case "assign_owner":
      return `Assign the ${p.target === "deal" ? "deal" : "lead"} owner`;
    case "set_status":
      return `Set lead status to ${p.status || "?"}`;
    case "set_stage":
      return `Move deal to ${p.stage || "?"}`;
    case "add_tag":
      return `Add tag "${p.tag || "?"}"`;
    case "create_task":
      return `Create task "${p.title || "?"}"${p.dueInDays != null && p.dueInDays !== "" ? ` due in ${p.dueInDays}d` : ""}`;
    case "create_deal":
      return `Create a deal${p.stage ? ` in ${p.stage}` : ""}`;
    case "add_to_campaign":
      return "Add the lead to a campaign";
    case "notify":
      return `Notify ${p.recipients === "user" ? "a teammate" : p.recipients || "owner"}: "${p.title || "?"}"`;
    case "slack":
      return "Post to Slack";
    case "webhook":
      return p.url ? `POST to ${safeHost(p.url)}` : "POST to the workspace webhook";
    case "delay":
      return `Wait ${p.amount ?? "?"} ${p.unit ?? "hours"}`;
    default:
      return a.type;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Client-side checks that mirror the API's; keys match the API's field paths. */
export function validateDraft(draft: WorkflowInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Name is required";
  const t = draft.trigger;
  if (t.type === "lead.score_above" && (t.threshold == null || Number.isNaN(Number(t.threshold)) || t.threshold < 0 || t.threshold > 100)) {
    errors["trigger.threshold"] = "Use 0-100";
  }
  if (t.type === "schedule" && !t.cron?.trim()) errors["trigger.cron"] = "Cron expression is required";

  draft.conditions.rules.forEach((r, i) => {
    if (!isRule(r)) return;
    if (!r.field) errors[`conditions.rules.${i}.field`] = "Pick a field";
    if (!isUnary(r.operator) && (r.value === undefined || r.value === null || String(r.value).trim() === "")) {
      errors[`conditions.rules.${i}.value`] = "Enter a value";
    }
  });

  if (draft.actions.length === 0) errors.actions = "Add at least one action";
  const available = new Set<string>(t.type === "schedule" ? (t.scope === "leads" ? ["lead"] : []) : triggerMeta(t.type)?.subjects ?? []);
  draft.actions.forEach((a, i) => {
    const p = a.params || {};
    const need = a.type === "assign_owner" ? p.target || "lead" : actionMeta(a.type)?.needs;
    if (need && !available.has(need)) {
      errors[`actions.${i}.type`] =
        need === "deal" ? "Needs a deal: use a deal trigger or add \"Create deal\" first" : "Needs a lead, but this trigger has none";
    }
    if (a.type === "create_deal") available.add("deal");
    const req = (key: string, label: string) => {
      if (p[key] === undefined || p[key] === null || String(p[key]).trim() === "") errors[`actions.${i}.params.${key}`] = `${label} is required`;
    };
    if (a.type === "assign_owner") req("ownerId", "Owner");
    if (a.type === "set_status") req("status", "Status");
    if (a.type === "set_stage") req("stage", "Stage");
    if (a.type === "add_tag") req("tag", "Tag");
    if (a.type === "create_task") {
      req("title", "Task title");
      if (p.assignTo === "user") req("assigneeId", "Assignee");
    }
    if (a.type === "add_to_campaign") req("campaignId", "Campaign");
    if (a.type === "notify") {
      req("title", "Title");
      if (p.recipients === "user") req("userId", "User");
    }
    if (a.type === "slack") req("message", "Message");
    if (a.type === "webhook" && p.url && !/^https:\/\//.test(p.url)) errors[`actions.${i}.params.url`] = "Webhook URLs must use https";
    if (a.type === "delay") {
      if (!(Number(p.amount) >= 1)) errors[`actions.${i}.params.amount`] = "Wait at least 1";
      if (i === draft.actions.length - 1) errors[`actions.${i}.type`] = "A wait must be followed by another action";
    }
  });
  return errors;
}

/** Drops empty optional strings so the API sees "not set" rather than "". */
export function cleanDraft(draft: WorkflowInput): WorkflowInput {
  const strip = (obj: Record<string, any>) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== "" && v !== undefined && v !== null));
  return {
    ...draft,
    name: draft.name.trim(),
    description: draft.description?.trim() || null,
    trigger: strip(draft.trigger) as WorkflowTrigger,
    conditions: draft.conditions,
    actions: draft.actions.map((a) => ({ type: a.type, params: strip(a.params || {}) })),
  };
}

export const emptyDraft = (): WorkflowInput => ({
  name: "",
  description: "",
  trigger: { type: "lead.created" },
  conditions: { op: "and", rules: [] },
  actions: [{ type: "create_task", params: defaultParams("create_task") }],
});

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  build: () => WorkflowInput;
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "hot-lead-alert",
    name: "Hot lead alert",
    description: "When a lead's score reaches 80, mark it Hot, alert the owner and post to Slack.",
    build: () => ({
      name: "Hot lead alert",
      description: "Escalate high-intent leads as soon as they score 80+.",
      trigger: { type: "lead.score_above", threshold: 80 },
      conditions: { op: "and", rules: [] },
      actions: [
        { type: "set_status", params: { status: "Hot" } },
        {
          type: "notify",
          params: { recipients: "owner", title: "Hot lead: {{lead.name}}", body: "{{lead.company}} scored {{lead.score}}. Reach out today." },
        },
        { type: "slack", params: { message: ":fire: Hot lead {{lead.name}} ({{lead.company}}) scored {{lead.score}}" } },
      ],
    }),
  },
  {
    id: "new-lead-follow-up",
    name: "New lead follow-up",
    description: "Create a call task for every new lead, then a reminder if it's still New two days later.",
    build: () => ({
      name: "New lead follow-up",
      description: "Make sure no new lead goes uncontacted.",
      trigger: { type: "lead.created" },
      conditions: { op: "and", rules: [{ field: "lead.email", operator: "is_not_empty" }] },
      actions: [
        { type: "create_task", params: { title: "Call {{lead.name}}", dueInDays: 0, assignTo: "owner", priority: "high" } },
        { type: "delay", params: { amount: 2, unit: "days" } },
        { type: "notify", params: { recipients: "owner", title: "Did you reach {{lead.name}}?", body: "Their status is {{lead.status}}." } },
      ],
    }),
  },
  {
    id: "qualified-to-deal",
    name: "Qualified lead to deal",
    description: "When a lead becomes Qualified, open a deal and tell the managers.",
    build: () => ({
      name: "Qualified lead to deal",
      description: "Hand qualified leads to the pipeline automatically.",
      trigger: { type: "lead.status_changed", to: "Qualified" },
      conditions: { op: "and", rules: [] },
      actions: [
        { type: "create_deal", params: { title: "{{lead.company}}", stage: "Qualified", probability: 30 } },
        { type: "notify", params: { recipients: "managers", title: "New deal: {{lead.company}}", body: "Created from qualified lead {{lead.name}}." } },
      ],
    }),
  },
  {
    id: "reply-handoff",
    name: "Campaign reply handoff",
    description: "When a lead replies to a campaign, mark them Hot and create a same-day task.",
    build: () => ({
      name: "Campaign reply handoff",
      description: "Respond quickly to campaign replies.",
      trigger: { type: "campaign.replied" },
      conditions: { op: "and", rules: [] },
      actions: [
        { type: "set_status", params: { status: "Hot" } },
        { type: "add_tag", params: { tag: "replied" } },
        { type: "create_task", params: { title: "Reply to {{lead.name}}", dueInDays: 0, assignTo: "owner", priority: "high" } },
      ],
    }),
  },
  {
    id: "deal-won",
    name: "Deal won announcement",
    description: "Celebrate in Slack and notify the team when a deal is won.",
    build: () => ({
      name: "Deal won announcement",
      description: "Share wins with the team.",
      trigger: { type: "deal.stage_changed", to: "Closed Won" },
      conditions: { op: "and", rules: [] },
      actions: [
        { type: "slack", params: { message: ":tada: {{deal.title}} closed won ({{deal.value}})" } },
        { type: "notify", params: { recipients: "all", title: "Deal won: {{deal.title}}" } },
      ],
    }),
  },
  {
    id: "weekday-hot-sweep",
    name: "Weekday hot-lead sweep",
    description: "Every weekday at 9:00, create a task for each untouched high-score lead.",
    build: () => ({
      name: "Weekday hot-lead sweep",
      description: "Catch high-score leads that are still New.",
      trigger: { type: "schedule", cron: "0 9 * * 1-5", timezone: "Asia/Kolkata", scope: "leads" },
      conditions: {
        op: "and",
        rules: [
          { field: "lead.status", operator: "eq", value: "New" },
          { field: "lead.score", operator: "gte", value: 70 },
        ],
      },
      actions: [{ type: "create_task", params: { title: "Contact {{lead.name}} today", dueInDays: 0, assignTo: "owner", priority: "high" } }],
    }),
  },
];
