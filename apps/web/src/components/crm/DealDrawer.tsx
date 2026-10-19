"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, Pencil, RotateCcw, ThumbsDown, Trophy, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorState, LoadingState } from "@/components/ui/QueryState";
import {
  useAddDealActivity,
  useAddDealTask,
  useDeal,
  useDealActivities,
  useDealTasks,
  useDeleteActivity,
  useDeleteDeal,
  useDeleteTask,
  useUpdateDeal,
  useUpdateTask,
} from "@/hooks/useDeals";
import { useHasRole, useMe } from "@/hooks/useMe";
import { cn, formatCurrency } from "@/lib/utils";
import type { Deal, DealStage } from "@/types";
import { DEAL_STAGES, DealFormModal } from "./DealFormModal";
import { ActivityTimeline, OwnerSelect, TaskList, formatDateTime, smallSelectClassName } from "./shared";

const isClosed = (stage: DealStage) => stage === "Closed Won" || stage === "Closed Lost";

/** Prompts for an optional reason before marking a deal lost. */
export const LostReasonModal: React.FC<{
  isOpen: boolean;
  dealTitle?: string;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
}> = ({ isOpen, dealTitle, onCancel, onConfirm }) => {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (isOpen) setReason("");
  }, [isOpen]);
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Mark deal as lost"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onConfirm(reason.trim() || null)}>
            Mark lost
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason.trim() || null);
        }}
        className="space-y-2"
      >
        <label htmlFor="lost-reason" className="text-xs font-medium text-muted-foreground">
          Why was {dealTitle ? `"${dealTitle}"` : "this deal"} lost? (optional)
        </label>
        <Input id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Budget, chose a competitor" autoFocus maxLength={1000} />
      </form>
    </Modal>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="min-w-0 text-right font-medium text-foreground">{children}</span>
  </div>
);

export const DealDrawer: React.FC<{
  dealId: string | null;
  onClose: () => void;
  /** Stage moves go through the board's optimistic mutation. */
  onMove: (deal: Deal, stage: DealStage, lostReason?: string | null) => void;
}> = ({ dealId, onClose, onMove }) => {
  const dealQuery = useDeal(dealId ?? undefined);
  const activities = useDealActivities(dealId ?? undefined);
  const tasks = useDealTasks(dealId ?? undefined);
  const addActivity = useAddDealActivity(dealId ?? "");
  const addTask = useAddDealTask(dealId ?? "");
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const deleteActivity = useDeleteActivity();
  const updateDeal = useUpdateDeal("Owner updated");
  const deleteDeal = useDeleteDeal();
  const isManager = useHasRole("manager");
  const me = useMe();
  const [isEditing, setIsEditing] = useState(false);
  const [isLostOpen, setIsLostOpen] = useState(false);
  const [tab, setTab] = useState<"activity" | "tasks">("activity");

  useEffect(() => {
    if (!dealId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !isEditing && !isLostOpen && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dealId, isEditing, isLostOpen, onClose]);

  if (!dealId) return null;
  const deal = dealQuery.data;

  const handleDelete = async () => {
    if (!deal || !window.confirm(`Delete "${deal.title}"? Its timeline and tasks are deleted too.`)) return;
    try {
      await deleteDeal.mutateAsync(deal.id);
      onClose();
    } catch {
      // toast shown
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Deal details"
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-foreground">{deal?.title ?? "Deal"}</h2>
            {deal && (
              <p className="text-sm text-muted-foreground">
                {[deal.company, deal.contact].filter(Boolean).join(" · ") || "No company"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {deal && (
              <Button variant="ghost" size="icon" onClick={() => setIsEditing(true)} aria-label="Edit deal" title="Edit deal">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {deal && isManager && (
              <Button variant="ghost" size="icon" onClick={handleDelete} aria-label="Delete deal" title="Delete deal">
                <Trash2 className="h-4 w-4 text-rose-500" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {dealQuery.isLoading ? (
            <LoadingState rows={4} />
          ) : dealQuery.isError || !deal ? (
            <ErrorState title="Couldn't load this deal" error={dealQuery.error} onRetry={() => void dealQuery.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border p-3">
                  <div className="text-xs text-muted-foreground">Value</div>
                  <div className="text-xl font-semibold tabular-nums text-foreground">{formatCurrency(deal.value)}</div>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <div className="text-xs text-muted-foreground">Weighted ({deal.probability}%)</div>
                  <div className="text-xl font-semibold tabular-nums text-foreground">
                    {formatCurrency((deal.value * deal.probability) / 100)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={deal.stage}
                  onChange={(e) => {
                    const stage = e.target.value as DealStage;
                    if (stage === "Closed Lost") setIsLostOpen(true);
                    else onMove(deal, stage);
                  }}
                  className={smallSelectClassName}
                  aria-label="Stage"
                >
                  {DEAL_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {isClosed(deal.stage) ? (
                  <Button variant="outline" size="sm" onClick={() => onMove(deal, "Negotiation")}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reopen
                  </Button>
                ) : (
                  <>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-600/90 border-emerald-600/20 shadow-none" onClick={() => onMove(deal, "Closed Won")}>
                      <Trophy className="h-3.5 w-3.5" /> Won
                    </Button>
                    <Button variant="outline" size="sm" className="text-rose-500" onClick={() => setIsLostOpen(true)}>
                      <ThumbsDown className="h-3.5 w-3.5" /> Lost
                    </Button>
                  </>
                )}
              </div>

              <div className="divide-y divide-border/60 rounded-xl border border-border px-3">
                <Row label="Owner">
                  <OwnerSelect
                    small
                    value={deal.ownerId}
                    disabled={updateDeal.isPending}
                    onChange={(ownerId) => updateDeal.mutate({ id: deal.id, patch: { ownerId } })}
                  />
                </Row>
                <Row label="Expected close">{deal.expectedClose || "—"}</Row>
                <Row label="Next follow-up">
                  {deal.nextFollowUpAt ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        new Date(deal.nextFollowUpAt).getTime() < Date.now() && "text-rose-500"
                      )}
                    >
                      <CalendarClock className="h-3.5 w-3.5" /> {formatDateTime(deal.nextFollowUpAt)}
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                {deal.stage === "Closed Lost" && <Row label="Lost reason">{deal.lostReason || "—"}</Row>}
                {deal.closedAt && <Row label="Closed">{formatDateTime(deal.closedAt)}</Row>}
                <Row label="Created">{formatDateTime(deal.createdAt)}</Row>
              </div>

              <div className="rounded-xl border border-border p-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Linked lead</div>
                {deal.lead ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/leads/${deal.lead.id}`} className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary">
                        {deal.lead.name} <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {[deal.lead.company, deal.lead.email, deal.lead.phone].filter((v) => v && v !== "Not available").join(" · ")}
                      </p>
                    </div>
                    {deal.lead.status && <StatusBadge status={deal.lead.status} />}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not linked to a lead. Create deals from a lead&apos;s page to link them.</p>
                )}
              </div>

              <div>
                <div className="mb-3 flex gap-1 border-b border-border">
                  {(["activity", "tasks"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={cn(
                        "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                        tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t === "activity" ? "Activity" : "Follow-ups"}
                    </button>
                  ))}
                </div>
                {tab === "activity" ? (
                  <ActivityTimeline
                    query={activities}
                    onAdd={(input) => addActivity.mutateAsync(input)}
                    isAdding={addActivity.isPending}
                    onDelete={(id) => deleteActivity.mutate(id)}
                    canDelete={(a) => isManager || a.actorId === me.data?.user.id}
                  />
                ) : (
                  <TaskList
                    query={tasks}
                    onAdd={(input) => addTask.mutateAsync(input)}
                    isAdding={addTask.isPending}
                    onUpdate={(id, patch) => updateTask.mutate({ id, patch })}
                    onDelete={(id) => deleteTask.mutate(id)}
                    defaultAssigneeId={deal.ownerId ?? me.data?.user.id}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      <DealFormModal isOpen={isEditing} onClose={() => setIsEditing(false)} deal={deal} />
      <LostReasonModal
        isOpen={isLostOpen}
        dealTitle={deal?.title}
        onCancel={() => setIsLostOpen(false)}
        onConfirm={(reason) => {
          setIsLostOpen(false);
          if (deal) onMove(deal, "Closed Lost", reason);
        }}
      />
    </>
  );
};
