"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useCRMStore } from "@/stores/useCRMStore";
import { formatCurrency } from "@/lib/utils";
import { Kanban, Plus, DollarSign, Calendar, User, Building } from "lucide-react";
import { Deal } from "@/types";

const STAGES: Deal["stage"][] = ["New", "Qualified", "Proposal", "Negotiation", "Closed Won"];

export default function CRMPage() {
  const { deals, updateDealStage } = useCRMStore();

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CRM Deal Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Interactive Kanban board for managing deal stages, probabilities & expected close dates
          </p>
        </div>
        <Button variant="primary" size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> Add Deal
        </Button>
      </div>

      {/* Kanban Board Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage === stage);
          const totalValue = stageDeals.reduce((sum, d) => sum + d.value, 0);

          return (
            <div key={stage} className="glass-panel p-4 rounded-xl border border-white/10 flex flex-col h-full min-w-[240px]">
              <div className="flex items-center justify-between border-b border-border pb-3 mb-3">
                <span className="font-semibold text-foreground text-xs uppercase tracking-wider">{stage}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                  {stageDeals.length}
                </span>
              </div>

              <div className="text-xs font-bold text-emerald-400 mb-3">{formatCurrency(totalValue)}</div>

              <div className="space-y-3 flex-1 overflow-y-auto min-h-[300px]">
                {stageDeals.map((deal) => (
                  <div
                    key={deal.id}
                    className="p-3.5 rounded-xl bg-card/60 border border-border hover:border-primary/40 transition-all shadow-sm space-y-2 cursor-grab"
                  >
                    <h4 className="font-semibold text-foreground text-xs">{deal.title}</h4>
                    <div className="text-[11px] text-muted-foreground">{deal.company}</div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[11px]">
                      <span className="font-bold text-foreground font-mono">{formatCurrency(deal.value)}</span>
                      <span className="text-indigo-400 font-semibold">{deal.probability}% Win</span>
                    </div>

                    {/* Stage Quick Switcher */}
                    <div className="pt-2 flex gap-1 justify-end">
                      {STAGES.filter((s) => s !== stage).slice(0, 2).map((nextStage) => (
                        <button
                          key={nextStage}
                          onClick={() => updateDealStage(deal.id, nextStage)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-primary hover:text-white transition-colors"
                        >
                          → {nextStage}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardLayout>
  );
}
