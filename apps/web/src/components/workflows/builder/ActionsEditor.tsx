"use client";

import React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { selectClassName } from "@/components/settings/shared";
import { cn } from "@/lib/utils";
import type { WorkflowAction, WorkflowActionType } from "@/types";
import { ACTIONS, actionMeta, defaultParams } from "../catalog";
import { ActionFields, type ActionFieldOptions } from "./ActionFields";
import type { ErrorLookup } from "./fields";

const MAX_ACTIONS = 20;

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Ordered action list: type picker, reorder/remove, and each action's parameters. */
export function ActionsEditor({
  actions,
  setActions,
  err,
  options,
}: {
  actions: WorkflowAction[];
  setActions: (fn: (actions: WorkflowAction[]) => WorkflowAction[]) => void;
  err: ErrorLookup;
  options: ActionFieldOptions;
}) {
  const setParam = (index: number, key: string, value: unknown) =>
    setActions((list) => list.map((a, i) => (i === index ? { ...a, params: { ...a.params, [key]: value } } : a)));

  return (
    <>
      {err("actions") && <p className="text-[11px] text-destructive">{err("actions")}</p>}
      <div className="space-y-3">
        {actions.map((action, i) => {
          const typeError = err(`actions.${i}.type`);
          return (
            <div key={i} className={cn("rounded-lg border bg-background p-4 space-y-3", typeError ? "border-destructive/50" : "border-border")}>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <select
                  aria-label={`Action ${i + 1} type`}
                  className={cn(selectClassName, "h-9")}
                  value={action.type}
                  onChange={(e) =>
                    setActions((list) =>
                      list.map((a, j) => (j === i ? { type: e.target.value as WorkflowActionType, params: defaultParams(e.target.value as WorkflowActionType) } : a))
                    )
                  }
                >
                  {ACTIONS.map((a) => (
                    <option key={a.type} value={a.type}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center">
                  <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => setActions((list) => swap(list, i, i - 1))}>
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move down"
                    disabled={i === actions.length - 1}
                    onClick={() => setActions((list) => swap(list, i, i + 1))}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove action" onClick={() => setActions((list) => list.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{actionMeta(action.type)?.description}</p>
              {typeError && <p className="text-[11px] text-destructive">{typeError}</p>}
              <ActionFields action={action} index={i} setParam={setParam} err={err} options={options} />
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={actions.length >= MAX_ACTIONS}
        onClick={() => setActions((list) => [...list, { type: "notify", params: defaultParams("notify") }])}
      >
        <Plus className="w-3.5 h-3.5" /> Add action
      </Button>
    </>
  );
}
