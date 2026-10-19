"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PublishedContact, RequestedContactBadge, SignalGuardianBadge } from "@/components/ui/LeadBadges";
import { scoreBadgeClass } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { IntentSignal, IntentSignalStatus } from "@/types";

const SIGNAL_STATUS_OPTIONS: { value: IntentSignalStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "replied", label: "Replied" },
  { value: "routed", label: "Routed" },
  { value: "dismissed", label: "Dismissed" },
];

export const SignalCard: React.FC<{
  signal: IntentSignal;
  onStatusChange: (status: IntentSignalStatus) => Promise<void>;
  onDelete: () => Promise<void>;
}> = ({ signal, onStatusChange, onDelete }) => {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm("Delete this signal permanently? Use this for opt-out requests. This cannot be undone.")) return;
    setIsUpdating(true);
    try {
      await onDelete();
      toast.success("Signal deleted.");
    } catch (err) {
      toast.error(`Failed to delete signal: ${err instanceof Error ? err.message : "Unknown error"}`);
      setIsUpdating(false);
    }
  };

  const handleCopyReply = async () => {
    if (!signal.suggestedPublicReply) return;
    try {
      await navigator.clipboard.writeText(signal.suggestedPublicReply);
      toast.success("Reply copied to clipboard.");
    } catch {
      toast.error("Could not copy the reply. Copy it manually instead.");
    }
  };

  const handleStatus = async (status: IntentSignalStatus) => {
    setIsUpdating(true);
    try {
      await onStatusChange(status);
      toast.success(`Signal marked as ${status}.`);
    } catch (err) {
      toast.error(`Failed to update signal: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const details = [
    signal.platform && { label: "Platform", value: signal.platform },
    signal.authorHandle && { label: "Public user", value: signal.authorHandle },
    signal.courseInterest && { label: "Course", value: signal.courseInterest },
    signal.city && { label: "City", value: signal.city },
    signal.urgency && { label: "Urgency", value: signal.urgency },
    signal.budget && { label: "Budget", value: signal.budget },
  ].filter((d): d is { label: string; value: string } => Boolean(d));

  return (
    <div className={cn("rounded-xl border bg-card p-4 flex flex-col gap-3", signal.contactRequested ? "border-emerald-500/40" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border border-border bg-muted text-foreground">
            {signal.sourceChannel}
          </span>
          <RequestedContactBadge signal={signal} />
          <SignalGuardianBadge signal={signal} />
          {signal.leadRoutingCategory && <span className="text-[11px] text-muted-foreground">{signal.leadRoutingCategory}</span>}
        </div>
        {signal.intentScore != null && (
          <span
            className={cn("inline-flex px-2 py-0.5 rounded-full font-mono font-semibold text-xs border shrink-0", scoreBadgeClass(signal.intentScore))}
            title="Intent score"
          >
            {signal.intentScore}/100
          </span>
        )}
      </div>

      {signal.postExcerpt && <p className="text-sm text-foreground leading-relaxed line-clamp-4">{signal.postExcerpt}</p>}

      <PublishedContact signal={signal} />

      {details.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {details.map((d) => (
            <div key={d.label} className="min-w-0">
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd className="text-foreground truncate" title={d.value}>
                {d.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {signal.postUrl && (
          <a
            href={signal.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" /> View post
          </a>
        )}
        {signal.postDate && <span className="text-[11px] text-muted-foreground">{signal.postDate}</span>}
        <div className="ml-auto flex items-center gap-2">
          {signal.suggestedPublicReply && (
            <Button variant="outline" size="sm" onClick={handleCopyReply} title={signal.suggestedPublicReply}>
              <Copy className="w-3.5 h-3.5" /> Copy reply
            </Button>
          )}
          <select
            value={signal.status}
            disabled={isUpdating}
            onChange={(e) => handleStatus(e.target.value as IntentSignalStatus)}
            aria-label="Signal status"
            className="h-8 px-2 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
          >
            {SIGNAL_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={isUpdating} title="Delete permanently (opt-out request)" aria-label="Delete signal">
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
          </Button>
        </div>
      </div>
    </div>
  );
};
