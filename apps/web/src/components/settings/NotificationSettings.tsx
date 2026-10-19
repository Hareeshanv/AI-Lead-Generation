"use client";

import React from "react";
import { Bell } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useUpdateProfile } from "@/hooks/useMe";
import { cn } from "@/lib/utils";
import type { Me, NotificationPrefKey } from "@/types";
import { SectionTitle } from "./shared";

const PREFS: { key: NotificationPrefKey; label: string; description: string }[] = [
  { key: "newLead", label: "New leads", description: "A lead arrives from an ad form, import or agent" },
  { key: "leadAssigned", label: "Lead assigned to me", description: "Someone makes you the owner of a lead" },
  { key: "dealStageChanged", label: "Deal stage changes", description: "A deal you own moves stage" },
  { key: "taskDue", label: "Task reminders", description: "A task assigned to you is due" },
  { key: "campaignReplied", label: "Campaign replies", description: "A lead replies to a campaign message" },
  { key: "agentRunCompleted", label: "Agent runs", description: "An AI agent run finishes" },
  { key: "workflowFailed", label: "Workflow failures", description: "A workflow run fails" },
  { key: "integrationError", label: "Integration problems", description: "A connected integration stops working" },
  { key: "emailDigest", label: "Daily email digest", description: "A summary email of yesterday's activity" },
];

export function NotificationSettings({ me }: { me: Me }) {
  const update = useUpdateProfile("Notification preferences saved");
  const prefs = me.user.notificationPrefs;

  return (
    <Card className="max-w-xl space-y-4">
      <SectionTitle icon={Bell} title="Notifications" description="Choose what you're notified about in this app." />
      <ul className="divide-y divide-border">
        {PREFS.map((pref) => {
          const enabled = prefs[pref.key];
          return (
            <li key={pref.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">{pref.label}</div>
                <div className="text-xs text-muted-foreground">{pref.description}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={pref.label}
                disabled={update.isPending}
                onClick={() => update.mutate({ notificationPrefs: { [pref.key]: !enabled } })}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                  enabled ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                    enabled ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
