"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { HelpCircle, BookOpen, MessageSquare, ExternalLink } from "lucide-react";

export default function HelpPage() {
  return (
    <DashboardLayout>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Help Center & Documentation</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Learn how to configure autonomous AI agents, custom prompt templates, and workflows</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card glass className="space-y-3">
          <BookOpen className="w-6 h-6 text-primary" />
          <h3 className="font-semibold text-foreground">Agent Setup Guide</h3>
          <p className="text-xs text-muted-foreground">Detailed instructions on setting up search, crawler, and verification agents.</p>
        </Card>
        <Card glass className="space-y-3">
          <HelpCircle className="w-6 h-6 text-indigo-400" />
          <h3 className="font-semibold text-foreground">Workflow Canvas Documentation</h3>
          <p className="text-xs text-muted-foreground">How to structure triggers, AI filter conditions, and CRM synchronization actions.</p>
        </Card>
        <Card glass className="space-y-3">
          <MessageSquare className="w-6 h-6 text-emerald-400" />
          <h3 className="font-semibold text-foreground">24/7 Dedicated Support</h3>
          <p className="text-xs text-muted-foreground">Reach out to your dedicated enterprise customer success manager.</p>
        </Card>
      </div>
    </DashboardLayout>
  );
}
