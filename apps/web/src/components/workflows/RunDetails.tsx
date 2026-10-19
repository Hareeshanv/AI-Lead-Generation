"use client";

import React from "react";
import { CheckCircle2, Circle, Clock, MinusCircle, XCircle } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { WorkflowConditionTrace, WorkflowRunStatus, WorkflowRunStep, WorkflowStepStatus } from "@/types";
import { OPERATORS, actionMeta } from "./catalog";

const RUN_VARIANT: Record<WorkflowRunStatus, NonNullable<BadgeProps["variant"]>> = {
  running: "indigo",
  waiting: "warning",
  succeeded: "success",
  failed: "danger",
  skipped: "secondary",
};

const RUN_LABEL: Record<WorkflowRunStatus, string> = {
  running: "Running",
  waiting: "Waiting",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
};

export const RunStatusBadge: React.FC<{ status: WorkflowRunStatus; className?: string }> = ({ status, className }) => (
  <Badge variant={RUN_VARIANT[status] ?? "secondary"} className={className}>
    {RUN_LABEL[status] ?? status}
  </Badge>
);

const STEP_ICON: Record<WorkflowStepStatus, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  pending: { icon: Circle, className: "text-muted-foreground" },
  waiting: { icon: Clock, className: "text-amber-500" },
  succeeded: { icon: CheckCircle2, className: "text-emerald-500" },
  failed: { icon: XCircle, className: "text-destructive" },
  skipped: { icon: MinusCircle, className: "text-muted-foreground" },
};

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "empty" : Array.isArray(v) ? v.join(", ") : String(v));

function stepSummary(step: WorkflowRunStep): string | null {
  const out = step.output ?? {};
  if (typeof out.preview === "string") return out.preview;
  if (typeof out.reason === "string") return out.reason;
  if (typeof out.resumeAt === "string") return `Resumes ${new Date(out.resumeAt).toLocaleString()}`;
  const parts: string[] = [];
  if (out.from !== undefined || out.to !== undefined) parts.push(`${fmt(out.from)} → ${fmt(out.to)}`);
  if (typeof out.title === "string") parts.push(`"${out.title}"`);
  if (typeof out.notified === "number") parts.push(`${out.notified} notified`);
  if (typeof out.status === "number") parts.push(`HTTP ${out.status}`);
  if (typeof out.tag === "string") parts.push(`#${out.tag}`);
  return parts.length ? parts.join(" · ") : null;
}

export const ConditionTraceView: React.FC<{ trace: WorkflowConditionTrace | null | undefined }> = ({ trace }) => {
  if (!trace) return null;
  if (trace.rules.length === 0) return <p className="text-xs text-muted-foreground">No conditions: always runs.</p>;
  return (
    <ul className="space-y-1">
      {trace.rules.map((r, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          {r.matched ? (
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />
          )}
          <span className="text-foreground">
            <code className="text-[11px]">{r.field}</code> {OPERATORS.find((o) => o.value === r.operator)?.label ?? r.operator}{" "}
            {!["is_empty", "is_not_empty"].includes(r.operator) && <strong>{fmt(r.expected)}</strong>}
            <span className="text-muted-foreground"> (actual: {fmt(r.actual)})</span>
          </span>
        </li>
      ))}
    </ul>
  );
};

export const StepList: React.FC<{ steps: WorkflowRunStep[] | undefined; className?: string }> = ({ steps, className }) => {
  if (!steps || steps.length === 0) return <p className="text-xs text-muted-foreground">No actions ran.</p>;
  return (
    <ol className={cn("space-y-2", className)}>
      {steps.map((step) => {
        const { icon: Icon, className: iconClass } = STEP_ICON[step.status] ?? STEP_ICON.pending;
        const summary = stepSummary(step);
        return (
          <li key={step.id} className="flex items-start gap-2.5">
            <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", iconClass)} />
            <div className="min-w-0 text-xs">
              <p className="font-medium text-foreground">
                {step.position + 1}. {actionMeta(step.actionType)?.label ?? step.actionType}
                <span className="ml-2 font-normal text-muted-foreground">{step.status}</span>
              </p>
              {summary && <p className="text-muted-foreground break-words">{summary}</p>}
              {step.error && <p className="text-destructive break-words">{step.error}</p>}
              {typeof step.output?.warning === "string" && <p className="text-amber-600 break-words">{step.output.warning}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
