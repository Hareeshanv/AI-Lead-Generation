"use client";

import React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Eye, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AudienceBadge, GuardianConsentBadge, SourcePlatformBadge } from "@/components/ui/LeadBadges";
import { scoreBadgeClass } from "@/lib/analytics";
import { cn, formatConsentTime } from "@/lib/utils";
import type { Lead } from "@/types";

const hasContact = (value?: string | null) => Boolean(value && value !== "Not available");

const iconLink = "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground";

const SortHeader: React.FC<{ field: string; label: string; sort?: string; onSort?: (sort: string) => void }> = ({ field, label, sort, onSort }) => {
  if (!onSort) return <>{label}</>;
  const active = sort === field || sort === `-${field}`;
  const desc = sort === `-${field}`;
  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(active && !desc ? `-${field}` : active && desc ? field : field === "name" || field === "company" ? field : `-${field}`)}
      className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
      aria-label={`Sort by ${label}`}
    >
      {label} <Icon className="h-3 w-3" />
    </button>
  );
};

export interface LeadsTableProps {
  leads: Lead[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (select: boolean) => void;
  sort?: string;
  onSort?: (sort: string) => void;
  ownerName: (id: string | null | undefined) => string;
  onEdit: (lead: Lead) => void;
  onDelete?: (lead: Lead) => void;
}

interface LeadRowProps {
  lead: Lead;
  isSelected: boolean;
  ownerLabel: string;
  onToggle: (id: string) => void;
  onEdit: (lead: Lead) => void;
  onDelete?: (lead: Lead) => void;
}

/** Memoized so toggling one checkbox re-renders only that row (callbacks must be stable). */
const LeadRow = React.memo<LeadRowProps>(function LeadRow({ lead, isSelected, ownerLabel, onToggle, onEdit, onDelete }) {
  const consentTime = formatConsentTime(lead.consentAt);
  return (
    <tr className={cn("hover:bg-muted/40 transition-colors", isSelected && "bg-primary/5")}>
      <td className="py-3 pl-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(lead.id)}
          aria-label={`Select ${lead.name}`}
          className="h-4 w-4 rounded border-border accent-primary"
        />
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <Avatar src={lead.avatar} name={lead.name} />
          <div className="min-w-0">
            <Link href={`/leads/${lead.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
              {lead.name}
            </Link>
            {lead.title && <p className="text-xs text-muted-foreground">{lead.title}</p>}
            {(lead.isGuardian != null || lead.needsGuardianConsent || lead.courseInterest || lead.examYear || lead.doNotContact) && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                <AudienceBadge isGuardian={lead.isGuardian} />
                <GuardianConsentBadge lead={lead} />
                {lead.doNotContact && (
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">
                    Do not contact
                  </span>
                )}
                {(lead.courseInterest || lead.examYear) && (
                  <span className="text-[11px] text-muted-foreground">{[lead.courseInterest, lead.examYear].filter(Boolean).join(" · ")}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        <div className="text-foreground">{lead.company || "—"}</div>
        {lead.industry && <div className="text-xs text-muted-foreground">{lead.industry}</div>}
      </td>
      <td className="py-3 px-4">
        <span className={cn("inline-flex px-2 py-0.5 rounded-full font-mono font-semibold text-xs border", scoreBadgeClass(lead.score))}>
          {lead.score}/100
        </span>
      </td>
      <td className="py-3 px-4">
        <StatusBadge status={lead.status} />
      </td>
      <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">{ownerLabel}</td>
      <td className="py-3 px-4 text-xs text-muted-foreground">
        {lead.sourcePlatform ? (
          <div className="space-y-1">
            <SourcePlatformBadge platform={lead.sourcePlatform} />
            {lead.campaignName && (
              <div className="truncate max-w-[160px]" title={lead.campaignName}>
                {lead.campaignName}
              </div>
            )}
            {consentTime && (
              <div className="flex items-center gap-1 text-[11px]" title="Consent recorded at form submission">
                <ShieldCheck className="w-3 h-3" /> {consentTime}
              </div>
            )}
          </div>
        ) : (
          lead.source
        )}
      </td>
      <td className="py-3 px-4 text-xs">
        <div className={hasContact(lead.email) ? "text-foreground" : "text-muted-foreground"}>{hasContact(lead.email) ? lead.email : "—"}</div>
        <div className="mt-0.5 text-muted-foreground">{hasContact(lead.phone) ? lead.phone : "—"}</div>
      </td>
      <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
        {new Date(lead.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
      </td>
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <Link href={`/leads/${lead.id}`} aria-label="View lead details" className={iconLink}>
            <Eye className="w-4 h-4" />
          </Link>
          <button type="button" onClick={() => onEdit(lead)} aria-label={`Edit ${lead.name}`} className={iconLink}>
            <Pencil className="w-4 h-4" />
          </button>
          {lead.profileUrl && (
            <a href={lead.profileUrl} target="_blank" rel="noopener noreferrer" aria-label="Open profile" className={iconLink}>
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {onDelete && (
            <button type="button" onClick={() => onDelete(lead)} aria-label={`Delete ${lead.name}`} className={cn(iconLink, "hover:text-rose-500")}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

export const LeadsTable = React.memo<LeadsTableProps>(function LeadsTable({
  leads,
  selected,
  onToggle,
  onToggleAll,
  sort,
  onSort,
  ownerName,
  onEdit,
  onDelete,
}) {
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs font-medium border-b border-border">
            <tr>
              <th className="w-10 py-3 pl-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  aria-label="Select all leads on this page"
                  className="h-4 w-4 rounded border-border accent-primary"
                />
              </th>
              <th className="py-3 px-4 font-medium">
                <SortHeader field="name" label="Lead" sort={sort} onSort={onSort} />
              </th>
              <th className="py-3 px-4 font-medium">
                <SortHeader field="company" label="Company" sort={sort} onSort={onSort} />
              </th>
              <th className="py-3 px-4 font-medium">
                <SortHeader field="score" label="Score" sort={sort} onSort={onSort} />
              </th>
              <th className="py-3 px-4 font-medium">
                <SortHeader field="status" label="Status" sort={sort} onSort={onSort} />
              </th>
              <th className="py-3 px-4 font-medium">Owner</th>
              <th className="py-3 px-4 font-medium">Source</th>
              <th className="py-3 px-4 font-medium">Contact</th>
              <th className="py-3 px-4 font-medium">
                <SortHeader field="createdAt" label="Added" sort={sort} onSort={onSort} />
              </th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {leads.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                isSelected={selected.has(lead.id)}
                ownerLabel={ownerName(lead.ownerId)}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
