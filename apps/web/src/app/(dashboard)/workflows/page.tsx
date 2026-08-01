"use client";

import React, { useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import { GitFork, Plus, Play, Clock, Search, Globe, Filter, Database, ArrowRight, CheckCircle2, Zap } from "lucide-react";

export default function WorkflowsPage() {
  const { workflows, activeWorkflow, setActiveWorkflow, toggleWorkflowStatus, fetchWorkflows, isLoading } = useWorkflowStore();

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Visual Workflow Builder</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Design multi-step autonomous AI pipelines with drag-and-drop triggers, conditions & actions
          </p>
        </div>
        <Button variant="primary" size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> Create New Workflow
        </Button>
      </div>

      {/* Workflow Tabs / Selector */}
      {isLoading ? (
        <div className="glass-panel p-12 rounded-2xl border border-white/10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto animate-spin">
            <GitFork className="w-6 h-6 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Loading Visual Workflows...</h3>
        </div>
      ) : workflows.length === 0 ? (
        <div className="glass-panel p-12 rounded-2xl border border-white/10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <GitFork className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-foreground">No Workflows Defined</h3>
          <p className="text-xs text-muted-foreground">Click "Create New Workflow" to start design.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 overflow-x-auto pb-2">
            {workflows.map((wf) => (
              <button
                key={wf.id}
                onClick={() => setActiveWorkflow(wf)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                  activeWorkflow?.id === wf.id
                    ? "bg-primary text-white shadow-lg shadow-primary/25"
                    : "glass-panel text-muted-foreground hover:text-foreground"
                }`}
              >
                <GitFork className="w-3.5 h-3.5" /> {wf.name}
              </button>
            ))}
          </div>

          {activeWorkflow && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
              {/* Visual Canvas */}
              <Card glass className="lg:col-span-2 space-y-6 relative overflow-hidden min-h-[480px] flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h2 className="text-base font-bold text-foreground">{activeWorkflow.name}</h2>
                    <p className="text-xs text-muted-foreground">{activeWorkflow.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={activeWorkflow.status} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleWorkflowStatus(activeWorkflow.id)}
                    >
                      {activeWorkflow.status === "active" ? "Pause" : "Activate"}
                    </Button>
                  </div>
                </div>

                {/* Nodes Pipeline Canvas */}
                <div className="flex flex-col items-center justify-center space-y-4 py-8">
                  {activeWorkflow.nodes.map((node, index) => (
                    <React.Fragment key={node.id}>
                      <div className="w-full max-w-md p-4 rounded-xl glass-panel border border-white/10 hover:border-primary/50 transition-all flex items-center justify-between shadow-lg group">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-lg bg-primary/15 text-primary">
                            <Zap className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground uppercase font-mono">{node.type}</span>
                              <span className="text-xs font-semibold text-foreground">{node.label}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{node.description}</p>
                          </div>
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </div>

                      {index < activeWorkflow.nodes.length - 1 && (
                        <div className="flex flex-col items-center">
                          <div className="w-0.5 h-6 bg-gradient-to-b from-primary to-indigo-500" />
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>Total Execution Runs: {activeWorkflow.totalRuns}</span>
                  <span className="text-emerald-400 font-semibold">{activeWorkflow.successRate}% Success Rate</span>
                </div>
              </Card>

              {/* Workflow Stats */}
              <Card glass className="space-y-4">
                <h3 className="text-base font-semibold text-foreground">Pipeline Performance Stats</h3>
                <div className="space-y-3 text-sm">
                  <div className="p-3 rounded-lg bg-card/60 border border-border">
                    <div className="text-xs text-muted-foreground">Triggers Configured</div>
                    <div className="text-lg font-bold text-foreground mt-0.5">{activeWorkflow.triggersCount} Triggers</div>
                  </div>
                  <div className="p-3 rounded-lg bg-card/60 border border-border">
                    <div className="text-xs text-muted-foreground">Last Trigger Run</div>
                    <div className="text-sm font-semibold text-indigo-400 mt-0.5">{activeWorkflow.lastRun}</div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  );
}
