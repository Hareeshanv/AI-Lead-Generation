"use client";

import React, { useCallback, useState } from "react";
import { Activity, Bot, Building2, CheckCircle2, MessageSquare, Timer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { QueryState } from "@/components/ui/QueryState";
import { AgentLogs } from "@/components/agents/AgentLogs";
import { RunDetail } from "@/components/agents/RunDetail";
import { RunForm } from "@/components/agents/RunForm";
import { RunHistory } from "@/components/agents/RunHistory";
import { formatDuration } from "@/components/agents/shared";
import { useAgent } from "@/hooks/useAgents";
import { DISCOVERY_AGENT_ID } from "@/services/api";

export default function AgentsPage() {
  const agent = useAgent(DISCOVERY_AGENT_ID);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectRun = useCallback((runId: string) => setSelectedRunId(runId), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Lead Discovery"
        description="Find prospective customers for any business in any city: public posts from people asking for what you sell, and public business listings. Personal phone numbers and emails are never collected unless the author published one while asking to be contacted."
        icon={Bot}
      />

      <QueryState query={agent} errorTitle="Couldn't load the agent">
        {(a) => {
          const stats = a.stats;
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <MetricCard title="Runs" value={stats?.runs ?? 0} icon={<Activity className="w-4 h-4" />} subtitle={a.activeRuns ? `${a.activeRuns} in progress` : undefined} />
                <MetricCard
                  title="Success rate"
                  value={stats?.successRate != null ? `${stats.successRate}%` : "—"}
                  icon={<CheckCircle2 className="w-4 h-4" />}
                  subtitle={stats ? `${stats.failed} failed` : undefined}
                />
                <MetricCard title="Avg duration" value={formatDuration(stats?.avgDurationMs)} icon={<Timer className="w-4 h-4" />} />
                <MetricCard title="Leads found" value={stats?.leadsFound ?? 0} icon={<Building2 className="w-4 h-4" />} subtitle="business listings" />
                <MetricCard title="Signals found" value={stats?.signalsFound ?? 0} icon={<MessageSquare className="w-4 h-4" />} subtitle="intent posts" />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-7">
                  <RunForm agent={a} onStarted={(run) => setSelectedRunId(run.id)} />
                </div>
                <div className="xl:col-span-5">
                  <AgentLogs agentId={a.id} runId={selectedRunId} live={a.status === "running"} />
                </div>
              </div>

              <RunHistory agentId={a.id} selectedRunId={selectedRunId} onSelect={selectRun} />

              {selectedRunId && <RunDetail agentId={a.id} runId={selectedRunId} />}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
