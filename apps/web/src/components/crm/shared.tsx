"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  Check,
  CheckSquare,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Trash2,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QueryState } from "@/components/ui/QueryState";
import { selectClassName } from "@/components/settings/shared";
import { useMe } from "@/hooks/useMe";
import { useMembers } from "@/hooks/useSettings";
import { cn, formatDateTime } from "@/lib/utils";
import type { Activity, ActivityInput, ActivityType, ManualActivityType, Task, TaskInput, TaskPatch, TaskPriority } from "@/types";

export const smallSelectClassName =
  "h-8 rounded-lg bg-background border border-border px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60";

/** userId -> display name for the workspace's members; `members` lists only those who can own records (not pending invitees). */
export function useMemberNames() {
  const members = useMembers();
  const me = useMe();
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data ?? []) map.set(m.userId, m.fullName || m.email || "Member");
    return map;
  }, [members.data]);
  const assignable = useMemo(() => (members.data ?? []).filter((m) => m.status !== "pending"), [members.data]);
  const myId = me.data?.user.id;
  const nameOf = useCallback(
    (id: string | null | undefined, fallback = "Unassigned") =>
      !id ? fallback : id === myId ? `${names.get(id) ?? "You"} (you)` : names.get(id) ?? "Former member",
    [names, myId]
  );
  return { members: assignable, nameOf };
}

export const OwnerSelect: React.FC<{
  id?: string;
  value: string | null | undefined;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  small?: boolean;
  placeholder?: string;
}> = ({ id, value, onChange, disabled, small, placeholder = "Unassigned" }) => {
  const { members, nameOf } = useMemberNames();
  return (
    <select
      id={id}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={small ? smallSelectClassName : selectClassName}
      aria-label="Owner"
    >
      <option value="">{placeholder}</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {nameOf(m.userId)}
        </option>
      ))}
      {value && !members.some((m) => m.userId === value) && <option value={value}>{nameOf(value)}</option>}
    </select>
  );
};

export function formatRelative(iso?: string | null, now = Date.now()): string {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = time - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return formatDateTime(iso);
}

/** <input type="datetime-local"> value <-> ISO string. */
export const toLocalInput = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (value: string): string | null => (value ? new Date(value).toISOString() : null);

const ACTIVITY_META: Record<ActivityType, { icon: LucideIcon; label: string; className: string }> = {
  note: { icon: FileText, label: "Note", className: "bg-muted text-foreground" },
  call: { icon: Phone, label: "Call", className: "bg-sky-500/10 text-sky-600 dark:text-sky-300" },
  email: { icon: Mail, label: "Email", className: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" },
  whatsapp: { icon: MessageCircle, label: "WhatsApp", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
  meeting: { icon: Users, label: "Meeting", className: "bg-violet-500/10 text-violet-600 dark:text-violet-300" },
  stage_change: { icon: ArrowRightLeft, label: "Stage", className: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
  status_change: { icon: ArrowRightLeft, label: "Status", className: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
  task: { icon: CheckSquare, label: "Task", className: "bg-muted text-foreground" },
  campaign: { icon: Mail, label: "Campaign", className: "bg-primary/10 text-primary" },
  workflow: { icon: Workflow, label: "Workflow", className: "bg-primary/10 text-primary" },
  agent: { icon: Workflow, label: "Agent", className: "bg-primary/10 text-primary" },
  system: { icon: FileText, label: "System", className: "bg-muted text-muted-foreground" },
};

const MANUAL_TYPES: { value: ManualActivityType; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meeting", label: "Meeting" },
];
const MANUAL_SET = new Set<string>(MANUAL_TYPES.map((t) => t.value));

type ListQuery<T> = { data: T | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };

export const ActivityTimeline: React.FC<{
  query: ListQuery<Activity[]>;
  onAdd: (input: ActivityInput) => Promise<unknown>;
  isAdding: boolean;
  onDelete?: (id: string) => void;
  canDelete?: (activity: Activity) => boolean;
}> = ({ query, onAdd, isAdding, onDelete, canDelete }) => {
  const { nameOf } = useMemberNames();
  const [type, setType] = useState<ManualActivityType>("note");
  const [body, setBody] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await onAdd({ type, body: body.trim() });
      setBody("");
    } catch {
      // The mutation already showed an error toast; keep the text so it can be retried.
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={10_000}
          placeholder={type === "note" ? "Add a note…" : `What happened on this ${type === "whatsapp" ? "WhatsApp chat" : type}?`}
          className="w-full rounded-lg bg-card/60 border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Entry type">
            {MANUAL_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={type === t.value}
                onClick={() => setType(t.value)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                  type === t.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button type="submit" size="sm" isLoading={isAdding} disabled={!body.trim()}>
            {type === "note" ? "Add note" : "Log"}
          </Button>
        </div>
      </form>

      <QueryState query={query} empty={{ title: "No activity yet", description: "Notes, calls and stage changes show up here." }}>
        {(activities) => (
          <ol className="relative space-y-4 border-l border-border pl-5">
            {activities.map((a) => {
              const meta = ACTIVITY_META[a.type] ?? ACTIVITY_META.system;
              const Icon = meta.icon;
              const deletable = onDelete && MANUAL_SET.has(a.type) && (canDelete ? canDelete(a) : true);
              return (
                <li key={a.id} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border border-border",
                      meta.className
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{a.title || meta.label}</span>
                      </p>
                      {a.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>}
                      <p className="mt-1 text-[11px] text-muted-foreground" title={formatDateTime(a.occurredAt)}>
                        {a.actorId ? `${nameOf(a.actorId, "System")} · ` : "System · "}
                        {formatRelative(a.occurredAt)}
                      </p>
                    </div>
                    {deletable && (
                      <button
                        type="button"
                        onClick={() => window.confirm("Delete this entry?") && onDelete!(a.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-rose-500"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </QueryState>
    </div>
  );
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-rose-500",
};

export const TaskList: React.FC<{
  query: ListQuery<Task[]>;
  onAdd: (input: TaskInput) => Promise<unknown>;
  isAdding: boolean;
  onUpdate: (id: string, patch: TaskPatch) => void;
  onDelete: (id: string) => void;
  defaultAssigneeId?: string | null;
}> = ({ query, onAdd, isAdding, onUpdate, onDelete, defaultAssigneeId }) => {
  const { nameOf } = useMemberNames();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assigneeId, setAssigneeId] = useState<string | null | undefined>(undefined);
  const [showDone, setShowDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await onAdd({
        title: title.trim(),
        dueAt: fromLocalInput(dueAt),
        priority,
        assigneeId: assigneeId === undefined ? defaultAssigneeId ?? undefined : assigneeId,
      });
      setTitle("");
      setDueAt("");
      setPriority("normal");
    } catch {
      // Error toast already shown.
    }
  };

  const now = Date.now();
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow-up, e.g. Call back about pricing" maxLength={200} />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            aria-label="Due date"
            className={smallSelectClassName}
          />
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={smallSelectClassName} aria-label="Priority">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <OwnerSelect small value={assigneeId === undefined ? defaultAssigneeId : assigneeId} onChange={setAssigneeId} placeholder="No assignee" />
          <Button type="submit" size="sm" isLoading={isAdding} disabled={!title.trim()} className="ml-auto">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </form>

      <QueryState query={query} empty={{ title: "No follow-ups", description: "Add a task with a due date to get reminded." }}>
        {(tasks) => {
          const visible = showDone ? tasks : tasks.filter((t) => t.status === "open");
          const hidden = tasks.length - visible.length;
          return (
            <div className="space-y-2">
              {visible.length === 0 && <p className="text-sm text-muted-foreground">No open follow-ups.</p>}
              {visible.map((t) => {
                const overdue = t.status === "open" && t.dueAt && new Date(t.dueAt).getTime() < now;
                return (
                  <div key={t.id} className="flex items-start gap-3 rounded-lg border border-border bg-background p-2.5">
                    <button
                      type="button"
                      onClick={() => onUpdate(t.id, { status: t.status === "done" ? "open" : "done" })}
                      aria-label={t.status === "done" ? "Mark as open" : "Mark as done"}
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        t.status === "done" ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary"
                      )}
                    >
                      {t.status === "done" && <Check className="h-3 w-3" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", t.status !== "open" ? "text-muted-foreground line-through" : PRIORITY_CLASS[t.priority])}>
                        {t.title}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        {t.dueAt && (
                          <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-rose-500")}>
                            <CalendarClock className="h-3 w-3" />
                            {overdue ? "Overdue · " : ""}
                            {formatDateTime(t.dueAt)}
                          </span>
                        )}
                        <span>{nameOf(t.assigneeId)}</span>
                        {t.priority === "high" && <span className="text-rose-500">High priority</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.confirm("Delete this task?") && onDelete(t.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-rose-500"
                      aria-label="Delete task"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              {(hidden > 0 || showDone) && (
                <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs text-primary hover:underline">
                  {showDone ? "Hide completed" : `Show ${hidden} completed`}
                </button>
              )}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
};
