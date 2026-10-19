"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  MailOpen,
  Megaphone,
  MessageSquareReply,
  MousePointerClick,
  Pause,
  Pencil,
  Play,
  Rocket,
  Send,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { MetricCard } from "@/components/ui/MetricCard";
import { LoadingState, QueryState } from "@/components/ui/QueryState";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  CampaignFunnel,
  CampaignStatusBadge,
  ChannelBadge,
  RECIPIENT_STATUS_LABELS,
  RecipientStatusBadge,
  describeSendWindow,
  formatDateTime,
  formatDelay,
  formatPercent,
} from "@/components/campaigns/shared";
import {
  useCampaign,
  useCampaignRecipients,
  useDeleteCampaign,
  useHasRole,
  useLaunchCampaign,
  useMarkRecipientReplied,
  useMe,
  usePauseCampaign,
  useRemoveRecipient,
  useResumeCampaign,
} from "@/hooks";
import { cn } from "@/lib/utils";
import type { CampaignDetail, CampaignRecipient, RecipientStatus } from "@/types";

const RECIPIENT_PAGE_SIZE = 25;
const RECIPIENT_FILTERS: (RecipientStatus | "all")[] = [
  "all",
  "active",
  "completed",
  "replied",
  "bounced",
  "unsubscribed",
  "failed",
  "skipped",
  "pending",
];

function lastActivity(r: CampaignRecipient): string {
  const m = r.lastMessage;
  if (!m) return r.status === "active" && r.nextRunAt ? `Next send ${formatDateTime(r.nextRunAt)}` : "—";
  const latest =
    (m.repliedAt && `Replied ${formatDateTime(m.repliedAt)}`) ||
    (m.bouncedAt && `Bounced ${formatDateTime(m.bouncedAt)}`) ||
    (m.failedAt && `Failed ${formatDateTime(m.failedAt)}`) ||
    (m.clickedAt && `Clicked ${formatDateTime(m.clickedAt)}`) ||
    (m.openedAt && `Opened ${formatDateTime(m.openedAt)}`) ||
    (m.deliveredAt && `Delivered ${formatDateTime(m.deliveredAt)}`) ||
    (m.sentAt && `Sent ${formatDateTime(m.sentAt)}`) ||
    "Queued";
  return latest;
}

function RecipientsTable({ campaign, canManage }: { campaign: CampaignDetail; canManage: boolean }) {
  const [status, setStatus] = useState<RecipientStatus | "all">("all");
  const [page, setPage] = useState(1);
  const live = campaign.status === "active" || campaign.status === "scheduled";
  const query = useCampaignRecipients(
    campaign.id,
    { page, pageSize: RECIPIENT_PAGE_SIZE, status: status === "all" ? undefined : status },
    live
  );
  const remove = useRemoveRecipient();
  const markReplied = useMarkRecipientReplied();
  const counts = campaign.stats.recipientsByStatus;

  return (
    <Card className="space-y-4 p-0 overflow-hidden">
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" /> Recipients
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {RECIPIENT_FILTERS.map((f) => {
            const n = f === "all" ? campaign.stats.recipients : counts[f];
            if (f !== "all" && !n) return null;
            return (
              <button
                key={f}
                onClick={() => {
                  setStatus(f);
                  setPage(1);
                }}
                className={cn(
                  "h-7 rounded-lg px-2.5 text-xs font-medium border transition-colors",
                  status === f ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {f === "all" ? "All" : RECIPIENT_STATUS_LABELS[f]} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      </div>
      <QueryState
        query={query}
        loading={<LoadingState rows={5} className="px-5 pb-5" />}
        isEmpty={(d) => d.data.length === 0}
        empty={{
          icon: Users,
          title: "No recipients yet",
          description:
            campaign.status === "draft"
              ? "Recipients are created at launch from the audience filter and leads added from the Leads page."
              : "No recipients with this status.",
        }}
      >
        {(result) => (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-border bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Lead</th>
                    <th className="px-3 py-2 text-left font-medium">{campaign.channel === "email" ? "Email" : "Phone"}</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Step</th>
                    <th className="px-3 py-2 text-left font-medium">Last activity</th>
                    {canManage && <th className="px-5 py-2 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.data.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-5 py-2.5">
                        <Link href={`/leads/${r.leadId}`} className="font-medium text-foreground hover:text-primary">
                          {r.lead?.name || "Unnamed lead"}
                        </Link>
                        {r.lead?.company && r.lead.company !== "Not available" && (
                          <div className="text-xs text-muted-foreground">{r.lead.company}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {r.lastMessage?.toAddress || (campaign.channel === "email" ? r.lead?.email : r.lead?.phone) || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <RecipientStatusBadge status={r.status} />
                        {r.lastError && (
                          <div className="mt-1 max-w-[240px] text-[11px] text-muted-foreground line-clamp-2" title={r.lastError}>
                            {r.lastError}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                        {Math.min(r.currentStep + 1, campaign.steps.length || 1)} / {campaign.steps.length}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{lastActivity(r)}</td>
                      {canManage && (
                        <td className="px-5 py-2.5 text-right whitespace-nowrap">
                          {r.lastMessage && ["active", "completed"].includes(r.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markReplied.mutate({ id: campaign.id, recipientId: r.id })}
                              disabled={markReplied.isPending}
                              title="Stops the sequence for this lead"
                            >
                              Mark replied
                            </Button>
                          )}
                          {["pending", "skipped"].includes(r.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => remove.mutate({ id: campaign.id, recipientId: r.id })}
                              disabled={remove.isPending}
                            >
                              Remove
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.meta.totalPages > 1 && (
              <div className="flex items-center justify-between px-5 pb-4 text-sm text-muted-foreground">
                <span>
                  Page {result.meta.page} of {result.meta.totalPages} · {result.meta.total} recipients
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= result.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </QueryState>
    </Card>
  );
}

function CampaignView({ campaign }: { campaign: CampaignDetail }) {
  const router = useRouter();
  const canManage = useHasRole("manager");
  const me = useMe();
  const launch = useLaunchCampaign();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const del = useDeleteCampaign();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const { stats } = campaign;
  const isEmail = campaign.channel === "email";
  const running = campaign.status === "active" || campaign.status === "scheduled";

  const actions = canManage && (
    <>
      {campaign.status !== "completed" && (
        <Link href={`/campaigns/${campaign.id}/edit`}>
          <Button variant="outline" size="sm">
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        </Link>
      )}
      {campaign.status === "draft" && (
        <Button size="sm" onClick={() => setConfirmLaunch(true)} disabled={!campaign.channelReady} title={campaign.channelError ?? undefined}>
          <Rocket className="h-4 w-4" /> {campaign.scheduledAt && new Date(campaign.scheduledAt) > new Date() ? "Schedule" : "Launch"}
        </Button>
      )}
      {running && (
        <Button variant="outline" size="sm" onClick={() => pause.mutate(campaign.id)} isLoading={pause.isPending}>
          <Pause className="h-4 w-4" /> Pause
        </Button>
      )}
      {campaign.status === "paused" && (
        <Button size="sm" onClick={() => resume.mutate(campaign.id)} isLoading={resume.isPending} disabled={!campaign.channelReady}>
          <Play className="h-4 w-4" /> Resume
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Delete campaign">
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/campaigns" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All campaigns
        </Link>
      </div>
      <PageHeader title={campaign.name} description={campaign.description ?? undefined} icon={Megaphone} actions={actions} />
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground -mt-3">
        <CampaignStatusBadge status={campaign.status} />
        <ChannelBadge channel={campaign.channel} />
        {campaign.status === "scheduled" && <span>Starts {formatDateTime(campaign.scheduledAt)}</span>}
        {campaign.launchedAt && <span>Launched {formatDateTime(campaign.launchedAt)}</span>}
        {campaign.completedAt && <span>Completed {formatDateTime(campaign.completedAt)}</span>}
      </div>

      {!campaign.channelReady && campaign.status !== "completed" && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
          <div>
            <p className="text-foreground">{campaign.channelError}</p>
            <Link href="/integrations" className="text-primary text-xs hover:underline">
              Open Integrations
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard title="Recipients" value={stats.recipients - stats.recipientsByStatus.skipped} icon={<Users className="h-4 w-4" />} subtitle={stats.recipientsByStatus.skipped ? `${stats.recipientsByStatus.skipped} skipped` : undefined} />
        <MetricCard title="Sent" value={stats.sent.toLocaleString()} icon={<Send className="h-4 w-4" />} />
        <MetricCard title="Delivered" value={formatPercent(stats.deliveryRate)} icon={<CheckCircle2 className="h-4 w-4" />} subtitle={`${stats.delivered} messages`} />
        <MetricCard title={isEmail ? "Opened" : "Read"} value={formatPercent(stats.openRate)} icon={<MailOpen className="h-4 w-4" />} subtitle={`${stats.opened} messages`} />
        {isEmail && <MetricCard title="Clicked" value={formatPercent(stats.clickRate)} icon={<MousePointerClick className="h-4 w-4" />} subtitle={`${stats.clicked} messages`} />}
        <MetricCard title="Replied" value={formatPercent(stats.replyRate)} icon={<MessageSquareReply className="h-4 w-4" />} subtitle={`${stats.replied} replies`} />
        {!isEmail && <MetricCard title="Bounced" value={formatPercent(stats.bounceRate)} icon={<XCircle className="h-4 w-4" />} subtitle={`${stats.bounced} messages`} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
        <Card className="space-y-4">
          <h2 className="text-base font-semibold text-foreground">Funnel</h2>
          <CampaignFunnel stages={campaign.funnel} />
          <p className="text-xs text-muted-foreground">
            Bounced {stats.bounced} · Failed {stats.failed} · Unsubscribed {stats.recipientsByStatus.unsubscribed}.
            {isEmail && " Opens depend on open tracking being enabled for your Resend domain; email replies arrive in your inbox — use “Mark replied”."}
          </p>
        </Card>
        <Card className="space-y-4">
          <h2 className="text-base font-semibold text-foreground">Sequence</h2>
          <ol className="space-y-2">
            {campaign.steps.map((s, i) => (
              <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  {i + 1}. {i === 0 ? (s.delayMinutes ? formatDelay(s.delayMinutes).replace("later", "after launch") : "At launch") : formatDelay(s.delayMinutes)}
                </div>
                <div className="text-foreground truncate">
                  {isEmail ? s.subject || "(no subject)" : `Template: ${s.whatsappTemplate?.name ?? "(none)"} (${s.whatsappTemplate?.language ?? "—"})`}
                </div>
              </li>
            ))}
            {campaign.steps.length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
          </ol>
          <dl className="space-y-2 text-sm border-t border-border pt-3">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Sending hours</dt>
              <dd className="text-right text-foreground">{describeSendWindow(campaign.sendWindow, me.data?.settings.timezone)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Throttle</dt>
              <dd className="text-foreground">{campaign.throttlePerHour} / hour</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Audience</dt>
              <dd className="text-right text-foreground">
                {campaign.audienceFilter.type === "manual" ? "Leads added manually" : "Leads matching filters"}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <RecipientsTable campaign={campaign} canManage={canManage} />

      <Modal
        isOpen={confirmLaunch}
        onClose={() => setConfirmLaunch(false)}
        title="Launch campaign?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmLaunch(false)}>
              Cancel
            </Button>
            <Button
              isLoading={launch.isPending}
              onClick={() => launch.mutate(campaign.id, { onSettled: () => setConfirmLaunch(false) })}
            >
              <Rocket className="h-4 w-4" /> Launch
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Real {isEmail ? "emails" : "WhatsApp messages"} will be sent to every eligible lead in the audience, at most{" "}
          {campaign.throttlePerHour} per hour
          {campaign.sendWindow.start ? ` during ${describeSendWindow(campaign.sendWindow, me.data?.settings.timezone)}` : ""}. Leads
          that are do-not-contact, unsubscribed or without consent are skipped.
        </p>
      </Modal>

      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete campaign?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              isLoading={del.isPending}
              onClick={() => del.mutate(campaign.id, { onSuccess: () => router.push("/campaigns") })}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          This stops any queued sends and deletes the campaign, its steps and recipients. Sent message history stays on each lead&apos;s
          timeline.
        </p>
      </Modal>
    </div>
  );
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const query = useCampaign(params.id);
  return (
    <QueryState query={query} errorTitle="Couldn't load this campaign" loading={<LoadingState rows={6} />}>
      {(campaign) => <CampaignView campaign={campaign} />}
    </QueryState>
  );
}
