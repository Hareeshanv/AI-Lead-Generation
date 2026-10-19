"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { CalendarClock, Check, ChevronLeft, ChevronRight, GripVertical, Kanban, Plus, Search, User } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QueryState } from "@/components/ui/QueryState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { DealDrawer, LostReasonModal } from "@/components/crm/DealDrawer";
import { DEAL_STAGES, DealFormModal } from "@/components/crm/DealFormModal";
import { formatRelative, smallSelectClassName, useMemberNames } from "@/components/crm/shared";
import { useDealBoard, useMoveBoardDeal, useTasksPage, useUpdateTask } from "@/hooks/useDeals";
import { useDebounced } from "@/hooks/useDebounced";
import { useMe } from "@/hooks/useMe";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import type { Deal, DealBoard, DealBoardColumn, DealBoardParams, DealStage } from "@/types";

/** Cards loaded per column, and per "Load more" click. */
const STAGE_PAGE = 50;
const FOLLOW_UPS_PAGE = 9;

const STAGE_ACCENT: Record<DealStage, string> = {
  New: "bg-slate-400",
  Qualified: "bg-sky-500",
  Proposal: "bg-indigo-500",
  Negotiation: "bg-amber-500",
  "Closed Won": "bg-emerald-500",
  "Closed Lost": "bg-rose-500",
};

const isClosed = (stage: DealStage) => stage === "Closed Won" || stage === "Closed Lost";

function summarize(board: DealBoard | undefined) {
  let openCount = 0;
  let openValue = 0;
  let weighted = 0;
  let won: DealBoardColumn | undefined;
  let lost: DealBoardColumn | undefined;
  for (const col of board?.stages ?? []) {
    if (col.stage === "Closed Won") won = col;
    else if (col.stage === "Closed Lost") lost = col;
    else {
      openCount += col.count;
      openValue += col.value;
      weighted += col.weighted;
    }
  }
  const closedCount = (won?.count ?? 0) + (lost?.count ?? 0);
  return {
    openCount,
    openValue,
    weighted,
    wonValue: won?.value ?? 0,
    winRate: closedCount > 0 ? Math.round(((won?.count ?? 0) / closedCount) * 100) : null,
  };
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
  column: DealBoardColumn | undefined;
  nameOf: (id: string | null | undefined) => string;
  onOpen: (deal: Deal) => void;
  onAdd: () => void;
  onLoadMore: () => void;
}> = ({ stage, column, nameOf, onOpen, onAdd, onLoadMore }) => {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const deals = column?.deals ?? [];
  const count = column?.count ?? 0;
  const value = column?.value ?? 0;
  const weighted = column?.weighted ?? 0;
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
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{count}</span>
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
        {deals.length < count && (
          <button
            type="button"
            onClick={onLoadMore}
            className="w-full rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Load more ({count - deals.length} more)
          </button>
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
  const [page, setPage] = useState(1);
  const tasks = useTasksPage({ assignee: "me", status: "open", due: "week", page, pageSize: FOLLOW_UPS_PAGE });
  const updateTask = useUpdateTask();
  const meta = tasks.data?.meta;
  const lastPage = meta ? Math.max(1, meta.totalPages) : 1;

  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 text-muted-foreground" /> My follow-ups (next 7 days)
        </h2>
        {meta && meta.total > FOLLOW_UPS_PAGE && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="mr-1 tabular-nums">
              {(page - 1) * FOLLOW_UPS_PAGE + 1}–{Math.min(page * FOLLOW_UPS_PAGE, meta.total)} of {meta.total}
            </span>
            <Button variant="ghost" size="sm" aria-label="Previous follow-ups" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Next follow-ups" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <QueryState
        query={tasks}
        isEmpty={(result) => result.data.length === 0}
        loading={<LoadingSkeleton className="h-10 w-full" />}
        empty={{ title: "Nothing due this week", description: "Follow-ups you add on leads and deals appear here." }}
      >
        {({ data: list }) => (
          <ul className={cn("grid gap-2 md:grid-cols-2 xl:grid-cols-3", tasks.isPlaceholderData && "opacity-60")}>
            {list.map((t) => {
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
  const me = useMe();
  const { members, nameOf } = useMemberNames();
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [expand, setExpand] = useState<Partial<Record<DealStage, number>>>({});
  const [createStage, setCreateStage] = useState<DealStage | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [pendingLost, setPendingLost] = useState<Deal | null>(null);

  const q = useDebounced(search.trim(), 300);
  const boardParams = useMemo<DealBoardParams>(
    () => ({ ownerId: ownerFilter === "all" ? undefined : ownerFilter, q: q || undefined, perStage: STAGE_PAGE, expand }),
    [ownerFilter, q, expand]
  );
  const board = useDealBoard(boardParams);
  const moveDeal = useMoveBoardDeal(boardParams);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const myId = me.data?.user.id;
  const filtered = ownerFilter !== "all" || q !== "";

  const byStage = useMemo(
    () => new Map<DealStage, DealBoardColumn>((board.data?.stages ?? []).map((col) => [col.stage, col])),
    [board.data]
  );
  const summary = useMemo(() => summarize(board.data), [board.data]);

  const loadMore = (stage: DealStage) =>
    setExpand((prev) => ({ ...prev, [stage]: (byStage.get(stage)?.deals.length ?? 0) + STAGE_PAGE }));

  const move = (deal: Deal, stage: DealStage, lostReason?: string | null) => {
    if (deal.stage === stage && stage !== "Closed Lost") return;
    const top = byStage.get(stage)?.deals[0]?.position;
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
              {board.isLoading ? <LoadingSkeleton className="h-7 w-24" /> : kpi.value}
            </div>
            {kpi.hint && !board.isLoading && <div className="text-[11px] text-muted-foreground">{kpi.hint}</div>}
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
        query={board}
        isEmpty={(data) => !filtered && data.stages.every((col) => col.count === 0)}
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
            <div className={cn("flex gap-4 overflow-x-auto pb-4 transition-opacity", board.isPlaceholderData && "opacity-60")}>
              {DEAL_STAGES.map((stage) => (
                <StageColumn
                  key={stage}
                  stage={stage}
                  column={byStage.get(stage)}
                  nameOf={nameOf}
                  onOpen={(d) => setOpenDealId(d.id)}
                  onAdd={() => setCreateStage(stage)}
                  onLoadMore={() => loadMore(stage)}
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
