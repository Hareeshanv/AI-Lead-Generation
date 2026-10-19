"use client";

import React from "react";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EXCLUSION_LABELS } from "@/components/campaigns/shared";
import { useAudiencePreview, useDebounced } from "@/hooks";
import type { CampaignAudienceFilter, CampaignChannel, ExclusionReason } from "@/types";

export function AudiencePreviewPanel({
  channel,
  filter,
  campaignId,
}: {
  channel: CampaignChannel;
  filter: CampaignAudienceFilter;
  campaignId?: string;
}) {
  const debounced = useDebounced(filter, 500);
  const preview = useAudiencePreview(channel, debounced, campaignId);
  const data = preview.data;
  const excluded = data ? (Object.entries(data.excluded) as [ExclusionReason, number][]).filter(([, n]) => n > 0) : [];

  return (
    <Card className="space-y-3 bg-muted/20">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Users className="h-4 w-4 text-muted-foreground" /> Audience preview
        {preview.isFetching && <span className="text-xs font-normal text-muted-foreground">updating…</span>}
      </div>
      {preview.isError ? (
        <p className="text-sm text-destructive">{(preview.error as Error)?.message || "Couldn't preview the audience."}</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Calculating…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Matching leads", value: data.matched },
              { label: "Added manually", value: data.manual },
              { label: "Will receive", value: data.eligible },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border bg-card/60 p-2">
                <div className="text-[11px] text-muted-foreground">{m.label}</div>
                <div className="text-lg font-semibold tabular-nums text-foreground">{m.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
          {data.capped && <p className="text-xs text-amber-500">Only the newest 20,000 matching leads are included. Narrow the filter.</p>}
          {excluded.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {excluded.map(([reason, n]) => (
                <li key={reason}>
                  {n.toLocaleString()} excluded: {EXCLUSION_LABELS[reason]}
                </li>
              ))}
            </ul>
          )}
          {data.sample.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground/80">Sample recipients</div>
              <ul className="space-y-0.5">
                {data.sample.slice(0, 5).map((s) => (
                  <li key={s.id} className="truncate">
                    {s.name || "Unnamed"}
                    {s.company && s.company !== "Not available" ? ` · ${s.company}` : ""} — {s.address}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Leads marked do-not-contact, unsubscribed, or without consent for {channel === "email" ? "email" : "WhatsApp"} are never
            contacted. Consent comes from the lead&apos;s consent channels or a lead-form consent.
          </p>
        </>
      )}
    </Card>
  );
}
