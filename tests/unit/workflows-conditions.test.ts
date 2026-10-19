import { describe, expect, it } from "vitest";
import {
  evaluateConditions,
  evaluateRule,
  explainConditions,
  getField,
  renderTemplate,
  type WorkflowContext,
} from "../../apps/api/src/workflows/conditions";
import type { ConditionGroup, ConditionRule } from "../../apps/api/src/workflows/schema";

const ctx: WorkflowContext = {
  lead: {
    name: "Asha Rao",
    score: 82,
    status: "Hot",
    email: "asha@example.com",
    tags: ["neet", "Bengaluru"],
    phone: null,
    notes: "  ",
    created_at: "2026-03-02T10:00:00Z",
    do_not_contact: false,
    address: { city: "Bengaluru" },
  },
  deal: { stage: "Proposal", value: "50000" },
  event: { changes: { status: { from: "Warm", to: "Hot" } }, campaignId: "c1" },
  trigger: { type: "lead.status_changed", event: "lead.updated" },
};

const rule = (operator: ConditionRule["operator"], value?: ConditionRule["value"]): ConditionRule => ({ field: "x.y", operator, value });
const check = (operator: ConditionRule["operator"], actual: unknown, value?: ConditionRule["value"]) =>
  evaluateRule(rule(operator, value), actual);

describe("getField", () => {
  it("reads dotted paths", () => {
    expect(getField(ctx, "lead.score")).toBe(82);
    expect(getField(ctx, "event.changes.status.to")).toBe("Hot");
    expect(getField(ctx, "trigger.type")).toBe("lead.status_changed");
    expect(getField(ctx, "lead.tags")).toEqual(["neet", "Bengaluru"]);
  });

  it("returns undefined for missing paths and null records", () => {
    expect(getField(ctx, "lead.missing")).toBeUndefined();
    expect(getField(ctx, "lead.name.first")).toBeUndefined();
    expect(getField(ctx, "lead.phone.digits")).toBeUndefined();
    expect(getField({ ...ctx, deal: null }, "deal.stage")).toBeUndefined();
    expect(getField(ctx, "nothing.here")).toBeUndefined();
  });
});

describe("evaluateRule", () => {
  describe("eq / neq", () => {
    it("compares numbers loosely", () => {
      expect(check("eq", 82, "82")).toBe(true);
      expect(check("eq", "82.0", 82)).toBe(true);
      expect(check("eq", 82, 81)).toBe(false);
      expect(check("neq", 82, "81")).toBe(true);
    });

    it("compares strings case- and space-insensitively", () => {
      expect(check("eq", "Hot", " hot ")).toBe(true);
      expect(check("eq", "Hot", "Warm")).toBe(false);
      expect(check("neq", "Hot", "HOT")).toBe(false);
    });

    it("compares booleans with their string forms", () => {
      expect(check("eq", false, "false")).toBe(true);
      expect(check("eq", true, "TRUE")).toBe(true);
      expect(check("eq", true, false)).toBe(false);
      expect(check("neq", false, "true")).toBe(true);
    });

    it("matches nulls only with nulls", () => {
      expect(check("eq", null, null)).toBe(true);
      expect(check("eq", null, "")).toBe(false);
      expect(check("eq", "", 0)).toBe(false);
    });

    it("checks membership for arrays", () => {
      expect(check("eq", ["neet", "jee"], "NEET")).toBe(true);
      expect(check("eq", ["neet"], "jee")).toBe(false);
      expect(check("neq", ["neet"], "jee")).toBe(true);
      expect(check("neq", ["neet"], "neet")).toBe(false);
    });
  });

  describe("gt / gte / lt / lte", () => {
    it("compares numbers including numeric strings", () => {
      expect(check("gt", 82, 80)).toBe(true);
      expect(check("gt", 80, 80)).toBe(false);
      expect(check("gte", 80, "80")).toBe(true);
      expect(check("lt", "9", 10)).toBe(true);
      expect(check("lte", 10, 10)).toBe(true);
      expect(check("lte", 11, 10)).toBe(false);
    });

    it("compares ISO dates", () => {
      expect(check("gt", "2026-03-02T10:00:00Z", "2026-03-01")).toBe(true);
      expect(check("lt", "2026-03-02", "2026-03-02T00:00:01Z")).toBe(true);
      expect(check("gte", "2026-03-02T00:00:00Z", "2026-03-02")).toBe(true);
    });

    it("compares other strings alphabetically, ignoring case", () => {
      expect(check("lt", "apple", "Banana")).toBe(true);
      expect(check("gte", "b", "B")).toBe(true);
    });

    it("is false for empty or incomparable values", () => {
      for (const op of ["gt", "gte", "lt", "lte"] as const) {
        expect(check(op, null, 1)).toBe(false);
        expect(check(op, undefined, 1)).toBe(false);
        expect(check(op, "", 1)).toBe(false);
        expect(check(op, [], 1)).toBe(false);
        expect(check(op, true, 1)).toBe(false);
        expect(check(op, 5, null)).toBe(false);
      }
    });
  });

  describe("contains / not_contains", () => {
    it("checks substrings case-insensitively", () => {
      expect(check("contains", "Asha Rao", "rao")).toBe(true);
      expect(check("contains", "Asha Rao", "ravi")).toBe(false);
      expect(check("contains", 12345, 234)).toBe(true);
      expect(check("not_contains", "Asha Rao", "ravi")).toBe(true);
    });

    it("checks array membership", () => {
      expect(check("contains", ["neet", "Bengaluru"], "bengaluru")).toBe(true);
      expect(check("contains", ["neet"], "ne")).toBe(false);
      expect(check("not_contains", ["neet"], "jee")).toBe(true);
    });

    it("is false for null operands", () => {
      expect(check("contains", null, "x")).toBe(false);
      expect(check("contains", "x", null)).toBe(false);
      expect(check("not_contains", null, "x")).toBe(true);
    });
  });

  describe("starts_with / ends_with", () => {
    it("checks prefixes and suffixes case-insensitively", () => {
      expect(check("starts_with", "Asha Rao", "ASH")).toBe(true);
      expect(check("starts_with", "Asha Rao", "Rao")).toBe(false);
      expect(check("ends_with", "asha@Example.com", "example.COM")).toBe(true);
      expect(check("ends_with", "asha@example.com", "gmail.com")).toBe(false);
      expect(check("starts_with", 9845012345, 98)).toBe(true);
    });

    it("is false for null operands", () => {
      expect(check("starts_with", null, "a")).toBe(false);
      expect(check("ends_with", "a", undefined)).toBe(false);
    });
  });

  describe("in / not_in", () => {
    it("accepts arrays or comma-separated lists", () => {
      expect(check("in", "Hot", ["Warm", "hot"])).toBe(true);
      expect(check("in", "Hot", "Warm, Hot")).toBe(true);
      expect(check("in", 82, [80, 82])).toBe(true);
      expect(check("in", "82", "80,82")).toBe(true);
      expect(check("in", "Cold", "Warm, Hot")).toBe(false);
      expect(check("not_in", "Cold", "Warm, Hot")).toBe(true);
      expect(check("not_in", "Hot", ["Hot"])).toBe(false);
    });

    it("matches arrays on any overlap", () => {
      expect(check("in", ["neet", "jee"], "JEE,cuet")).toBe(true);
      expect(check("in", ["neet"], "jee")).toBe(false);
      expect(check("not_in", ["neet", "jee"], ["jee"])).toBe(false);
      expect(check("not_in", ["neet"], ["jee"])).toBe(true);
    });

    it("treats a missing list as empty", () => {
      expect(check("in", "Hot", undefined)).toBe(false);
      expect(check("in", "Hot", null)).toBe(false);
      expect(check("in", "Hot", "")).toBe(false);
      expect(check("not_in", "Hot", undefined)).toBe(true);
      expect(check("in", 5, 5)).toBe(true);
    });
  });

  describe("is_empty / is_not_empty", () => {
    it.each([undefined, null, "", "   ", []])("%j is empty", (v) => {
      expect(check("is_empty", v)).toBe(true);
      expect(check("is_not_empty", v)).toBe(false);
    });

    it.each([0, false, "x", ["x"], {}])("%j is not empty", (v) => {
      expect(check("is_empty", v)).toBe(false);
      expect(check("is_not_empty", v)).toBe(true);
    });
  });

  it("is false for unknown operators", () => {
    expect(evaluateRule({ field: "lead.x", operator: "matches" as ConditionRule["operator"], value: "x" }, "x")).toBe(false);
  });
});

describe("evaluateConditions", () => {
  it("matches empty or missing groups", () => {
    expect(evaluateConditions(null, ctx)).toBe(true);
    expect(evaluateConditions(undefined, ctx)).toBe(true);
    expect(evaluateConditions({ op: "and", rules: [] }, ctx)).toBe(true);
    expect(evaluateConditions({ op: "or", rules: [] }, ctx)).toBe(true);
  });

  it("requires every rule for and", () => {
    const group: ConditionGroup = {
      op: "and",
      rules: [
        { field: "lead.score", operator: "gte", value: 80 },
        { field: "lead.status", operator: "eq", value: "hot" },
      ],
    };
    expect(evaluateConditions(group, ctx)).toBe(true);
    expect(evaluateConditions(group, { ...ctx, lead: { ...ctx.lead, score: 79 } })).toBe(false);
  });

  it("requires any rule for or", () => {
    const group: ConditionGroup = {
      op: "or",
      rules: [
        { field: "lead.score", operator: "gt", value: 90 },
        { field: "deal.stage", operator: "eq", value: "Proposal" },
      ],
    };
    expect(evaluateConditions(group, ctx)).toBe(true);
    expect(evaluateConditions(group, { ...ctx, deal: null })).toBe(false);
  });

  it("evaluates nested groups", () => {
    const group: ConditionGroup = {
      op: "and",
      rules: [
        { field: "event.changes.status.to", operator: "eq", value: "Hot" },
        {
          op: "or",
          rules: [
            { field: "lead.tags", operator: "contains", value: "jee" },
            { field: "lead.address.city", operator: "in", value: "Mysuru, Bengaluru" },
          ],
        },
      ],
    };
    expect(evaluateConditions(group, ctx)).toBe(true);
    expect(evaluateConditions(group, { ...ctx, lead: { ...ctx.lead, address: { city: "Pune" } } })).toBe(false);
  });

  it("handles a missing lead", () => {
    expect(evaluateConditions({ op: "and", rules: [{ field: "lead.email", operator: "is_empty" }] }, { ...ctx, lead: null })).toBe(true);
  });
});

describe("explainConditions", () => {
  it("traces every evaluated rule, including nested ones", () => {
    const group: ConditionGroup = {
      op: "or",
      rules: [
        { field: "lead.score", operator: "gt", value: 90 },
        { op: "and", rules: [{ field: "lead.phone", operator: "is_empty" }] },
        { field: "lead.missing", operator: "eq", value: "x" },
      ],
    };
    expect(explainConditions(group, ctx)).toEqual({
      matched: true,
      rules: [
        { field: "lead.score", operator: "gt", expected: 90, actual: 82, matched: false },
        { field: "lead.phone", operator: "is_empty", expected: null, actual: null, matched: true },
        { field: "lead.missing", operator: "eq", expected: "x", actual: null, matched: false },
      ],
    });
  });

  it("returns an empty trace for no conditions", () => {
    expect(explainConditions(null, ctx)).toEqual({ matched: true, rules: [] });
  });
});

describe("renderTemplate", () => {
  it("replaces placeholders with context values", () => {
    expect(renderTemplate("{{lead.name}} ({{ lead.score }}) moved to {{event.changes.status.to}}", ctx)).toBe("Asha Rao (82) moved to Hot");
  });

  it("formats arrays, objects, booleans and missing values", () => {
    expect(renderTemplate("{{lead.tags}}", ctx)).toBe("neet, Bengaluru");
    expect(renderTemplate("{{lead.address}}", ctx)).toBe('{"city":"Bengaluru"}');
    expect(renderTemplate("{{lead.do_not_contact}}", ctx)).toBe("false");
    expect(renderTemplate("[{{lead.unknown}}][{{lead.phone}}]", ctx)).toBe("[][]");
  });

  it("leaves text without valid placeholders untouched", () => {
    expect(renderTemplate("Hi {name} {{ lead name }}", ctx)).toBe("Hi {name} {{ lead name }}");
  });
});
