"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Briefcase, Building2, ExternalLink, Megaphone, MessageSquare, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryState } from "@/components/ui/QueryState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PublishedContact, RequestedContactBadge, SignalGuardianBadge } from "@/components/ui/LeadBadges";
import { useAgentRun, useConvertSignals, useCreateDealsForLeads } from "@/hooks/useAgents";
import { useAddLeadsToCampaign } from "@/hooks/useCampaigns";
import { useHasRole } from "@/hooks/useMe";
import { cn } from "@/lib/utils";
import type { AgentRunDetail, IntentSignal, Lead } from "@/types";
import { CampaignPickerModal } from "./CampaignPickerModal";
import { RunStatusBadge, SOURCE_LABELS, ScoreBadge, formatDuration } from "./shared";
import { formatDateTime } from "@/lib/utils";

type Tab = "leads" | "signals";

const Checkbox: React.FC<{ checked: boolean; onChange: () => void; label: string; indeterminate?: boolean }> = ({
  checked,
  onChange,
  label,
  indeterminate,
}) => (
  <input
    type="checkbox"
    aria-label={label}
    checked={checked}
    ref={(el) => {
      if (el) el.indeterminate = Boolean(indeterminate);
    }}
    onChange={onChange}
    onClick={(e) => e.stopPropagation()}
    className="h-4 w-4 accent-primary cursor-pointer"
  />
);

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

const StepsTable: React.FC<{ detail: AgentRunDetail }> = ({ detail }) => (
  <div className="rounded-lg border border-border overflow-hidden">
    <table className="w-full text-left text-xs">
      <thead className="bg-muted/50 text-muted-foreground border-b border-border">
        <tr>
          <th className="py-2 px-3 font-medium">Step</th>
          <th className="py-2 px-3 font-medium">Status</th>
          <th className="py-2 px-3 font-medium">Details</th>
          <th className="py-2 px-3 font-medium">Duration</th>
          <th className="py-2 px-3 font-medium">Tokens</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {detail.steps.map((s) => (
          <tr key={s.id} className="align-top">
            <td className="py-2 px-3 text-foreground whitespace-nowrap">{s.name}</td>
            <td className="py-2 px-3">
              <StatusBadge status={s.status.replace(/_/g, " ")} className="text-[10px]" />
            </td>
            <td className="py-2 px-3 text-muted-foreground">
              {s.output && (
                <span className="font-mono break-words">
                  {Object.entries(s.output)
                    .filter(([, v]) => typeof v === "number" || typeof v === "string")
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </span>
              )}
              {s.error && <p className="mt-0.5 text-rose-500 break-words">{s.error}</p>}
            </td>
            <td className="py-2 px-3 text-muted-foreground tabular-nums whitespace-nowrap">{formatDuration(s.durationMs)}</td>
            <td className="py-2 px-3 text-muted-foreground tabular-nums">{s.tokensUsed || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const LeadRow: React.FC<{ lead: Lead; selected: boolean; onToggle: () => void }> = ({ lead, selected, onToggle }) => (
  <tr className={cn("align-top hover:bg-muted/40", selected && "bg-primary/5")}>
    <td className="py-2.5 px-3">
      <Checkbox checked={selected} onChange={onToggle} label={`Select ${lead.name}`} />
    </td>
    <td className="py-2.5 px-3 min-w-[180px]">
      <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-foreground hover:text-primary hover:underline">
        {lead.name}
      </Link>
      {lead.title && <p className="text-xs text-muted-foreground">{lead.title}</p>}
    </td>
    <td className="py-2.5 px-3 text-xs text-foreground whitespace-nowrap">
      {lead.phone && lead.phone !== "Not available" ? lead.phone : "—"}
    </td>
    <td className="py-2.5 px-3 text-xs">
      {lead.profileUrl ? (
        <a href={lead.profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ExternalLink className="w-3.5 h-3.5" /> Website
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </td>
    <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-[260px]">
      <span className="line-clamp-2" title={lead.location}>
        {lead.location || "—"}
      </span>
    </td>
    <td className="py-2.5 px-3">
      <ScoreBadge score={lead.score} />
    </td>
    <td className="py-2.5 px-3">
      <StatusBadge status={lead.status} />
    </td>
  </tr>
);

const SignalRow: React.FC<{
  signal: IntentSignal;
  selected: boolean;
  onToggle: () => void;
  onConvert: () => void;
  isConverting: boolean;
}> = ({ signal, selected, onToggle, onConvert, isConverting }) => (
  <tr className={cn("align-top hover:bg-muted/40", selected && "bg-primary/5", signal.contactRequested && "bg-emerald-500/5")}>
    <td className="py-2.5 px-3">
      <Checkbox checked={selected} onChange={onToggle} label="Select signal" />
    </td>
    <td className="py-2.5 px-3">
      <div className="flex flex-col items-start gap-1.5">
        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border border-border bg-muted text-foreground whitespace-nowrap">
          {signal.platform || signal.sourceChannel}
        </span>
        <RequestedContactBadge signal={signal} />
        <SignalGuardianBadge signal={signal} />
      </div>
    </td>
    <td className="py-2.5 px-3 text-xs text-foreground max-w-[140px] truncate" title={signal.authorHandle ?? undefined}>
      {signal.authorHandle || "—"}
    </td>
    <td className="py-2.5 px-3 text-xs text-foreground min-w-[240px] max-w-[360px]">
      <p className="line-clamp-3 leading-relaxed" title={signal.postExcerpt}>
        {signal.postExcerpt || "—"}
      </p>
      {signal.postUrl && (
        <a
          href={signal.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" /> View post
        </a>
      )}
    </td>
    <td className="py-2.5 px-3 min-w-[160px]">
      {signal.contactRequested ? <PublishedContact signal={signal} /> : <span className="text-xs text-muted-foreground">—</span>}
    </td>
    <td className="py-2.5 px-3 text-xs text-foreground">{signal.courseInterest || "—"}</td>
    <td className="py-2.5 px-3">
      <ScoreBadge score={signal.intentScore} />
    </td>
    <td className="py-2.5 px-3">
      {signal.status === "routed" ? (
        <span className="text-xs text-emerald-500 whitespace-nowrap">In leads</span>
      ) : (
        <Button variant="outline" size="sm" onClick={onConvert} isLoading={isConverting} className="whitespace-nowrap">
          {!isConverting && <UserPlus className="w-3.5 h-3.5" />} Convert to lead
        </Button>
      )}
    </td>
  </tr>
);

const ResultsPanel: React.FC<{ detail: AgentRunDetail }> = ({ detail }) => {
  const { leads, signals } = detail;
  const [tab, setTab] = useState<Tab>(leads.length > 0 || signals.length === 0 ? "leads" : "signals");
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [selectedSignals, setSelectedSignals] = useState<Set<string>>(new Set());
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const convert = useConvertSignals();
  const addToCampaign = useAddLeadsToCampaign();
  const isManager = useHasRole("manager");
  const createDeals = useCreateDealsForLeads();
  const busy = convert.isPending || addToCampaign.isPending || createDeals.isPending;

  useEffect(() => {
    setSelectedLeads(new Set());
    setSelectedSignals(new Set());
  }, [detail.run.id]);

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const signalById = useMemo(() => new Map(signals.map((s) => [s.id, s])), [signals]);
  const selectedCount = selectedLeads.size + selectedSignals.size;

  /** Selected leads plus selected signals converted to leads (rejects when conversion fails; already toasted). */
  const resolveLeads = async (): Promise<Pick<Lead, "id" | "name" | "company">[]> => {
    const picked = Array.from(selectedLeads)
      .map((id) => leadById.get(id))
      .filter((l): l is Lead => Boolean(l));
    if (selectedSignals.size === 0) return picked;
    const result = await convert.mutateAsync(Array.from(selectedSignals));
    const converted = result.results.map((r) => {
      const s = signalById.get(r.signalId);
      return { id: r.leadId, name: s?.authorHandle || `${s?.platform || "web"} user`, company: "" };
    });
    return [...picked, ...converted];
  };

  const clearSelection = () => {
    setSelectedLeads(new Set());
    setSelectedSignals(new Set());
  };

  const handleAddToLeads = async () => {
    try {
      await convert.mutateAsync(Array.from(selectedSignals));
      setSelectedSignals(new Set());
    } catch {
      // toast already shown
    }
  };

  const handleCampaign = async (campaignId: string) => {
    try {
      const resolved = await resolveLeads();
      if (resolved.length === 0) return;
      await addToCampaign.mutateAsync({ id: campaignId, leadIds: Array.from(new Set(resolved.map((l) => l.id))) });
      setCampaignOpen(false);
      clearSelection();
    } catch {
      // toast already shown
    }
  };

  const handleDeals = async () => {
    try {
      const resolved = await resolveLeads();
      if (resolved.length === 0) return;
      await createDeals.mutateAsync(resolved);
      clearSelection();
    } catch {
      // toast already shown
    }
  };

  const handleConvertOne = async (id: string) => {
    setConvertingId(id);
    try {
      await convert.mutateAsync([id]);
    } catch {
      // toast already shown
    } finally {
      setConvertingId(null);
    }
  };

  const allLeads = leads.length > 0 && selectedLeads.size === leads.length;
  const convertible = signals.filter((s) => s.status !== "routed");
  const allSignals = signals.length > 0 && selectedSignals.size === signals.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
          {(
            [
              ["leads", `Business leads (${leads.length})`, Building2],
              ["signals", `Intent signals (${signals.length})`, MessageSquare],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
          <Button
            variant="outline"
            size="sm"
            disabled={selectedSignals.size === 0 || busy}
            isLoading={convert.isPending && !convertingId}
            onClick={handleAddToLeads}
            title="Convert the selected intent signals into leads"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add to leads
          </Button>
          {isManager && (
            <Button variant="outline" size="sm" disabled={selectedCount === 0 || busy} onClick={() => setCampaignOpen(true)}>
              <Megaphone className="w-3.5 h-3.5" /> Add to campaign
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={selectedCount === 0 || busy} isLoading={createDeals.isPending} onClick={handleDeals}>
            <Briefcase className="w-3.5 h-3.5" /> Create deals
          </Button>
        </div>
      </div>

      {tab === "leads" ? (
        leads.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No new business leads"
            description={
              detail.run.sources.includes("places")
                ? "No new matching businesses were found, or they were all already in your leads."
                : "This run did not search business listings."
            }
          />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs border-b border-border">
                <tr>
                  <th className="py-2.5 px-3 w-8">
                    <Checkbox
                      checked={allLeads}
                      indeterminate={selectedLeads.size > 0 && !allLeads}
                      onChange={() => setSelectedLeads(allLeads ? new Set() : new Set(leads.map((l) => l.id)))}
                      label="Select all leads"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-medium">Business</th>
                  <th className="py-2.5 px-3 font-medium">Phone</th>
                  <th className="py-2.5 px-3 font-medium">Website</th>
                  <th className="py-2.5 px-3 font-medium">Address</th>
                  <th className="py-2.5 px-3 font-medium">Fit score</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {leads.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    selected={selectedLeads.has(lead.id)}
                    onToggle={() => setSelectedLeads((s) => toggle(s, lead.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : signals.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No intent signals"
          description={
            detail.run.sources.includes("web")
              ? "No public posts from prospective customers were found for this query and location."
              : "This run did not search web posts."
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs border-b border-border">
              <tr>
                <th className="py-2.5 px-3 w-8">
                  <Checkbox
                    checked={allSignals}
                    indeterminate={selectedSignals.size > 0 && !allSignals}
                    onChange={() => setSelectedSignals(allSignals ? new Set() : new Set(signals.map((s) => s.id)))}
                    label="Select all signals"
                  />
                </th>
                <th className="py-2.5 px-3 font-medium">Platform</th>
                <th className="py-2.5 px-3 font-medium">Public user</th>
                <th className="py-2.5 px-3 font-medium">What they said</th>
                <th className="py-2.5 px-3 font-medium">Requested contact</th>
                <th className="py-2.5 px-3 font-medium">Interest</th>
                <th className="py-2.5 px-3 font-medium">Intent</th>
                <th className="py-2.5 px-3 font-medium">
                  <span className="sr-only">Actions</span>
                  {convertible.length > 0 ? `${convertible.length} to convert` : ""}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {signals.map((signal) => (
                <SignalRow
                  key={signal.id}
                  signal={signal}
                  selected={selectedSignals.has(signal.id)}
                  onToggle={() => setSelectedSignals((s) => toggle(s, signal.id))}
                  onConvert={() => handleConvertOne(signal.id)}
                  isConverting={convertingId === signal.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CampaignPickerModal
        isOpen={campaignOpen}
        count={selectedCount}
        isSubmitting={convert.isPending || addToCampaign.isPending}
        onClose={() => setCampaignOpen(false)}
        onConfirm={handleCampaign}
      />
    </div>
  );
};

export const RunDetail: React.FC<{ agentId: string; runId: string }> = ({ agentId, runId }) => {
  const run = useAgentRun(agentId, runId);

  return (
    <QueryState query={run} errorTitle="Couldn't load this run">
      {(detail) => {
        const r = detail.run;
        const active = r.status === "queued" || r.status === "running";
        return (
          <div className="space-y-4">
            <Card className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-medium text-foreground truncate">
                    “{r.query}” in {r.location || "—"}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.sources.map((s) => SOURCE_LABELS[s]).join(" + ")} · up to {r.maxResults ?? "—"} per source · started{" "}
                    {formatDateTime(r.startedAt ?? r.createdAt)}
                  </p>
                </div>
                <RunStatusBadge status={r.status} />
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                {[
                  ["New leads", r.leadsCreated ?? "—"],
                  ["Intent signals", r.signalsSaved ?? "—"],
                  ["Duplicates skipped", r.duplicates ?? "—"],
                  ["High score (80+)", r.highScore],
                  ["Duration", active ? "running…" : formatDuration(r.durationMs)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-foreground tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>

              {active && (
                <p className="text-xs text-muted-foreground">
                  {r.status === "queued" ? "Waiting for a worker to pick up the run…" : "Searching and scoring results. This page updates automatically."}
                </p>
              )}

              {detail.errors.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" /> {detail.errors.length} issue{detail.errors.length === 1 ? "" : "s"} during this run
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {detail.errors.slice(0, 10).map((e, i) => (
                      <li key={i} className="break-words">
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.steps.length > 0 && <StepsTable detail={detail} />}
            </Card>

            {!active && <ResultsPanel detail={detail} />}
          </div>
        );
      }}
    </QueryState>
  );
};
