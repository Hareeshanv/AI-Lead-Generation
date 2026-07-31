"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Mail, Send, Inbox, FileText, Sparkles, Star } from "lucide-react";

export default function EmailPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Email Outreach Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Inbox, AI response automation, and sequence preview
          </p>
        </div>
        <Button variant="primary" size="sm">
          <Send className="w-4 h-4 mr-1.5" /> Compose AI Draft
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Email Folders & Threads */}
        <Card glass className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground pb-2 border-b border-border">
            <Inbox className="w-4 h-4 text-primary" /> Active Conversations
          </div>
          <div className="space-y-2">
            <div className="p-3 rounded-xl bg-card/60 border border-primary/40 cursor-pointer">
              <div className="flex justify-between text-xs mb-1">
                <span className="font-bold text-foreground">Sarah Jenkins</span>
                <span className="text-muted-foreground text-[10px]">10:30 AM</span>
              </div>
              <p className="text-xs text-indigo-400 font-semibold truncate">Re: Streamlining Stripe Tech's AI Infrastructure</p>
              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                Thanks Alex, I reviewed the prompt deck and we're excited to test this...
              </p>
            </div>

            <div className="p-3 rounded-xl bg-card/30 border border-border cursor-pointer hover:bg-card/50">
              <div className="flex justify-between text-xs mb-1">
                <span className="font-bold text-foreground">Marcus Vance</span>
                <span className="text-muted-foreground text-[10px]">Yesterday</span>
              </div>
              <p className="text-xs text-foreground font-semibold truncate">DataVanguard AI Pipeline Pilot</p>
              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                Can we set up a quick 15-minute sync with our growth team?
              </p>
            </div>
          </div>
        </Card>

        {/* Email Preview Pane */}
        <Card glass className="lg:col-span-2 space-y-4">
          <div className="border-b border-border pb-3 flex justify-between items-center">
            <div>
              <h2 className="text-base font-bold text-foreground">Re: Streamlining Stripe Tech's AI Infrastructure</h2>
              <p className="text-xs text-muted-foreground">From: Sarah Jenkins &lt;s.jenkins@stripe-demo.com&gt;</p>
            </div>
            <Button variant="primary" size="sm">
              <Sparkles className="w-3.5 h-3.5 mr-1" /> AI Auto-Reply
            </Button>
          </div>

          <div className="p-4 rounded-xl bg-card/30 border border-border text-sm text-foreground space-y-3 leading-relaxed">
            <p>Hi Alex,</p>
            <p>
              I reviewed the prompt deck you sent over regarding the autonomous lead enrichment pipelines. Our engineering team at Stripe Tech is currently scaling our Q3 data layer and your solution looks directly aligned with our requirements.
            </p>
            <p>Are you free for a 20-minute product demonstration later this week?</p>
            <p className="text-xs text-muted-foreground">Best regards,<br />Sarah Jenkins<br />VP of Enterprise Engineering</p>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
