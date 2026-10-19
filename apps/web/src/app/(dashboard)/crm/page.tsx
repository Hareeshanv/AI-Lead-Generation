"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Check, GripVertical, Kanban, Plus, Search, User } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QueryState } from "@/components/ui/QueryState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { DealDrawer, LostReasonModal } from "@/components/crm/DealDrawer";
import { DEAL_STAGES, DealFormModal } from "@/components/crm/DealFormModal";
import { formatDateTime, formatRelative, smallSelectClassName, useMemberNames } from "@/components/crm/shared";
import { useDeals, useMoveDeal, useTasks, useUpdateTask } from "@/hooks/useDeals";
import { useMe } from "@/hooks/useMe";
import { cn, formatCurrency } from "@/lib/utils";
import type { Deal, DealStage } from "@/types";

const BOARD_PARAMS = {};

const STAGE_ACCENT: Record<DealStage, string> = {
  New: "bg-slate-400",
  Qualified: "bg-sky-500",
  Proposal: "bg-indigo-500",
  Negotiation: "bg-amber-500",
  "Closed Won": "bg-emerald-500",
  "Closed Lost": "bg-rose-500",
};

const isClosed = (stage: DealStage) => stage === "Closed Won" || stage === "Closed Lost";

function totals(deals: Deal[]) {
  let value = 0;
  let weighted = 0;
  for (const d of deals) {
    value += d.value;
    weighted += (d.value * d.probability) / 100;
  }
  return { value, weighted };
}

const DealCard: React.FC<{ deal: Deal; ownerName: string; overlay?: boolean; onOpen?: () => void }> = ({
  deal,
  ownerName,
  overlay,
  onOpen,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id, data: { deal } });
  const overdue = deal.nextFollowUpAt && !isClosed(deal.stage) && new Date(deal.nextFollowUpAt).getTime() < Date.now();
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : { transform: CSS.Translate.toString(transform) }}
      className={cn(
        "group rounded-lg border border-border bg-background p-3 space-y-2 transition-colors",
        overlay ? "shadow-xl ring-2 ring-primary/40 rotate-1" : "hover:border-primary/40",
        isDragging && !overlay && "opacity-40"
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          {...(overlay ? {} : listeners)}
          {...(overlay ? {} : attributes)}
          aria-label={`Drag ${deal.title}`}
          className="-ml-1 mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <h4 className="truncate text-xs font-medium text-foreground group-hover:text-primary">{deal.title}</h4>
          <p className="truncate text-[11px] text-muted-foreground">
            {deal.lead?.name ?? deal.contact ?? ""}
            {deal.company ? ` · ${deal.company}` : ""}
          </p>
        </button>
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2 text-[11px]">
        <span className="font-medium tabular-nums text-foreground">{formatCurrency(deal.value)}</span>
        <span className="text-muted-foreground">{deal.probability}%</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1 truncate">
          <User className="h-3 w-3 shrink-0" /> <span className="truncate">{ownerName}</span>
        </span>
        {deal.nextFollowUpAt && !isClosed(deal.stage) && (
          <span className={cn("inline-flex shrink-0 items-center gap-1", overdue && "font-medium text-rose-500")} title={formatDateTime(deal.nextFollowUpAt)}>
            <CalendarClock className="h-3 w-3" /> {formatRelative(deal.nextFollowUpAt)}
          </span>
        )}
      </div>
    </div>
  );
};

const StageColumn: React.FC<{
  stage: DealStage;
  deals: Deal[];
  nameOf: (id: string | null | undefined) => string;
  onOpen: (deal: Deal) => void;
  onAdd: () => void;
}> = ({ stage, deals, nameOf, onOpen, onAdd }) => {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const { value, weighted } = totals(deals);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${stage} stage`}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl border bg-card p-3 transition-colors",
        isOver ? "border-primary/60 bg-primary/5" : "border-border"
      )}
    >
      <header className="mb-3 space-y-1 border-b border-border pb-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-foreground">
            <span className={cn("h-2 w-2 rounded-full", STAGE_ACCENT[stage])} /> {stage}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{deals.length}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{formatCurrency(value)}</span>
          {!isClosed(stage) && <span title="Probability-weighted value">≈ {formatCurrency(weighted)}</span>}
        </div>
      </header>
      <div className="flex-1 space-y-2.5 min-h-[200px]">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} ownerName={nameOf(deal.ownerId)} onOpen={() => onOpen(deal)} />
        ))}
        {deals.length === 0 && (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">Drop deals here</p>
        )}
      </div>
      {!isClosed(stage) && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-2 inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add deal
        </button>
      )}
    </section>
  );
};

const FollowUps: React.FC = () => {
  const tasks = useTasks({ assignee: "me", status: "open", due: "week" });
  const updateTask = useUpdateTask();
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <CalendarClock className="h-4 w-4 text-muted-foreground" /> My follow-ups (next 7 days)
      </h2>
      <QueryState
        query={tasks}
        loading={<LoadingSkeleton className="h-10 w-full" />}
        empty={{ title: "Nothing due this week", description: "Follow-ups you add on leads and deals appear here." }}
      >
        {(list) => (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {list.slice(0, 9).map((t) => {
              const overdue = t.dueAt && new Date(t.dueAt).getTime() < Date.now();
              const href = t.leadId ? `/leads/${t.leadId}` : null;
              return (
                <li key={t.id} className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5">
                  <button
                    type="button"
                    onClick={() => updateTask.mutate({ id: t.id, patch: { status: "done" } })}
                    aria-label={`Complete ${t.title}`}
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border hover:border-primary hover:text-primary"
                  >
                    <Check className="h-3 w-3 opacity-0 hover:opacity-100" />
                  </button>
                  <div className="min-w-0 text-xs">
                    <p className="truncate font-medium text-foreground">{t.title}</p>
                    <p className="truncate text-muted-foreground">
                      {href ? (
                        <Link href={href} className="hover:text-primary">
                          {t.lead?.name ?? "Lead"}
                        </Link>
                      ) : (
                        t.deal?.title ?? ""
                      )}
                      {t.dueAt && (
                        <span className={cn(overdue && "text-rose-500")}> · {overdue ? "overdue " : ""}{formatRelative(t.dueAt)}</span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </div>
  );
};

export default function CRMPage() {
  const dealsQuery = useDeals(BOARD_PARAMS);
  const moveDeal = useMoveDeal(BOARD_PARAMS);
  const me = useMe();
  const { members, nameOf } = useMemberNames();
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [createStage, setCreateStage] = useState<DealStage | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [pendingLost, setPendingLost] = useState<Deal | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const myId = me.data?.user.id;
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (dealsQuery.data ?? []).filter((d) => {
      if (ownerFilter === "me" && d.ownerId !== myId) return false;
      if (ownerFilter === "unassigned" && d.ownerId) return false;
      if (ownerFilter !== "all" && ownerFilter !== "me" && ownerFilter !== "unassigned" && d.ownerId !== ownerFilter) return false;
      if (!needle) return true;
      return [d.title, d.company, d.contact, d.lead?.name].some((v) => v && v.toLowerCase().includes(needle));
    });
  }, [dealsQuery.data, search, ownerFilter, myId]);

  const byStage = useMemo(() => {
    const map = new Map<DealStage, Deal[]>(DEAL_STAGES.map((s) => [s, []]));
    for (const d of visible) map.get(d.stage)?.push(d);
    for (const list of map.values()) list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return map;
  }, [visible]);

  const summary = useMemo(() => {
    const open = visible.filter((d) => !isClosed(d.stage));
    const won = visible.filter((d) => d.stage === "Closed Won");
    const lost = visible.filter((d) => d.stage === "Closed Lost");
    const openTotals = totals(open);
    return {
      openCount: open.length,
      openValue: openTotals.value,
      weighted: openTotals.weighted,
      wonValue: totals(won).value,
      winRate: won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    };
  }, [visible]);

  const move = (deal: Deal, stage: DealStage, lostReason?: string | null) => {
    if (deal.stage === stage && stage !== "Closed Lost") return;
    const top = byStage.get(stage)?.[0]?.position;
    moveDeal.mutate({ id: deal.id, stage, position: top !== undefined ? top - 1 : undefined, lostReason });
  };

  const onDragStart = (e: DragStartEvent) => setActiveDeal((e.active.data.current?.deal as Deal) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDeal(null);
    const deal = e.active.data.current?.deal as Deal | undefined;
    const stage = e.over?.id as DealStage | undefined;
    if (!deal || !stage || deal.stage === stage) return;
    if (stage === "Closed Lost") setPendingLost(deal);
    else move(deal, stage);
  };

  return (
    <>
      <PageHeader
        title="CRM pipeline"
        description="Drag deals between stages. Moving a deal updates its lead's status and timeline."
        icon={Kanban}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateStage("New")}>
            <Plus className="w-4 h-4" /> Add deal
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Open deals", value: String(summary.openCount) },
          { label: "Open pipeline", value: formatCurrency(summary.openValue) },
          { label: "Weighted pipeline", value: formatCurrency(summary.weighted) },
          { label: "Win rate", value: summary.winRate === null ? "—" : `${summary.winRate}%`, hint: `Won ${formatCurrency(summary.wonValue)}` },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">{kpi.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
              {dealsQuery.isLoading ? <LoadingSkeleton className="h-7 w-24" /> : kpi.value}
            </div>
            {kpi.hint && !dealsQuery.isLoading && <div className="text-[11px] text-muted-foreground">{kpi.hint}</div>}
          </div>
        ))}
      </div>

      <FollowUps />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <Input icon={<Search className="h-4 w-4" />} placeholder="Filter deals" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className={smallSelectClassName} aria-label="Owner filter">
          <option value="all">All owners</option>
          <option value="me">My deals</option>
          <option value="unassigned">Unassigned</option>
          {members
            .filter((m) => m.userId !== myId)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {nameOf(m.userId)}
              </option>
            ))}
        </select>
      </div>

      <QueryState
        query={dealsQuery}
        errorTitle="Couldn't load the pipeline"
        loading={
          <div className="flex gap-4 overflow-hidden">
            {DEAL_STAGES.map((s) => (
              <LoadingSkeleton key={s} className="h-80 w-72 shrink-0" />
            ))}
          </div>
        }
        empty={{
          icon: Kanban,
          title: "No deals yet",
          description: "Create a deal here or from a lead's page to start tracking it through your pipeline.",
          action: (
            <Button variant="outline" size="sm" onClick={() => setCreateStage("New")}>
              <Plus className="h-4 w-4" /> Add deal
            </Button>
          ),
        }}
      >
        {() => (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveDeal(null)}>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {DEAL_STAGES.map((stage) => (
                <StageColumn
                  key={stage}
                  stage={stage}
                  deals={byStage.get(stage) ?? []}
                  nameOf={nameOf}
                  onOpen={(d) => setOpenDealId(d.id)}
                  onAdd={() => setCreateStage(stage)}
                />
              ))}
            </div>
            <DragOverlay>{activeDeal ? <DealCard deal={activeDeal} ownerName={nameOf(activeDeal.ownerId)} overlay /> : null}</DragOverlay>
          </DndContext>
        )}
      </QueryState>

      <DealFormModal
        isOpen={createStage !== null}
        onClose={() => setCreateStage(null)}
        defaultStage={createStage ?? undefined}
        onSaved={(deal) => setOpenDealId(deal.id)}
      />
      <DealDrawer dealId={openDealId} onClose={() => setOpenDealId(null)} onMove={move} />
      <LostReasonModal
        isOpen={pendingLost !== null}
        dealTitle={pendingLost?.title}
        onCancel={() => setPendingLost(null)}
        onConfirm={(reason) => {
          if (pendingLost) move(pendingLost, "Closed Lost", reason);
          setPendingLost(null);
        }}
      />
    </>
  );
}
