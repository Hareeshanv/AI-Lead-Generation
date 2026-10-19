"use client";

import React, { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { QueryState } from "@/components/ui/QueryState";
import { useAgentRuns } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";
import type { AgentRun } from "@/types";
import { RunStatusBadge, SOURCE_LABELS, formatDuration } from "./shared";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 10;

function resultsLabel(run: AgentRun): string {
  if (run.leadsCreated == null && run.signalsSaved == null) return run.status === "queued" || run.status === "running" ? "—" : String(run.resultsFound);
  const parts = [];
  if (run.sources.includes("places")) parts.push(`${run.leadsCreated ?? 0} leads`);
  if (run.sources.includes("web")) parts.push(`${run.signalsSaved ?? 0} signals`);
  return parts.join(" · ");
}

export const RunHistory: React.FC<{
  agentId: string;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}> = ({ agentId, selectedRunId, onSelect }) => {
  const [page, setPage] = useState(1);
  const runs = useAgentRuns(agentId, page, PAGE_SIZE);
  const firstRunId = runs.data?.data[0]?.id ?? null;

  useEffect(() => {
    if (!selectedRunId && firstRunId) onSelect(firstRunId);
  }, [selectedRunId, firstRunId, onSelect]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Run history</h2>
        {runs.data && <span className="text-xs text-muted-foreground">({runs.data.meta.total})</span>}
      </div>
      <QueryState
        query={runs}
        isEmpty={(d) => d.data.length === 0}
        errorTitle="Couldn't load run history"
        empty={{ icon: History, title: "No runs yet", description: "Start a run above. Each run is listed here with its results, errors and timing." }}
      >
        {(data) => (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground text-xs font-medium border-b border-border">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Started</th>
                    <th className="py-2.5 px-4 font-medium">Query</th>
                    <th className="py-2.5 px-4 font-medium">Location</th>
                    <th className="py-2.5 px-4 font-medium">Sources</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium">Results</th>
                    <th className="py-2.5 px-4 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.data.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => onSelect(run.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(run.id)}
                      tabIndex={0}
                      aria-selected={run.id === selectedRunId}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-muted/40 focus:outline-none focus:bg-muted/40",
                        run.id === selectedRunId && "bg-primary/5"
                      )}
                    >
                      <td className="py-2.5 px-4 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(run.createdAt)}</td>
                      <td className="py-2.5 px-4 text-xs text-foreground max-w-[220px] truncate" title={run.query}>
                        {run.query}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-foreground">{run.location || "—"}</td>
                      <td className="py-2.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {run.sources.map((s) => SOURCE_LABELS[s]).join(", ")}
                      </td>
                      <td className="py-2.5 px-4">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="py-2.5 px-4 text-xs text-foreground whitespace-nowrap">{resultsLabel(run)}</td>
                      <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums">{formatDuration(run.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.meta.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
                <span>
                  Page {data.meta.page} of {data.meta.totalPages}
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
          </div>
        )}
      </QueryState>
    </section>
  );
};
