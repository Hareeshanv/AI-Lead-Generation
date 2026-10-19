"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Briefcase,
  Building,
  CalendarClock,
  ExternalLink,
  FileText,
  History,
  Mail,
  MapPin,
  Megaphone,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  UserX,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState, LoadingState, QueryState } from "@/components/ui/QueryState";
import { SourcePlatformBadge, AudienceBadge, GuardianConsentBadge } from "@/components/ui/LeadBadges";
import { ActivityTimeline, OwnerSelect, TaskList, formatDateTime, formatRelative, smallSelectClassName } from "@/components/crm/shared";
import { DealFormModal } from "@/components/crm/DealFormModal";
import { DealDrawer } from "@/components/crm/DealDrawer";
import { LeadFormModal } from "@/components/leads/LeadFormModal";
import { AddToCampaignModal } from "@/components/leads/AddToCampaignModal";
import {
  useAddLeadActivity,
  useAddLeadTask,
  useDeleteLead,
  useEraseLead,
  useLead,
  useLeadActivities,
  useLeadTasks,
  useRescoreLead,
  useUpdateLead,
} from "@/hooks/useLeads";
import { useDeals, useDeleteActivity, useDeleteTask, useMoveDeal, useUpdateTask } from "@/hooks/useDeals";
import { useHasRole, useMe } from "@/hooks/useMe";
import { ApiError } from "@/services/api/http";
import { cn, formatConsentTime, formatCurrency } from "@/lib/utils";
import { LEAD_STATUSES, leadSourceLabel, scoreBadgeClass } from "@/lib/analytics";
import type { Deal, DealStage, LeadStatus } from "@/types";

const hasContact = (value?: string | null) => Boolean(value && value !== "Not available");

const CHANNEL_LABEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", sms: "SMS", call: "Call" };

const DetailRows: React.FC<{ rows: [string, React.ReactNode][] }> = ({ rows }) => (
  <div className="text-sm">
    {rows.map(([label, value]) => (
      <div key={label} className="flex justify-between gap-3 py-2 border-b border-border/60 last:border-b-0">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground text-right break-words">{value}</span>
      </div>
    ))}
  </div>
);

const CardTitle: React.FC<{ icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode }> = ({ icon: Icon, children, action }) => (
  <div className="mb-3 flex items-center justify-between gap-2">
    <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
      <Icon className="w-4 h-4 text-muted-foreground" /> {children}
    </h2>
    {action}
  </div>
);

const presentRows = (rows: [string, React.ReactNode][]) => rows.filter(([, value]) => value !== null && value !== undefined && value !== "");

const STAGE_BADGE: Record<DealStage, "default" | "secondary" | "success" | "warning" | "danger" | "indigo"> = {
  New: "secondary",
  Qualified: "indigo",
  Proposal: "default",
  Negotiation: "warning",
  "Closed Won": "success",
  "Closed Lost": "danger",
};

export default function LeadDetailPage() {
  const params = useParams();
  const leadId = params?.id as string;
  const router = useRouter();
  const me = useMe();
  const isManager = useHasRole("manager");

  const leadQuery = useLead(leadId);
  const activities = useLeadActivities(leadId);
  const tasks = useLeadTasks(leadId);
  const dealParams = { leadId };
  const deals = useDeals(dealParams);
  const moveDeal = useMoveDeal(dealParams);

  const updateLead = useUpdateLead(null);
  const rescore = useRescoreLead();
  const deleteLead = useDeleteLead();
  const eraseLead = useEraseLead();
  const addActivity = useAddLeadActivity(leadId);
  const addTask = useAddLeadTask(leadId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const deleteActivity = useDeleteActivity();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDealOpen, setIsDealOpen] = useState(false);
  const [isCampaignOpen, setIsCampaignOpen] = useState(false);
  const [isEraseOpen, setIsEraseOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [openDealId, setOpenDealId] = useState<string | null>(null);

  const backLink = (
    <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-4 h-4" /> Back to leads
    </Link>
  );

  if (leadQuery.isLoading) {
    return (
      <>
        {backLink}
        <LoadingState rows={4} />
      </>
    );
  }

  const lead = leadQuery.data;
  if (!lead) {
    const notFound = leadQuery.error instanceof ApiError && leadQuery.error.status === 404;
    return (
      <>
        {backLink}
        {notFound || !leadQuery.isError ? (
          <EmptyState
            icon={UserX}
            title="Lead not found"
            description="This lead may have been deleted or erased, or the link is incorrect."
            actionLabel="Back to leads"
            onAction={() => router.push("/leads")}
          />
        ) : (
          <ErrorState title="Couldn't load this lead" error={leadQuery.error} onRetry={() => void leadQuery.refetch()} />
        )}
      </>
    );
  }

  const patchLead = (patch: Parameters<typeof updateLead.mutate>[0]["patch"]) => updateLead.mutate({ id: lead.id, patch });

  const handleErase = async () => {
    try {
      await eraseLead.mutateAsync(lead.id);
      setIsEraseOpen(false);
      router.push("/leads");
    } catch {
      // toast shown
    }
  };

  const handleDelete = async () => {
    try {
      await deleteLead.mutateAsync(lead.id);
      setIsDeleteOpen(false);
      router.push("/leads");
    } catch {
      // toast shown
    }
  };

  const companyRows = presentRows([
    ["Company", lead.company],
    ["Industry", lead.industry],
    ["Employees", lead.companySize],
    ["Annual revenue", lead.annualRevenue],
  ]);

  const recordRows = presentRows([
    ["Source", leadSourceLabel(lead)],
    ["Pipeline stage", lead.stage],
    ["Last contacted", lead.lastContactedAt ? formatRelative(lead.lastContactedAt) : "Never"],
    [
      "Consent",
      lead.consentChannel && lead.consentChannel.length > 0 ? lead.consentChannel.map((c) => CHANNEL_LABEL[c] ?? c).join(", ") : "None recorded",
    ],
    ["Created", formatConsentTime(lead.createdAt)],
    ["Last updated", formatConsentTime(lead.updatedAt)],
    [
      "Profile",
      lead.profileUrl ? (
        <a href={lead.profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          Open <ExternalLink className="w-3.5 h-3.5" />
        </a>
      ) : null,
    ],
  ]);

  const adRows = presentRows([
    ["Campaign", lead.campaignName],
    ["Ad", lead.adName],
    ["Form ID", lead.formId],
    ["Course interest", lead.courseInterest],
    ["Exam year", lead.examYear],
    ["Filled by", lead.isGuardian == null ? null : lead.isGuardian ? "Parent / Guardian" : "Student"],
    ["Consent given", formatConsentTime(lead.consentAt)],
    ["Scored", formatConsentTime(lead.scoredAt)],
  ]);

  const onMove = (deal: Deal, stage: DealStage, lostReason?: string | null) => moveDeal.mutate({ id: deal.id, stage, lostReason });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {backLink}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsCampaignOpen(true)} disabled={lead.doNotContact}>
            <Megaphone className="w-4 h-4" /> Add to campaign
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsDealOpen(true)}>
            <Briefcase className="w-4 h-4" /> Create deal
          </Button>
          {isManager && (
            <Button variant="ghost" size="sm" onClick={() => setIsDeleteOpen(true)} aria-label="Delete lead" title="Delete lead">
              <Trash2 className="w-4 h-4 text-rose-500" />
            </Button>
          )}
        </div>
      </div>

      {/* Profile header */}
      <Card className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5 min-w-0">
          <Avatar src={lead.avatar} name={lead.name} size="lg" className="w-16 h-16" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground mr-1">{lead.name}</h1>
              <SourcePlatformBadge platform={lead.sourcePlatform} />
              <AudienceBadge isGuardian={lead.isGuardian} />
              <GuardianConsentBadge lead={lead} />
              {lead.doNotContact && (
                <Badge variant="danger" className="text-[10px] gap-1">
                  <Ban className="w-3 h-3" /> Do not contact
                </Badge>
              )}
            </div>
            {(lead.title || lead.company) && <p className="text-sm text-muted-foreground mt-0.5">{[lead.title, lead.company].filter(Boolean).join(" at ")}</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
              {lead.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> {lead.location}
                </span>
              )}
              {hasContact(lead.email) && (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:text-foreground">
                  <Mail className="w-3.5 h-3.5" /> {lead.email}
                </a>
              )}
              {hasContact(lead.phone) && (
                <a href={`tel:${lead.phone}`} className="flex items-center gap-1 hover:text-foreground">
                  <Phone className="w-3.5 h-3.5" /> {lead.phone}
                </a>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Status
                <select
                  value={lead.status}
                  disabled={updateLead.isPending}
                  onChange={(e) => patchLead({ status: e.target.value as LeadStatus })}
                  className={smallSelectClassName}
                  aria-label="Lead status"
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Owner
                <OwnerSelect small value={lead.ownerId} disabled={updateLead.isPending} onChange={(ownerId) => patchLead({ ownerId })} />
              </label>
            </div>
          </div>
        </div>

        <div className="shrink-0 text-center rounded-xl border border-border px-5 py-3">
          <div className="text-xs text-muted-foreground font-medium">Fit score</div>
          <div className={cn("mt-1 inline-flex px-3 py-0.5 rounded-full border font-mono text-2xl font-semibold", scoreBadgeClass(lead.score))}>{lead.score}</div>
          <div>
            <button
              type="button"
              onClick={() => rescore.mutate(lead.id)}
              disabled={rescore.isPending}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <RefreshCw className={cn("w-3 h-3", rescore.isPending && "animate-spin")} /> Rescore
            </button>
          </div>
        </div>
      </Card>

      {lead.needsGuardianConsent && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-600 dark:text-rose-300">
          Student under 18 without guardian confirmation. Excluded from automated outreach until a guardian confirms consent.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardTitle icon={CalendarClock}>Follow-ups</CardTitle>
            <TaskList
              query={tasks}
              onAdd={(input) => addTask.mutateAsync(input)}
              isAdding={addTask.isPending}
              onUpdate={(id, patch) => updateTask.mutate({ id, patch })}
              onDelete={(id) => deleteTask.mutate(id)}
              defaultAssigneeId={lead.ownerId ?? me.data?.user.id ?? null}
            />
          </Card>
          <Card>
            <CardTitle icon={History}>Activity</CardTitle>
            <ActivityTimeline
              query={activities}
              onAdd={(input) => addActivity.mutateAsync(input)}
              isAdding={addActivity.isPending}
              onDelete={(id) => deleteActivity.mutate(id)}
              canDelete={(a) => isManager || a.actorId === me.data?.user.id}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle
              icon={Briefcase}
              action={
                <Button variant="ghost" size="sm" onClick={() => setIsDealOpen(true)} aria-label="Create deal">
                  <Plus className="w-4 h-4" />
                </Button>
              }
            >
              Deals
            </CardTitle>
            <QueryState query={deals} errorTitle="Couldn't load deals" loading={<LoadingState rows={2} />}>
              {(list) =>
                list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deals yet. Create one when this lead shows buying intent.</p>
                ) : (
                  <ul className="space-y-2">
                    {list.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => setOpenDealId(d.id)}
                          className="w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-muted/50"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{d.title}</span>
                            <Badge variant={STAGE_BADGE[d.stage] ?? "secondary"} className="text-[10px] shrink-0">
                              {d.stage}
                            </Badge>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{formatCurrency(d.value)}</span>
                            <span>{d.nextFollowUpAt ? `Follow up ${formatDateTime(d.nextFollowUpAt)}` : d.expectedClose ? `Close ${d.expectedClose}` : ""}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </QueryState>
          </Card>

          <Card>
            <CardTitle icon={FileText}>Lead record</CardTitle>
            <DetailRows rows={recordRows} />
            {lead.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {lead.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          {lead.sourcePlatform && (
            <Card>
              <CardTitle icon={Megaphone}>Ad lead form</CardTitle>
              {adRows.length > 0 ? <DetailRows rows={adRows} /> : <p className="text-sm text-muted-foreground">No form details recorded.</p>}
              {lead.rawAnswers && Object.keys(lead.rawAnswers).length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">All form answers</summary>
                  <div className="mt-2 space-y-1.5">
                    {Object.entries(lead.rawAnswers).map(([question, answer]) => (
                      <div key={question} className="p-2 rounded-lg bg-muted/40 border border-border">
                        <div className="text-muted-foreground">{question}</div>
                        <div className="text-foreground font-medium">
                          {Array.isArray(answer) ? answer.join(", ") : typeof answer === "object" ? JSON.stringify(answer) : String(answer)}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          )}

          {companyRows.length > 1 && (
            <Card>
              <CardTitle icon={Building}>Company</CardTitle>
              <DetailRows rows={companyRows} />
            </Card>
          )}

          {lead.techStack.length > 0 && (
            <Card>
              <h2 className="text-base font-semibold text-foreground mb-3">Tech stack</h2>
              <div className="flex flex-wrap gap-2">
                {lead.techStack.map((tech) => (
                  <Badge key={tech} variant="outline">
                    {tech}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          <button
            type="button"
            onClick={() => setIsEraseOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rose-500"
          >
            <Trash2 className="w-3.5 h-3.5" /> Erase personal data (DPDP deletion request)
          </button>
        </div>
      </div>

      <LeadFormModal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} lead={lead} />
      <DealFormModal
        isOpen={isDealOpen}
        onClose={() => setIsDealOpen(false)}
        lead={{ id: lead.id, name: lead.name, company: lead.company, ownerId: lead.ownerId }}
        onSaved={(deal) => setOpenDealId(deal.id)}
      />
      <AddToCampaignModal isOpen={isCampaignOpen} onClose={() => setIsCampaignOpen(false)} leadIds={[lead.id]} />
      <DealDrawer dealId={openDealId} onClose={() => setOpenDealId(null)} onMove={onMove} />

      <Modal
        isOpen={isDeleteOpen}
        onClose={() => !deleteLead.isPending && setIsDeleteOpen(false)}
        title="Delete lead?"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={deleteLead.isPending} onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" isLoading={deleteLead.isPending} onClick={() => void handleDelete()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Delete <strong className="text-foreground">{lead.name}</strong> with its activity and follow-ups? Linked deals are kept but unlinked.
        </p>
      </Modal>

      <Modal
        isOpen={isEraseOpen}
        onClose={() => !eraseLead.isPending && setIsEraseOpen(false)}
        title="Erase lead permanently?"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={eraseLead.isPending} onClick={() => setIsEraseOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" isLoading={eraseLead.isPending} onClick={() => void handleErase()}>
              <Trash2 className="w-4 h-4" /> Erase lead
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground leading-relaxed">
          This honours a data deletion request under the DPDP Act. <strong className="text-foreground">{lead.name}</strong>&apos;s contact details and all
          raw form answers will be permanently removed. This cannot be undone.
        </p>
      </Modal>
    </>
  );
}
