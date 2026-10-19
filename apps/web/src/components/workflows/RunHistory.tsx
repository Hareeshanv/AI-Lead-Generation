"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { QueryState, LoadingState, ErrorState } from "@/components/ui/QueryState";
import { selectClassName } from "@/components/settings/shared";
import { useWorkflowRun, useWorkflowRuns } from "@/hooks";
import type { WorkflowRunStatus } from "@/types";
import { ConditionTraceView, RunStatusBadge, StepList } from "./RunDetails";

const PAGE_SIZE = 15;

function duration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

const RunExpanded: React.FC<{ runId: string }> = ({ runId }) => {
  const run = useWorkflowRun(runId);
  if (run.isLoading) return <LoadingState rows={2} />;
  if (run.isError || !run.data) return <ErrorState error={run.error} onRetry={() => void run.refetch()} />;
  const r = run.data;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-foreground">Conditions</h4>
        <ConditionTraceView trace={r.conditions} />
        {r.error && <p className="text-xs text-destructive break-words">{r.error}</p>}
        <div className="flex flex-wrap gap-3 text-xs">
          {r.leadId && (
            <Link className="text-primary hover:underline" href={`/leads/${r.leadId}`}>
              Open lead
            </Link>
          )}
          {r.dealId && (
            <Link className="text-primary hover:underline" href={`/crm?deal=${r.dealId}`}>
              Open deal
            </Link>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-foreground">Steps</h4>
        <StepList steps={r.steps} />
      </div>
    </div>
  );
};

export const RunHistory: React.FC<{ workflowId: string }> = ({ workflowId }) => {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<WorkflowRunStatus | "">("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const runs = useWorkflowRuns(workflowId, { page, pageSize: PAGE_SIZE, status: status || undefined, includeTests: true });

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <History className="w-4 h-4 text-muted-foreground" /> Run history
        </h3>
        <select
          aria-label="Filter runs by status"
          className={`${selectClassName} h-8 w-36 text-xs`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as WorkflowRunStatus | "");
            setPage(1);
          }}
        >
          <option value="">All runs</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="waiting">Waiting</option>
          <option value="running">Running</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>

      <QueryState
        query={runs}
        isEmpty={(d) => d.data.length === 0}
        empty={{
          title: status ? "No runs with this status" : "No runs yet",
          description: "Runs appear here when the trigger fires or when you test the workflow.",
          icon: History,
        }}
        errorTitle="Couldn't load runs"
      >
        {(data) => (
          <>
            <div className="divide-y divide-border rounded-lg border border-border">
              {data.data.map((run) => {
                const open = expanded === run.id;
                return (
                  <div key={run.id}>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : run.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-xs hover:bg-muted/40"
                      aria-expanded={open}
                    >
                      {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                      <RunStatusBadge status={run.status} />
                      {run.dryRun && <Badge variant="outline">Test</Badge>}
                      <span className="text-muted-foreground truncate">{run.triggerEvent ?? "manual"}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums whitespace-nowrap">
                        {new Date(run.startedAt).toLocaleString()} · {duration(run.startedAt, run.completedAt)}
                      </span>
                    </button>
                    {run.error && !open && <p className="px-9 pb-2 text-[11px] text-destructive truncate">{run.error}</p>}
                    {open && (
                      <div className="px-4 pb-4 pt-1 bg-muted/20">
                        <RunExpanded runId={run.id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {data.meta.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} runs
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </QueryState>
    </Card>
  );
};
