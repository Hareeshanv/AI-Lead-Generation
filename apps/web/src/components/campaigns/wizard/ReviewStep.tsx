"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { ChannelBadge, describeSendWindow, formatDelay } from "@/components/campaigns/shared";
import { formatDateTime } from "@/lib/utils";
import type { CampaignChannel, CampaignSendWindow } from "@/types";
import { toStepInput, type AudienceDraft, type ScheduleDraft, type StepDraft } from "./draft";

export function ReviewStep({
  name,
  description,
  channel,
  audience,
  steps,
  schedule,
  sendWindow,
  orgTz,
}: {
  name: string;
  description: string;
  channel: CampaignChannel;
  audience: AudienceDraft;
  steps: StepDraft[];
  schedule: ScheduleDraft;
  sendWindow: CampaignSendWindow;
  orgTz: string;
}) {
  const { scheduleMode, scheduledAt, throttle } = schedule;
  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">{name || "Untitled campaign"}</h3>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        <ChannelBadge channel={channel} className="mt-2" />
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Start</dt>
          <dd className="text-foreground">{scheduleMode === "later" && scheduledAt ? formatDateTime(new Date(scheduledAt).toISOString()) : "When launched"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Sending hours</dt>
          <dd className="text-foreground">{describeSendWindow(sendWindow, orgTz)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Throttle</dt>
          <dd className="text-foreground">{parseInt(throttle, 10) || 100} per hour</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Audience</dt>
          <dd className="text-foreground">{audience.type === "manual" ? "Leads added manually" : "Leads matching filters"}</dd>
        </div>
      </dl>
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-2">Sequence</h4>
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const input = toStepInput(s, channel);
            return (
              <li key={s.key} className="rounded-lg border border-border p-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  {i + 1}. {i === 0 ? (input.delayMinutes ? formatDelay(input.delayMinutes).replace("later", "after launch") : "At launch") : formatDelay(input.delayMinutes)}
                </div>
                <div className="text-foreground truncate">
                  {channel === "email" ? input.subject || "(no subject)" : `Template: ${input.whatsappTemplate?.name || "(none)"}`}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
