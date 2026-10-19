import type { ConditionGroup, ConditionRule } from "./schema";

/** Pure: no I/O. Everything a condition or template can read. */
export interface WorkflowContext {
  lead: Record<string, any> | null;
  deal: Record<string, any> | null;
  /** The domain event payload that started the run. */
  event: Record<string, any>;
  trigger: { type: string; event: string | null };
}

export interface RuleTrace {
  field: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  matched: boolean;
}

export interface ConditionTrace {
  matched: boolean;
  rules: RuleTrace[];
}

/** Reads a dotted path ("lead.score", "event.changes.status.to") from the context. */
export function getField(ctx: WorkflowContext, path: string): unknown {
  let current: any = ctx;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
function toTime(v: unknown): number | null {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);

function looseEquals(a: unknown, b: unknown): boolean {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) return an === bn;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a).toLowerCase() === String(b).toLowerCase();
  return norm(a) === norm(b);
}

function compare(a: unknown, b: unknown): number | null {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) return an - bn;
  const at = toTime(a);
  const bt = toTime(b);
  if (at !== null && bt !== null) return at - bt;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, undefined, { sensitivity: "base" });
  return null;
}

/** "a, b" or ["a","b"] -> list. */
function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return v == null ? [] : [v];
}

function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => looseEquals(item, expected));
  if (actual == null || expected == null) return false;
  return String(actual).toLowerCase().includes(String(expected).toLowerCase());
}

export function evaluateRule(rule: ConditionRule, actual: unknown): boolean {
  const expected = rule.value;
  switch (rule.operator) {
    case "eq":
      return Array.isArray(actual) ? contains(actual, expected) : looseEquals(actual, expected);
    case "neq":
      return Array.isArray(actual) ? !contains(actual, expected) : !looseEquals(actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (isEmpty(actual)) return false;
      const c = compare(actual, expected);
      if (c === null) return false;
      return rule.operator === "gt" ? c > 0 : rule.operator === "gte" ? c >= 0 : rule.operator === "lt" ? c < 0 : c <= 0;
    }
    case "contains":
      return contains(actual, expected);
    case "not_contains":
      return !contains(actual, expected);
    case "starts_with":
      return actual != null && expected != null && String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
    case "ends_with":
      return actual != null && expected != null && String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
    case "in": {
      const list = asList(expected);
      return Array.isArray(actual)
        ? actual.some((a) => list.some((e) => looseEquals(a, e)))
        : list.some((e) => looseEquals(actual, e));
    }
    case "not_in": {
      const list = asList(expected);
      return Array.isArray(actual)
        ? !actual.some((a) => list.some((e) => looseEquals(a, e)))
        : !list.some((e) => looseEquals(actual, e));
    }
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    default:
      return false;
  }
}

const isGroup = (r: ConditionRule | ConditionGroup): r is ConditionGroup => Array.isArray((r as ConditionGroup).rules);

function evaluateGroup(group: ConditionGroup, ctx: WorkflowContext, trace: RuleTrace[] | null): boolean {
  if (!group || !Array.isArray(group.rules) || group.rules.length === 0) return true;
  const results = group.rules.map((rule) => {
    if (isGroup(rule)) return evaluateGroup(rule, ctx, trace);
    const actual = getField(ctx, rule.field);
    const matched = evaluateRule(rule, actual);
    trace?.push({ field: rule.field, operator: rule.operator, expected: rule.value ?? null, actual: actual ?? null, matched });
    return matched;
  });
  return group.op === "or" ? results.some(Boolean) : results.every(Boolean);
}

/** True when the context satisfies the group. An empty group always matches. */
export function evaluateConditions(group: ConditionGroup | null | undefined, ctx: WorkflowContext): boolean {
  return evaluateGroup(group ?? { op: "and", rules: [] }, ctx, null);
}

/** Like evaluateConditions, plus the per-rule results (shown in test runs and skipped runs). */
export function explainConditions(group: ConditionGroup | null | undefined, ctx: WorkflowContext): ConditionTrace {
  const rules: RuleTrace[] = [];
  const matched = evaluateGroup(group ?? { op: "and", rules: [] }, ctx, rules);
  return { matched, rules };
}

/** Replaces {{lead.name}}-style placeholders; unknown fields render as an empty string. */
export function renderTemplate(template: string, ctx: WorkflowContext): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
    const value = getField(ctx, path);
    if (value == null) return "";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}
