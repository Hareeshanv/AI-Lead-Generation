"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useCampaignStore } from "@/stores/useCampaignStore";
import { Megaphone, Plus, Mail, Eye, MousePointer, Reply, Calendar } from "lucide-react";

export default function CampaignsPage() {
  const { campaigns, toggleCampaignStatus } = useCampaignStore();

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Outreach Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automated hyper-personalized cold outreach sequences and response analytics
          </p>
        </div>
        <Button variant="primary" size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> Launch New Campaign
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {campaigns.map((cmp) => (
          <Card key={cmp.id} glass className="space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between">
                <StatusBadge status={cmp.status} />
                <span className="text-xs text-muted-foreground">{cmp.schedule}</span>
              </div>
              <h3 className="font-semibold text-foreground text-base mt-2">{cmp.name}</h3>

              <div className="grid grid-cols-3 gap-2 my-4 text-center">
                <div className="p-2 rounded-lg bg-card/60 border border-border">
                  <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                    <Eye className="w-3 h-3 text-indigo-400" /> Open Rate
                  </div>
                  <div className="text-sm font-bold text-indigo-400 font-mono mt-0.5">{cmp.openRate}%</div>
                </div>
                <div className="p-2 rounded-lg bg-card/60 border border-border">
                  <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                    <MousePointer className="w-3 h-3 text-cyan-400" /> Click Rate
                  </div>
                  <div className="text-sm font-bold text-cyan-400 font-mono mt-0.5">{cmp.clickRate}%</div>
                </div>
                <div className="p-2 rounded-lg bg-card/60 border border-border">
                  <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                    <Reply className="w-3 h-3 text-emerald-400" /> Reply Rate
                  </div>
                  <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">{cmp.replyRate}%</div>
                </div>
              </div>
            </div>

            <Button variant="outline" className="w-full text-xs" onClick={() => toggleCampaignStatus(cmp.id)}>
              {cmp.status === "Active" ? "Pause Campaign" : "Resume Campaign"}
            </Button>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
