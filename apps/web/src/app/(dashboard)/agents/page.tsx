"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { useAgentStore } from "@/stores/useAgentStore";
import { Bot, Sparkles, Play, Terminal, CheckCircle2, Clock, Settings2, Activity, Cpu } from "lucide-react";
import { AgentStatus } from "@/types";

export default function AgentsPage() {
  const { agents, selectedAgent, setSelectedAgent, triggerAgent } = useAgentStore();

  return (
    <DashboardLayout>
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            AI Agent Command Fleet <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            14 autonomous agents handling discovery, scraping, verification, and personalized outreach
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => selectedAgent && triggerAgent(selectedAgent.id)}>
          <Play className="w-4 h-4 mr-1.5 fill-current" /> Run Selected Agent
        </Button>
      </div>

      {/* Agents Grid & Live Logs Split Screen */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Agent Cards List */}
        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {agents.map((agent) => {
              const isSelected = selectedAgent?.id === agent.id;
              return (
                <div
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className={`p-4 rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? "glass-panel border-primary ring-2 ring-primary/40 shadow-lg shadow-primary/10"
                      : "glass-panel hover:border-border/80 opacity-90 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <Bot className="w-5 h-5" />
                    </div>
                    <StatusBadge status={agent.status} />
                  </div>
                  <h3 className="font-semibold text-foreground text-sm">{agent.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{agent.description}</p>

                  <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-mono">{agent.avgLatency} latency</span>
                    <span className="font-bold text-emerald-400">{agent.successRate}% Success</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Agent Control & Live Terminal Console */}
        <div className="lg:col-span-5 space-y-6">
          {selectedAgent ? (
            <>
              {/* Agent Settings & Performance Card */}
              <Card glass className="space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <h2 className="text-base font-bold text-foreground">{selectedAgent.name} Config</h2>
                    <p className="text-xs text-muted-foreground">{selectedAgent.type}</p>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => triggerAgent(selectedAgent.id)}>
                    <Play className="w-3.5 h-3.5 mr-1" /> Execute
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2.5 rounded-lg bg-card/60 border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase font-semibold">Model</div>
                    <div className="text-xs font-bold text-indigo-400 font-mono mt-0.5">
                      {selectedAgent.config.model}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-card/60 border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase font-semibold">Temperature</div>
                    <div className="text-xs font-bold text-foreground font-mono mt-0.5">
                      {selectedAgent.config.temperature}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-card/60 border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase font-semibold">Concurrency</div>
                    <div className="text-xs font-bold text-foreground font-mono mt-0.5">
                      {selectedAgent.config.concurrency}x
                    </div>
                  </div>
                </div>
              </Card>

              {/* Real-time Log Console */}
              <Card glass className="bg-slate-950/90 border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold font-mono text-slate-200">Execution Telemetry Stream</h3>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                </div>
                <div className="font-mono text-xs space-y-2 h-64 overflow-y-auto p-3 bg-black/60 rounded-lg border border-slate-900">
                  {selectedAgent.logs.map((log, idx) => (
                    <div key={idx} className="flex gap-2">
                      <span className="text-slate-500">[{log.timestamp}]</span>
                      <span
                        className={
                          log.level === "error"
                            ? "text-rose-400"
                            : log.level === "warn"
                            ? "text-amber-400"
                            : "text-emerald-400"
                        }
                      >
                        [{log.level.toUpperCase()}]
                      </span>
                      <span className="text-slate-300">{log.message}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}
