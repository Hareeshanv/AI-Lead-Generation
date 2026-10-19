"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { selectClassName } from "@/components/settings/shared";
import { cn } from "@/lib/utils";
import type { WorkflowConditionOperator, WorkflowConditionRule, WorkflowInput } from "@/types";
import { CONDITION_FIELDS, OPERATORS, isRule, isUnary } from "../catalog";
import type { ErrorLookup } from "./fields";

type Conditions = WorkflowInput["conditions"];
type Rules = Conditions["rules"];

/** Flat AND/OR rule list; nested groups (API-only) are kept untouched. */
export function ConditionsEditor({
  conditions,
  onOpChange,
  setRules,
  defaultField,
  err,
}: {
  conditions: Conditions;
  onOpChange: (op: Conditions["op"]) => void;
  setRules: (fn: (rules: Rules) => Rules) => void;
  /** Field for a newly added rule. */
  defaultField: string;
  err: ErrorLookup;
}) {
  const nestedGroups = conditions.rules.filter((r) => !isRule(r)).length;
  return (
    <>
      {conditions.rules.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Match</span>
          {(["and", "or"] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => onOpChange(op)}
              className={cn(
                "px-2.5 py-1 rounded-md border font-medium",
                conditions.op === op ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {op === "and" ? "All conditions" : "Any condition"}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {conditions.rules.map((rule, i) => {
          if (!isRule(rule)) return null;
          const unary = isUnary(rule.operator);
          const knownField = CONDITION_FIELDS.some((f) => f.value === rule.field);
          const update = (patch: Partial<WorkflowConditionRule>) =>
            setRules((rules) => rules.map((r, j) => (j === i ? { ...(r as WorkflowConditionRule), ...patch } : r)));
          return (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-start">
              <div>
                <select aria-label="Field" className={selectClassName} value={rule.field} onChange={(e) => update({ field: e.target.value })}>
                  <option value="">Pick a field</option>
                  {!knownField && rule.field && <option value={rule.field}>{rule.field}</option>}
                  {CONDITION_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                {err(`conditions.rules.${i}.field`) && <p className="text-[11px] text-destructive mt-1">{err(`conditions.rules.${i}.field`)}</p>}
              </div>
              <select
                aria-label="Operator"
                className={selectClassName}
                value={rule.operator}
                onChange={(e) => update({ operator: e.target.value as WorkflowConditionOperator })}
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div>
                {!unary && (
                  <Input
                    aria-label="Value"
                    value={rule.value == null ? "" : Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value)}
                    onChange={(e) => update({ value: e.target.value })}
                  />
                )}
                {err(`conditions.rules.${i}.value`) && <p className="text-[11px] text-destructive mt-1">{err(`conditions.rules.${i}.value`)}</p>}
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove condition" onClick={() => setRules((rules) => rules.filter((_, j) => j !== i))}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
        {nestedGroups > 0 && (
          <p className="text-xs text-muted-foreground">
            Plus {nestedGroups} nested condition group{nestedGroups > 1 ? "s" : ""} (kept as is; edit through the API).
          </p>
        )}
        {err("conditions") && <p className="text-[11px] text-destructive">{err("conditions")}</p>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRules((rules) => [...rules, { field: defaultField, operator: "gte", value: "" }])}
      >
        <Plus className="w-3.5 h-3.5" /> Add condition
      </Button>
    </>
  );
}
