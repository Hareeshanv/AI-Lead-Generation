"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Megaphone, Plus, Search } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QueryState } from "@/components/ui/QueryState";
import { PageHeader } from "@/components/layout/PageHeader";
import { CampaignStatusBadge, ChannelBadge, formatPercent } from "@/components/campaigns/shared";
import { useDebounced } from "@/hooks/useDebounced";
import { useCampaigns, useHasRole, usePauseCampaign, useResumeCampaign } from "@/hooks";
import { cn, formatDateTime } from "@/lib/utils";
import type { Campaign, CampaignStatus } from "@/types";

const PAGE_SIZE = 12;
const STATUS_TABS: { value: CampaignStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

function CampaignCard({ campaign, canManage }: { campaign: Campaign; canManage: boolean }) {
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const running = campaign.status === "active" || campaign.status === "scheduled";
  const when =
    campaign.status === "scheduled"
      ? `Starts ${formatDateTime(campaign.scheduledAt)}`
      : campaign.launchedAt
        ? `Launched ${formatDateTime(campaign.launchedAt)}`
        : `Created ${formatDateTime(campaign.createdAt)}`;

  return (
    <Card className="flex flex-col justify-between gap-4">
      <Link href={`/campaigns/${campaign.id}`} className="block space-y-3 group">
        <div className="flex items-center justify-between gap-2">
          <CampaignStatusBadge status={campaign.status} />
          <ChannelBadge channel={campaign.channel} />
        </div>
        <div>
          <h3 className="font-medium text-foreground text-base group-hover:text-primary transition-colors truncate">{campaign.name}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {when} · {campaign.stepsCount ?? 0} step{campaign.stepsCount === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            {campaign.sentCount.toLocaleString()} sent · {campaign.totalLeads.toLocaleString()} recipients
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: campaign.channel === "whatsapp" ? "Read rate" : "Open rate", value: campaign.openRate },
            { label: "Click rate", value: campaign.channel === "whatsapp" ? null : campaign.clickRate },
            { label: "Reply rate", value: campaign.replyRate },
          ].map((m) => (
            <div key={m.label} className="p-2 rounded-lg bg-muted/40 border border-border">
              <div className="text-[11px] text-muted-foreground">{m.label}</div>
              <div className="text-sm font-medium text-foreground tabular-nums mt-0.5">{m.value === null ? "—" : formatPercent(m.value)}</div>
            </div>
          ))}
        </div>
      </Link>
      {canManage && (running || campaign.status === "paused") && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          isLoading={pause.isPending || resume.isPending}
          onClick={() => (running ? pause.mutate(campaign.id) : resume.mutate(campaign.id))}
        >
          {running ? "Pause campaign" : "Resume campaign"}
        </Button>
      )}
    </Card>
  );
}

export default function CampaignsPage() {
  const canManage = useHasRole("manager");
  const [status, setStatus] = useState<CampaignStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search.trim());
  const query = useCampaigns({
    page,
    pageSize: PAGE_SIZE,
    status: status === "all" ? undefined : status,
    q: debouncedSearch || undefined,
  });
  const meta = query.data?.meta;
  const filtered = status !== "all" || search.trim() !== "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Email and WhatsApp sequences with delivery, open and reply tracking."
        icon={Megaphone}
        actions={
          canManage && (
            <Link href="/campaigns/new" className={buttonClassName({ size: "sm" })}>
              <Plus className="h-4 w-4" /> New campaign
            </Link>
          )
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={status === tab.value}
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-medium border transition-colors",
                status === tab.value
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="sm:w-64">
          <Input
            icon={<Search className="h-4 w-4" />}
            placeholder="Search campaigns"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Search campaigns"
          />
        </div>
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        errorTitle="Couldn't load campaigns"
        empty={{
          icon: Megaphone,
          title: filtered ? "No campaigns match" : "No campaigns yet",
          description: filtered
            ? "Try another status or search."
            : canManage
              ? "Create an email or WhatsApp sequence and launch it to your leads."
              : "Campaigns created by managers will appear here.",
          action:
            !filtered && canManage ? (
              <Link href="/campaigns/new" className={buttonClassName({ size: "sm", variant: "outline" })}>
                <Plus className="h-4 w-4" /> New campaign
              </Link>
            ) : undefined,
        }}
      >
        {(result) => (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {result.data.map((c) => (
                <CampaignCard key={c.id} campaign={c} canManage={canManage} />
              ))}
            </div>
            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Page {meta.page} of {meta.totalPages} · {meta.total} campaigns
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}
