import { cn } from "@/lib/utils";
import type { CampaignAudienceFilter, CampaignChannel, CampaignDetail, CampaignStepInput } from "@/types";

export const WIZARD_STEPS = ["Channel", "Audience", "Messages", "Schedule", "Review"] as const;
export const MAX_MESSAGES = 10;

export type DelayUnit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 1440 };

export interface StepDraft {
  key: string;
  delayValue: number;
  delayUnit: DelayUnit;
  subject: string;
  body: string;
  templateName: string;
  templateLanguage: string;
  bodyParams: string;
}

export interface AudienceDraft {
  type: "filter" | "manual";
  statuses: string[];
  sources: string;
  tags: string;
  minScore: string;
  maxScore: string;
  courseInterest: string;
  location: string;
  createdAfter: string;
}

/** Start time, sending window, throttle and sender identity (the Schedule step). */
export interface ScheduleDraft {
  scheduleMode: "now" | "later";
  /** <input type="datetime-local"> value. */
  scheduledAt: string;
  windowOn: boolean;
  windowStart: string;
  windowEnd: string;
  windowDays: number[];
  windowTz: string;
  throttle: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  phoneNumberId: string;
}

let stepKey = 0;
const newKey = () => `step-${++stepKey}`;

export function emptyStep(first: boolean): StepDraft {
  return {
    key: newKey(),
    delayValue: first ? 0 : 2,
    delayUnit: "days",
    subject: "",
    body: "",
    templateName: "",
    templateLanguage: "en",
    bodyParams: "",
  };
}

export function stepFromInput(step: CampaignStepInput): StepDraft {
  const minutes = step.delayMinutes;
  const unit: DelayUnit = minutes > 0 && minutes % 1440 === 0 ? "days" : minutes > 0 && minutes % 60 === 0 ? "hours" : "minutes";
  return {
    key: newKey(),
    delayValue: minutes / UNIT_MINUTES[unit],
    delayUnit: minutes === 0 ? "days" : unit,
    subject: step.subject ?? "",
    body: step.body ?? "",
    templateName: step.whatsappTemplate?.name ?? "",
    templateLanguage: step.whatsappTemplate?.language ?? "en",
    bodyParams: (step.whatsappTemplate?.bodyParams ?? []).join("\n"),
  };
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function audienceFromFilter(f: CampaignAudienceFilter | undefined): AudienceDraft {
  return {
    type: f?.type ?? "filter",
    statuses: f?.statuses ?? [],
    sources: (f?.sources ?? []).join(", "),
    tags: (f?.tags ?? []).join(", "),
    minScore: f?.minScore != null ? String(f.minScore) : "",
    maxScore: f?.maxScore != null ? String(f.maxScore) : "",
    courseInterest: f?.courseInterest ?? "",
    location: f?.location ?? "",
    createdAfter: f?.createdAfter ? f.createdAfter.slice(0, 10) : "",
  };
}

export function toAudienceFilter(a: AudienceDraft): CampaignAudienceFilter {
  if (a.type === "manual") return { type: "manual" };
  const filter: CampaignAudienceFilter = { type: "filter" };
  if (a.statuses.length) filter.statuses = a.statuses;
  if (splitList(a.sources).length) filter.sources = splitList(a.sources);
  if (splitList(a.tags).length) filter.tags = splitList(a.tags);
  const min = parseInt(a.minScore, 10);
  const max = parseInt(a.maxScore, 10);
  if (!Number.isNaN(min)) filter.minScore = Math.max(0, Math.min(100, min));
  if (!Number.isNaN(max)) filter.maxScore = Math.max(0, Math.min(100, max));
  if (a.courseInterest.trim()) filter.courseInterest = a.courseInterest.trim();
  if (a.location.trim()) filter.location = a.location.trim();
  if (a.createdAfter) filter.createdAfter = new Date(`${a.createdAfter}T00:00:00`).toISOString();
  return filter;
}

export function toStepInput(step: StepDraft, channel: CampaignChannel): CampaignStepInput {
  const delayMinutes = Math.max(0, Math.round((Number(step.delayValue) || 0) * UNIT_MINUTES[step.delayUnit]));
  if (channel === "email") return { delayMinutes, subject: step.subject.trim(), body: step.body, whatsappTemplate: null };
  const params = step.bodyParams
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    delayMinutes,
    subject: null,
    body: null,
    whatsappTemplate: step.templateName.trim()
      ? { name: step.templateName.trim(), language: step.templateLanguage.trim() || "en", ...(params.length ? { bodyParams: params } : {}) }
      : null,
  };
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function scheduleFromCampaign(initial: CampaignDetail | undefined): ScheduleDraft {
  return {
    scheduleMode: initial?.scheduledAt ? "later" : "now",
    scheduledAt: toLocalInput(initial?.scheduledAt),
    windowOn: !!initial?.sendWindow?.start || !!initial?.sendWindow?.days,
    windowStart: initial?.sendWindow?.start ?? "09:00",
    windowEnd: initial?.sendWindow?.end ?? "18:00",
    windowDays: initial?.sendWindow?.days ?? [1, 2, 3, 4, 5],
    windowTz: initial?.sendWindow?.timezone ?? "",
    throttle: String(initial?.throttlePerHour ?? 100),
    fromName: initial?.fromIdentity.name ?? "",
    fromEmail: initial?.fromIdentity.email ?? "",
    replyTo: initial?.fromIdentity.replyTo ?? "",
    phoneNumberId: initial?.fromIdentity.phoneNumberId ?? "",
  };
}

export function stepProblems(steps: StepDraft[], channel: CampaignChannel): string | null {
  if (steps.length === 0) return "Add at least one message.";
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (channel === "email" && (!s.subject.trim() || !s.body.trim())) return `Message ${i + 1} needs a subject and a body.`;
    if (channel === "whatsapp" && (!s.templateName.trim() || !s.templateLanguage.trim())) {
      return `Message ${i + 1} needs an approved template name and language.`;
    }
    if (channel === "whatsapp" && !/^[a-z0-9_]+$/.test(s.templateName.trim())) {
      return `Message ${i + 1}: template names use lowercase letters, numbers and underscores.`;
    }
  }
  return null;
}

export const chip = (active: boolean) =>
  cn(
    "h-8 rounded-lg px-3 text-xs font-medium border transition-colors",
    active ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
  );

export const textareaClass =
  "w-full rounded-lg bg-card/60 border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all disabled:opacity-60";
