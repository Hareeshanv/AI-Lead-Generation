"use client";

import React, { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Puzzle, CheckCircle2, RefreshCw } from "lucide-react";

export default function IntegrationsPage() {
  const [connected, setConnected] = useState<{ [key: string]: boolean }>({
    hubspot: true,
    slack: true,
    salesforce: false,
    google: true,
    microsoft: false,
    zapier: true,
  });

  const toggleIntegration = (key: string) => {
    setConnected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const integrations = [
    { key: "hubspot", name: "HubSpot CRM", desc: "Bi-directional sync of contacts, deals & activity logs", icon: "🍊" },
    { key: "salesforce", name: "Salesforce CRM", desc: "Enterprise account, lead, and pipeline mapping", icon: "☁️" },
    { key: "slack", name: "Slack Alerts", desc: "Real-time notifications for high ICP lead discoveries & opens", icon: "💬" },
    { key: "google", name: "Google Workspace", desc: "Gmail & Google Calendar sync for automated outreach", icon: "📧" },
    { key: "microsoft", name: "Microsoft Graph", desc: "Outlook & Teams calendar integration", icon: "🟦" },
    { key: "zapier", name: "Zapier Webhooks", desc: "Trigger 5,000+ app webhooks on agent events", icon: "⚡" },
  ];

  return (
    <DashboardLayout>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Integrations & Connectors</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Connect your CRM, email providers, messaging apps, and custom webhooks</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map((item) => {
          const isConn = connected[item.key];
          return (
            <Card key={item.key} glass className="space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{item.icon}</span>
                  {isConn ? <Badge variant="success">Connected</Badge> : <Badge variant="secondary">Disconnected</Badge>}
                </div>
                <h3 className="font-semibold text-foreground text-base mt-3">{item.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
              </div>

              <Button
                variant={isConn ? "outline" : "primary"}
                className="w-full text-xs"
                onClick={() => toggleIntegration(item.key)}
              >
                {isConn ? "Disconnect" : "Connect Integration"}
              </Button>
            </Card>
          );
        })}
      </div>
    </DashboardLayout>
  );
}
