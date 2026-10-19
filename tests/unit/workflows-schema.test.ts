import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_CONDITIONS,
  MAX_ACTIONS,
  TRIGGER_SUBJECTS,
  TRIGGER_TYPES,
  actionSchema,
  conditionGroupSchema,
  conditionRuleSchema,
  delayMs,
  nextCronDate,
  parseStoredDefinition,
  triggerSchema,
  triggerSubjects,
  validateCron,
  workflowDefinitionSchema,
  workflowPatchSchema,
} from "../../apps/api/src/workflows/schema";

const UUID = "3f6c2b1e-8d4a-4c7e-9b1a-2e5f6a7b8c9d";
const UUID2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const issues = (result: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) =>
  result.success ? [] : result.error!.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

afterEach(() => {
  vi.useRealTimers();
});

describe("triggerSchema", () => {
  it.each([
    [{ type: "lead.created" }],
    [{ type: "lead.created", source: "Website" }],
    [{ type: "lead.status_changed", from: "Warm", to: "Hot" }],
    [{ type: "lead.score_above", threshold: 80 }],
    [{ type: "deal.stage_changed", to: "Closed Won" }],
    [{ type: "campaign.replied", campaignId: UUID, channel: "whatsapp" }],
    [{ type: "agent.run_completed", status: "failed" }],
    [{ type: "schedule", cron: "0 9 * * 1-5", timezone: "Asia/Kolkata", scope: "leads" }],
  ])("accepts %j", (input) => {
    expect(triggerSchema.safeParse(input).success).toBe(true);
  });

  it("covers every trigger type", () => {
    expect(TRIGGER_TYPES).toHaveLength(7);
    expect(Object.keys(TRIGGER_SUBJECTS).sort()).toEqual([...TRIGGER_TYPES].sort());
  });

  it("normalises optional text and nulls to undefined", () => {
    expect(triggerSchema.parse({ type: "lead.status_changed", from: "", to: "  Hot  " })).toEqual({
      type: "lead.status_changed",
      from: undefined,
      to: "Hot",
    });
    expect(triggerSchema.parse({ type: "campaign.replied", campaignId: null, channel: null })).toEqual({
      type: "campaign.replied",
      campaignId: undefined,
      channel: undefined,
    });
    expect(triggerSchema.parse({ type: "agent.run_completed", status: null })).toEqual({ type: "agent.run_completed", status: undefined });
  });

  it("coerces the score threshold", () => {
    expect(triggerSchema.parse({ type: "lead.score_above", threshold: "75" })).toEqual({ type: "lead.score_above", threshold: 75 });
  });

  it("defaults schedule scope to none", () => {
    const parsed = triggerSchema.parse({ type: "schedule", cron: "0 9 * * *" });
    expect(parsed).toMatchObject({ type: "schedule", cron: "0 9 * * *", scope: "none" });
    expect(parsed.type === "schedule" && parsed.timezone).toBeFalsy();
  });

  it.each([
    [{ type: "lead.deleted" }],
    [{}],
    [{ type: "lead.score_above" }],
    [{ type: "lead.score_above", threshold: 101 }],
    [{ type: "lead.score_above", threshold: -1 }],
    [{ type: "lead.score_above", threshold: 50.5 }],
    [{ type: "lead.score_above", threshold: "abc" }],
    [{ type: "campaign.replied", campaignId: "campaign-1" }],
    [{ type: "campaign.replied", channel: "sms" }],
    [{ type: "agent.run_completed", status: "running" }],
    [{ type: "schedule" }],
    [{ type: "schedule", cron: "   " }],
    [{ type: "schedule", cron: "0 9 * * *", scope: "deals" }],
    [{ type: "lead.created", source: "x".repeat(101) }],
  ])("rejects %j", (input) => {
    expect(triggerSchema.safeParse(input).success).toBe(false);
  });
});

describe("conditionRuleSchema", () => {
  it.each([
    [{ field: "lead.score", operator: "gte", value: 80 }],
    [{ field: " deal.stage ", operator: "eq", value: "Proposal" }],
    [{ field: "event.changes.status.to", operator: "in", value: ["Hot", "Warm"] }],
    [{ field: "trigger.type", operator: "is_empty" }],
    [{ field: "lead.do_not_contact", operator: "eq", value: false }],
    [{ field: "lead.owner_id", operator: "eq", value: null }],
  ])("accepts %j", (input) => {
    expect(conditionRuleSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    [{ field: "score", operator: "eq", value: 1 }],
    [{ field: "user.name", operator: "eq", value: 1 }],
    [{ field: "lead.", operator: "eq", value: 1 }],
    [{ field: "lead.first-name", operator: "eq", value: 1 }],
    [{ field: "lead.score", operator: "between", value: 1 }],
    [{ field: "lead.score", operator: "eq", value: { min: 1 } }],
    [{ field: "lead.name", operator: "eq", value: "x".repeat(501) }],
    [{ field: "lead.tags", operator: "in", value: Array(51).fill("x") }],
    [{ field: "lead.tags", operator: "in", value: [true] }],
  ])("rejects %j", (input) => {
    expect(conditionRuleSchema.safeParse(input).success).toBe(false);
  });
});

describe("conditionGroupSchema", () => {
  it("defaults op to and and accepts nested groups", () => {
    expect(
      conditionGroupSchema.parse({ rules: [{ field: "lead.score", operator: "gt", value: 1 }, { op: "or", rules: [] }] })
    ).toEqual({ op: "and", rules: [{ field: "lead.score", operator: "gt", value: 1 }, { op: "or", rules: [] }] });
  });

  it("rejects invalid ops, missing rules and too many rules", () => {
    expect(conditionGroupSchema.safeParse({ op: "xor", rules: [] }).success).toBe(false);
    expect(conditionGroupSchema.safeParse({ op: "and" }).success).toBe(false);
    const rules = Array.from({ length: 26 }, () => ({ field: "lead.score", operator: "gt", value: 1 }));
    expect(conditionGroupSchema.safeParse({ rules }).success).toBe(false);
    expect(conditionGroupSchema.safeParse({ rules: rules.slice(0, 25) }).success).toBe(true);
  });

  it("rejects invalid nested rules", () => {
    expect(conditionGroupSchema.safeParse({ rules: [{ op: "or", rules: [{ field: "bad", operator: "eq" }] }] }).success).toBe(false);
  });
});

describe("actionSchema", () => {
  it.each([
    [{ type: "assign_owner", params: { ownerId: UUID } }],
    [{ type: "assign_owner", params: { ownerId: UUID, target: "deal" } }],
    [{ type: "set_status", params: { status: "Qualified" } }],
    [{ type: "set_stage", params: { stage: "Proposal" } }],
    [{ type: "add_tag", params: { tag: "hot-lead" } }],
    [{ type: "create_task", params: { title: "Call back" } }],
    [{ type: "create_deal", params: {} }],
    [{ type: "add_to_campaign", params: { campaignId: UUID } }],
    [{ type: "notify", params: { title: "New hot lead" } }],
    [{ type: "slack", params: { message: "{{lead.name}} is hot" } }],
    [{ type: "webhook", params: { url: "https://hooks.example.com/x" } }],
    [{ type: "webhook", params: {} }],
    [{ type: "delay", params: { amount: 2 } }],
  ])("accepts %j", (input) => {
    expect(actionSchema.safeParse(input).success).toBe(true);
  });

  it("applies defaults", () => {
    expect(actionSchema.parse({ type: "assign_owner", params: { ownerId: UUID } })).toEqual({
      type: "assign_owner",
      params: { ownerId: UUID, target: "lead" },
    });
    expect(actionSchema.parse({ type: "create_task", params: { title: " Call ", dueInDays: "3", description: "" } })).toEqual({
      type: "create_task",
      params: { title: "Call", dueInDays: 3, description: undefined, assignTo: "owner", assigneeId: undefined, priority: "normal" },
    });
    expect(actionSchema.parse({ type: "notify", params: { title: "Hi" } })).toMatchObject({ params: { recipients: "owner" } });
    expect(actionSchema.parse({ type: "webhook", params: { url: "" } })).toEqual({
      type: "webhook",
      params: { url: undefined, includeContext: true },
    });
    expect(actionSchema.parse({ type: "delay", params: { amount: "3" } })).toEqual({ type: "delay", params: { amount: 3, unit: "hours" } });
    expect(actionSchema.parse({ type: "create_deal", params: { value: "2500", probability: null } })).toMatchObject({
      params: { value: 2500, probability: undefined },
    });
  });

  it.each([
    [{ type: "unknown", params: {} }],
    [{ type: "assign_owner", params: {} }],
    [{ type: "assign_owner", params: { ownerId: "me" } }],
    [{ type: "assign_owner", params: { ownerId: UUID, target: "campaign" } }],
    [{ type: "set_status", params: { status: "  " } }],
    [{ type: "set_stage", params: {} }],
    [{ type: "add_tag", params: { tag: "x".repeat(51) } }],
    [{ type: "create_task", params: { title: "" } }],
    [{ type: "create_task", params: { title: "Call", dueInDays: 366 } }],
    [{ type: "create_task", params: { title: "Call", priority: "urgent" } }],
    [{ type: "create_deal", params: { value: -1 } }],
    [{ type: "create_deal", params: { probability: 101 } }],
    [{ type: "add_to_campaign", params: { campaignId: "c1" } }],
    [{ type: "notify", params: { title: "Hi", recipients: "everyone" } }],
    [{ type: "slack", params: { message: "" } }],
    [{ type: "webhook", params: { url: "http://hooks.example.com/x" } }],
    [{ type: "webhook", params: { url: "not a url" } }],
    [{ type: "delay", params: { amount: 0 } }],
    [{ type: "delay", params: { amount: 1.5 } }],
    [{ type: "delay", params: { amount: 1, unit: "weeks" } }],
    [{ type: "set_status" }],
  ])("rejects %j", (input) => {
    expect(actionSchema.safeParse(input).success).toBe(false);
  });

  it("explains a missing owner", () => {
    expect(issues(actionSchema.safeParse({ type: "assign_owner", params: {} }))).toEqual([
      { path: "params.ownerId", message: "Owner is required" },
    ]);
  });
});

describe("delayMs", () => {
  it("converts each unit", () => {
    expect(delayMs({ amount: 5, unit: "minutes" })).toBe(300_000);
    expect(delayMs({ amount: 2, unit: "hours" })).toBe(7_200_000);
    expect(delayMs({ amount: 1, unit: "days" })).toBe(86_400_000);
  });
});

describe("triggerSubjects", () => {
  it("returns what each trigger provides", () => {
    expect(triggerSubjects({ type: "lead.created" })).toEqual(["lead"]);
    expect(triggerSubjects({ type: "deal.stage_changed" })).toEqual(["deal", "lead"]);
    expect(triggerSubjects({ type: "agent.run_completed" })).toEqual([]);
  });

  it("depends on scope for schedules", () => {
    expect(triggerSubjects({ type: "schedule", cron: "0 9 * * *", scope: "leads" })).toEqual(["lead"]);
    expect(triggerSubjects({ type: "schedule", cron: "0 9 * * *", scope: "none" })).toEqual([]);
  });
});

describe("nextCronDate", () => {
  const after = new Date("2026-03-02T10:00:00Z");

  it("returns the next fire time in UTC by default", () => {
    expect(nextCronDate("0 9 * * *", undefined, after).toISOString()).toBe("2026-03-03T09:00:00.000Z");
    expect(nextCronDate("*/15 * * * *", undefined, after).toISOString()).toBe("2026-03-02T10:15:00.000Z");
  });

  it("honours the time zone", () => {
    expect(nextCronDate("0 9 * * *", "Asia/Kolkata", after).toISOString()).toBe("2026-03-03T03:30:00.000Z");
  });

  it("throws on invalid expressions", () => {
    expect(() => nextCronDate("not a cron", undefined, after)).toThrow();
    expect(() => nextCronDate("61 * * * *", undefined, after)).toThrow();
  });
});

describe("validateCron", () => {
  it.each(["0 9 * * 1-5", "*/5 * * * *", "0 */6 * * *", "30 8 1 * *", "0,30 * * * *"])("accepts %s", (cron) => {
    expect(validateCron(cron)).toBeNull();
    expect(validateCron(cron, "Asia/Kolkata")).toBeNull();
  });

  it.each(["* * * * *", "*/2 * * * *", "*/4 * * * *", "0-10 9 * * *"])("rejects %s as too frequent", (cron) => {
    expect(validateCron(cron)).toBe("Schedules can run at most every 5 minutes");
  });

  it("rejects uneven schedules with a short gap regardless of the current time", () => {
    vi.useFakeTimers({ now: new Date("2026-03-02T10:01:00Z") });
    expect(validateCron("0,3 * * * *")).toBe("Schedules can run at most every 5 minutes");
    expect(validateCron("1,58 9,10 * * *")).toBe("Schedules can run at most every 5 minutes");
  });

  it("rejects invalid expressions and time zones", () => {
    expect(validateCron("not a cron")).toMatch(/^Invalid cron expression/);
    expect(validateCron("0 25 * * *")).toMatch(/^Invalid cron expression/);
    expect(validateCron("0 9 * * *", "Mars/Olympus")).toBe("Unsupported time zone");
  });
});

describe("workflowDefinitionSchema", () => {
  const base = {
    name: "Hot lead follow-up",
    trigger: { type: "lead.created" },
    actions: [{ type: "set_status", params: { status: "Contacted" } }],
  };
  const parse = (overrides: Record<string, unknown>) => workflowDefinitionSchema.safeParse({ ...base, ...overrides });

  it("accepts a minimal definition and defaults the conditions", () => {
    const result = workflowDefinitionSchema.parse(base);
    expect(result.conditions).toEqual(EMPTY_CONDITIONS);
    expect(result.name).toBe("Hot lead follow-up");
  });

  it("accepts optional description and enabled", () => {
    expect(parse({ description: null, enabled: false }).success).toBe(true);
  });

  it("rejects unknown keys, empty names and bad action counts", () => {
    expect(issues(parse({ owner: "me" }))[0].path).toBe("");
    expect(issues(parse({ name: "  " }))).toEqual([{ path: "name", message: "Name is required" }]);
    expect(issues(parse({ actions: [] }))).toEqual([{ path: "actions", message: "Add at least one action" }]);
    const tooMany = Array.from({ length: MAX_ACTIONS + 1 }, () => base.actions[0]);
    expect(issues(parse({ actions: tooMany }))).toEqual([{ path: "actions", message: "Use at most 20 actions" }]);
    expect(parse({ actions: tooMany.slice(0, MAX_ACTIONS) }).success).toBe(true);
  });

  describe("subjects", () => {
    it("rejects deal actions without a deal", () => {
      expect(issues(parse({ actions: [{ type: "set_stage", params: { stage: "Proposal" } }] }))).toEqual([
        {
          path: "actions.0.type",
          message: 'This action needs a deal: use a deal trigger or add a "Create deal" action before it',
        },
      ]);
      expect(issues(parse({ actions: [{ type: "assign_owner", params: { ownerId: UUID, target: "deal" } }] }))[0].path).toBe(
        "actions.0.type"
      );
    });

    it("accepts deal actions after create_deal or with a deal trigger", () => {
      expect(
        parse({
          actions: [
            { type: "create_deal", params: {} },
            { type: "set_stage", params: { stage: "Proposal" } },
          ],
        }).success
      ).toBe(true);
      expect(parse({ trigger: { type: "deal.stage_changed" }, actions: [{ type: "set_stage", params: { stage: "Won" } }] }).success).toBe(
        true
      );
    });

    it("rejects a deal action placed before create_deal", () => {
      const result = parse({
        actions: [
          { type: "set_stage", params: { stage: "Proposal" } },
          { type: "create_deal", params: {} },
        ],
      });
      expect(issues(result).map((i) => i.path)).toEqual(["actions.0.type"]);
    });

    it("rejects lead actions for triggers without a lead", () => {
      const result = parse({ trigger: { type: "agent.run_completed" }, actions: [{ type: "add_tag", params: { tag: "x" } }] });
      expect(issues(result)).toEqual([{ path: "actions.0.type", message: "This action needs a lead, but the trigger doesn't provide one" }]);
    });

    it("allows lead actions for lead-scoped schedules and lead-free actions for any trigger", () => {
      expect(
        parse({ trigger: { type: "schedule", cron: "0 9 * * *", scope: "leads" }, actions: [{ type: "add_tag", params: { tag: "x" } }] }).success
      ).toBe(true);
      expect(parse({ trigger: { type: "schedule", cron: "0 9 * * *" }, actions: [{ type: "add_tag", params: { tag: "x" } }] }).success).toBe(
        false
      );
      expect(
        parse({ trigger: { type: "agent.run_completed" }, actions: [{ type: "notify", params: { title: "Run done", recipients: "admins" } }] })
          .success
      ).toBe(true);
    });
  });

  it("validates the schedule cron", () => {
    const result = parse({ trigger: { type: "schedule", cron: "* * * * *" }, actions: [{ type: "slack", params: { message: "hi" } }] });
    expect(issues(result)).toEqual([{ path: "trigger.cron", message: "Schedules can run at most every 5 minutes" }]);
  });

  it("limits condition nesting to 3 levels", () => {
    const leaf = { field: "lead.score", operator: "gt", value: 1 };
    const depth3 = { op: "and", rules: [leaf, { op: "or", rules: [{ op: "and", rules: [leaf] }] }] };
    const depth4 = { op: "and", rules: [{ op: "or", rules: [{ op: "and", rules: [{ op: "or", rules: [leaf] }] }] }] };
    expect(parse({ conditions: depth3 }).success).toBe(true);
    expect(issues(parse({ conditions: depth4 }))).toEqual([
      { path: "conditions", message: "Condition groups can be nested at most 3 levels deep" },
    ]);
  });

  it("requires a user for user notifications and user-assigned tasks", () => {
    expect(issues(parse({ actions: [{ type: "notify", params: { title: "Hi", recipients: "user" } }] }))).toEqual([
      { path: "actions.0.params.userId", message: "Pick a user" },
    ]);
    expect(parse({ actions: [{ type: "notify", params: { title: "Hi", recipients: "user", userId: UUID } }] }).success).toBe(true);
    expect(issues(parse({ actions: [{ type: "create_task", params: { title: "Call", assignTo: "user" } }] }))).toEqual([
      { path: "actions.0.params.assigneeId", message: "Pick an assignee" },
    ]);
    expect(parse({ actions: [{ type: "create_task", params: { title: "Call", assignTo: "user", assigneeId: UUID2 } }] }).success).toBe(true);
  });

  it("requires an action after a delay", () => {
    expect(issues(parse({ actions: [base.actions[0], { type: "delay", params: { amount: 1 } }] }))).toEqual([
      { path: "actions.1.type", message: "A delay must be followed by another action" },
    ]);
    expect(parse({ actions: [{ type: "delay", params: { amount: 1 } }, base.actions[0]] }).success).toBe(true);
  });

  it("caps total delay at 30 days", () => {
    const delay = (amount: number, unit: string) => ({ type: "delay", params: { amount, unit } });
    expect(parse({ actions: [delay(30, "days"), base.actions[0]] }).success).toBe(true);
    expect(parse({ actions: [delay(29, "days"), delay(24, "hours"), base.actions[0]] }).success).toBe(true);
    expect(issues(parse({ actions: [delay(29, "days"), delay(1441, "minutes"), base.actions[0]] }))).toEqual([
      { path: "actions", message: "Delays can add up to at most 30 days" },
    ]);
  });
});

describe("workflowPatchSchema", () => {
  it("accepts partial updates and leaves nested parts to the full schema", () => {
    expect(workflowPatchSchema.safeParse({}).success).toBe(true);
    expect(workflowPatchSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(workflowPatchSchema.safeParse({ trigger: "anything", actions: 1 }).success).toBe(true);
  });

  it("rejects bad names and unknown keys", () => {
    expect(workflowPatchSchema.safeParse({ name: "" }).success).toBe(false);
    expect(workflowPatchSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(workflowPatchSchema.safeParse({ org_id: UUID }).success).toBe(false);
  });
});

describe("parseStoredDefinition", () => {
  it("parses a stored row and fills defaults", () => {
    const result = parseStoredDefinition({
      name: "",
      trigger: { type: "lead.created" },
      conditions: null,
      actions: [{ type: "add_tag", params: { tag: "new" } }],
    });
    expect(result).toEqual({
      ok: true,
      definition: {
        name: "Untitled workflow",
        trigger: { type: "lead.created", source: undefined },
        conditions: EMPTY_CONDITIONS,
        actions: [{ type: "add_tag", params: { tag: "new" } }],
      },
    });
  });

  it("reports the first issue with its path", () => {
    expect(parseStoredDefinition({ name: "x", trigger: { type: "lead.created" }, conditions: null, actions: [] })).toEqual({
      ok: false,
      error: "actions: Add at least one action",
    });
    const badTrigger = parseStoredDefinition({ name: "x", trigger: null, conditions: null, actions: [] });
    expect(badTrigger.ok).toBe(false);
    expect(!badTrigger.ok && badTrigger.error.startsWith("trigger:")).toBe(true);
  });
});
