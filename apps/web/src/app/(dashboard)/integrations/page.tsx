"use client";

import React, { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Puzzle, CheckCircle2, RefreshCw, Sparkles, Zap, ShieldCheck, Database, Key } from "lucide-react";
import { toast } from "sonner";

export default function IntegrationsPage() {
  const [connected, setConnected] = useState<{ [key: string]: boolean }>({
    hubspot: true,
    slack: true,
    salesforce: false,
    google: true,
    microsoft: false,
    zapier: true,
    supabase: true,
    sarvam: true,
    hunter: true,
  });

  const toggleIntegration = (key: string, name: string) => {
    const nextState = !connected[key];
    setConnected((prev) => ({ ...prev, [key]: nextState }));
    if (nextState) {
      toast.success(`${name} connected successfully! Webhook sync active.`);
    } else {
      toast.info(`${name} disconnected.`);
    }
  };

  const integrations = [
    { key: "hubspot", name: "HubSpot CRM", category: "CRM & Sales", desc: "Bi-directional sync of contacts, deals & activity logs", icon: "🍊" },
    { key: "salesforce", name: "Salesforce CRM", category: "CRM & Sales", desc: "Enterprise account, lead, and pipeline mapping", icon: "☁️" },
    { key: "slack", name: "Slack Alerts", category: "Communication", desc: "Real-time notifications for high ICP lead discoveries & opens", icon: "💬" },
    { key: "google", name: "Google Workspace", category: "Outreach & Email", desc: "Gmail & Google Calendar sync for automated outreach", icon: "📧" },
    { key: "sarvam", name: "Sarvam & OpenAI Gateway", category: "AI Models", desc: "Unified LLM & Multilingual Speech/Text processing engines", icon: "🤖" },
    { key: "supabase", name: "Supabase DB", category: "Data Storage", desc: "Postgres database with real-time vector embeddings & RLS", icon: "⚡" },
    { key: "hunter", name: "Hunter.io & Enrichment", category: "Verification", desc: "Automated email verification & domain search API", icon: "🎯" },
    { key: "microsoft", name: "Microsoft Graph", category: "Outreach & Email", desc: "Outlook & Teams calendar integration", icon: "🟦" },
    { key: "zapier", name: "Zapier Webhooks", category: "Automation", desc: "Trigger 5,000+ app webhooks on agent events", icon: "⚡" },
  ];

  const connectedCount = Object.values(connected).filter(Boolean).length;

  return (
    <DashboardLayout>
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            Integrations & API Connectors <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your CRM, email providers, LLM gateways, vector databases, and custom webhooks
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs px-3 py-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5 mr-1 inline" /> {connectedCount} Active Connectors
          </Badge>
          <Button variant="outline" size="sm" onClick={() => toast.success("Refreshed integration webhooks and health status.")}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Sync Status
          </Button>
        </div>
      </div>

      {/* Integrations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map((item) => {
          const isConn = connected[item.key];
          return (
            <Card key={item.key} glass className="glass-panel-hover space-y-4 flex flex-col justify-between p-5">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl p-2 rounded-xl bg-card border border-white/10">{item.icon}</span>
                    <div>
                      <h3 className="font-semibold text-foreground text-base tracking-tight">{item.name}</h3>
                      <span className="text-[10px] text-muted-foreground font-mono uppercase">{item.category}</span>
                    </div>
                  </div>
                  {isConn ? <Badge variant="success">Connected</Badge> : <Badge variant="secondary">Disconnected</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{item.desc}</p>
              </div>

              <Button
                variant={isConn ? "outline" : "primary"}
                className="w-full text-xs mt-2"
                onClick={() => toggleIntegration(item.key, item.name)}
              >
                {isConn ? "Manage / Disconnect" : "Connect Integration"}
              </Button>
            </Card>
          );
        })}
      </div>
    </DashboardLayout>
  );
}

