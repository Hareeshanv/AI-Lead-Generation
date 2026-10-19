import React, { useEffect, useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type {
  CampaignChannel,
  CampaignFunnelStage,
  CampaignSendWindow,
  CampaignStatus,
  ExclusionReason,
  RecipientStatus,
} from "@/types";

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

const CAMPAIGN_STATUS_VARIANTS: Record<CampaignStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "secondary",
  scheduled: "indigo",
  active: "success",
  paused: "warning",
  completed: "default",
};

export const CampaignStatusBadge: React.FC<{ status: CampaignStatus; className?: string }> = ({ status, className }) => (
  <Badge variant={CAMPAIGN_STATUS_VARIANTS[status]} className={className}>
    {CAMPAIGN_STATUS_LABELS[status]}
  </Badge>
);

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: "Pending",
  active: "In sequence",
  completed: "Completed",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  failed: "Failed",
  skipped: "Skipped",
};

const RECIPIENT_STATUS_VARIANTS: Record<RecipientStatus, NonNullable<BadgeProps["variant"]>> = {
  pending: "secondary",
  active: "indigo",
  completed: "default",
  replied: "success",
  bounced: "danger",
  unsubscribed: "warning",
  failed: "danger",
  skipped: "secondary",
};

export const RecipientStatusBadge: React.FC<{ status: RecipientStatus }> = ({ status }) => (
  <Badge variant={RECIPIENT_STATUS_VARIANTS[status]}>{RECIPIENT_STATUS_LABELS[status]}</Badge>
);

export const ChannelBadge: React.FC<{ channel: CampaignChannel; className?: string }> = ({ channel, className }) => {
  const Icon = channel === "email" ? Mail : MessageCircle;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <Icon className="h-3.5 w-3.5" />
      {channel === "email" ? "Email" : "WhatsApp"}
    </span>
  );
};

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  do_not_contact: "Do not contact",
  no_consent: "No consent for this channel",
  unsubscribed: "Unsubscribed",
  missing_address: "No valid email / phone",
};

export function useDebounced<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDelay(minutes: number): string {
  if (minutes <= 0) return "Immediately";
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"} later`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"} later`;
  return `${minutes} min later`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeSendWindow(w: CampaignSendWindow, fallbackTz?: string): string {
  if (!w.start && (!w.days || w.days.length === 7)) return "Any time";
  const days =
    !w.days || w.days.length === 7
      ? "Every day"
      : [...w.days]
          .sort()
          .map((d) => DAY_NAMES[d])
          .join(", ");
  const hours = w.start && w.end ? `${w.start}–${w.end}` : "all day";
  return `${days}, ${hours} (${w.timezone || fallbackTz || "UTC"})`;
}

/** Horizontal funnel; each bar is relative to the first stage. */
export const CampaignFunnel: React.FC<{ stages: CampaignFunnelStage[] }> = ({ stages }) => {
  const top = Math.max(1, stages[0]?.value ?? 0);
  return (
    <div className="space-y-2.5">
      {stages.map((stage, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const pct = Math.min(100, (stage.value / top) * 100);
        const conversion = prev && prev > 0 ? Math.round((stage.value / prev) * 1000) / 10 : null;
        return (
          <div key={stage.key} className="grid grid-cols-[96px_1fr_auto] items-center gap-3 text-sm">
            <span className="text-muted-foreground">{stage.label}</span>
            <div className="h-6 rounded-md bg-muted/50 overflow-hidden">
              <div className="h-full rounded-md bg-primary/70 transition-all" style={{ width: `${Math.max(pct, stage.value > 0 ? 2 : 0)}%` }} />
            </div>
            <span className="tabular-nums text-foreground w-28 text-right">
              {stage.value.toLocaleString()}
              {conversion !== null && <span className="ml-1.5 text-xs text-muted-foreground">({conversion}%)</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
};
