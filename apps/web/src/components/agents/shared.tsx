import React from "react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { scoreBadgeClass } from "@/lib/analytics";
import type { AgentRunStatus, DiscoverySource } from "@/types";

export const SOURCE_LABELS: Record<DiscoverySource, string> = {
  web: "Web posts",
  places: "Business listings",
};

const RUN_STATUS: Record<AgentRunStatus, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  queued: { label: "Queued", variant: "secondary" },
  running: { label: "Running", variant: "indigo" },
  completed: { label: "Completed", variant: "success" },
  completed_with_errors: { label: "Completed with errors", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
};

export const RunStatusBadge: React.FC<{ status: AgentRunStatus; className?: string }> = ({ status, className }) => {
  const s = RUN_STATUS[status];
  const active = status === "queued" || status === "running";
  return (
    <Badge variant={s.variant} className={cn("gap-1.5 whitespace-nowrap", className)}>
      {active && <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-current border-t-transparent animate-spin" />}
      {s.label}
    </Badge>
  );
};

export const ScoreBadge: React.FC<{ score: number | null }> = ({ score }) =>
  score == null ? (
    <span className="text-xs text-muted-foreground">—</span>
  ) : (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full font-mono font-semibold text-xs border", scoreBadgeClass(score))}>
      {score}/100
    </span>
  );

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString();
}
