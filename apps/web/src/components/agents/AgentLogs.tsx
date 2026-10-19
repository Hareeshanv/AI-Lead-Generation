"use client";

import React, { useState } from "react";
import { Terminal } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/QueryState";
import { useAgentLogs } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";
import { formatTime } from "./shared";
import { formatDateTime } from "@/lib/utils";

const LEVEL_CLASS = {
  error: "text-rose-600 dark:text-rose-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-emerald-600 dark:text-emerald-400",
} as const;

/** Server logs from /agents/:id/logs; optionally only the selected run's lines. */
export const AgentLogs: React.FC<{ agentId: string; runId: string | null; live: boolean }> = ({ agentId, runId, live }) => {
  const [onlyRun, setOnlyRun] = useState(true);
  const filterRun = onlyRun ? runId : null;
  const logs = useAgentLogs(agentId, filterRun, live);

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Server logs</h3>
          {live && <span className="text-[11px] text-indigo-400">live</span>}
        </div>
        {runId && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={onlyRun} onChange={(e) => setOnlyRun(e.target.checked)} className="accent-primary" />
            Selected run only
          </label>
        )}
      </div>
      <div className="font-mono text-xs space-y-1.5 h-64 overflow-y-auto p-3 rounded-lg border border-border bg-muted/40">
        {logs.isLoading ? (
          <LoadingState rows={3} />
        ) : logs.isError ? (
          <ErrorState title="Couldn't load logs" error={logs.error} onRetry={() => void logs.refetch()} className="py-4" />
        ) : (logs.data ?? []).length === 0 ? (
          <p className="text-muted-foreground font-sans">No log lines yet. Start a run to see progress here.</p>
        ) : (
          logs.data!.map((log) => (
            <div key={log.id} className="flex gap-2">
              <span className="text-muted-foreground shrink-0" title={formatDateTime(log.createdAt)}>
                {formatTime(log.createdAt)}
              </span>
              <span className={cn("shrink-0 uppercase", LEVEL_CLASS[log.level])}>{log.level}</span>
              <span className="text-foreground break-words min-w-0">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};
