"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Bot,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Info,
  Mail,
  Plug,
  Trash2,
  UserPlus,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { QueryState } from "@/components/ui/QueryState";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useClearNotifications,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";
import type { AppNotification, NotificationType } from "@/types";

const PAGE_SIZE = 20;

const TYPE_META: Record<NotificationType, { icon: LucideIcon; label: string }> = {
  lead: { icon: UserPlus, label: "Leads" },
  deal: { icon: Briefcase, label: "Deals" },
  campaign: { icon: Mail, label: "Campaigns" },
  agent: { icon: Bot, label: "AI agent" },
  workflow: { icon: Workflow, label: "Workflows" },
  integration: { icon: Plug, label: "Integrations" },
  task: { icon: ClipboardList, label: "Tasks" },
  system: { icon: Info, label: "System" },
};

type Filter = "all" | "unread" | NotificationType;
const FILTERS: Filter[] = ["all", "unread", "lead", "deal", "campaign", "agent", "workflow", "integration", "task"];

const relativeTime = (iso: string): string => {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return iso;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

export default function NotificationsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  const params = {
    page,
    pageSize: PAGE_SIZE,
    unread: filter === "unread" ? true : undefined,
    type: filter !== "all" && filter !== "unread" ? filter : undefined,
  };
  const query = useNotifications(params);
  const unreadCount = useUnreadNotificationCount().data ?? 0;
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const remove = useDeleteNotification();
  const clear = useClearNotifications();

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };

  const open = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) router.push(n.link);
  };

  const handleClearAll = () => {
    if (!window.confirm("Delete all notifications? This cannot be undone.")) return;
    clear.mutate({});
  };

  const meta = query.data?.meta;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Leads, deals, campaign replies, agent runs, workflow failures and integration alerts. Choose which ones you get in Settings."
        icon={Bell}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={unreadCount === 0}
              isLoading={markAllRead.isPending}
            >
              <CheckCircle2 className="w-4 h-4" /> Mark all read
            </Button>
            <Button variant="ghost" size="sm" onClick={() => clear.mutate({ readOnly: true })} isLoading={clear.isPending}>
              Clear read
            </Button>
            <Button variant="ghost" size="sm" className="text-rose-500 hover:bg-rose-500/10" onClick={handleClearAll}>
              <Trash2 className="w-4 h-4" /> Clear all
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={filter === f ? "primary" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => changeFilter(f)}
          >
            {f === "all" ? "All" : f === "unread" ? `Unread (${unreadCount})` : TYPE_META[f].label}
          </Button>
        ))}
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={{
          icon: Bell,
          title: filter === "all" ? "No notifications yet" : "Nothing in this view",
          description:
            filter === "all"
              ? "You'll be notified here about new leads, deal changes, replies, agent runs and integration problems."
              : "Try a different filter.",
        }}
        errorTitle="Couldn't load notifications"
      >
        {(result) => (
          <div className="space-y-3">
            {result.data.map((n) => {
              const Icon = n.type === "integration" ? AlertTriangle : TYPE_META[n.type]?.icon ?? Info;
              return (
                <Card
                  key={n.id}
                  className={cn("p-4 flex items-start justify-between gap-4", !n.readAt && "border-primary/40")}
                >
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className="flex items-start gap-3.5 min-w-0 text-left flex-1 disabled:cursor-default"
                    disabled={!n.link && !!n.readAt}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                      <Icon className="w-[18px] h-[18px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground truncate">{n.title}</h3>
                        {!n.readAt && <span className="w-2 h-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                      </div>
                      {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                      <span className="text-[11px] text-muted-foreground mt-1 inline-block" title={new Date(n.createdAt).toLocaleString()}>
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {!n.readAt && (
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => markRead.mutate(n.id)}>
                        <Check className="w-4 h-4" /> Mark read
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Delete notification"
                      title="Delete"
                      onClick={() => remove.mutate(n.id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              );
            })}

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                <span>
                  Page {meta.page} of {meta.totalPages} · {meta.total} notifications
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </QueryState>
    </>
  );
}
