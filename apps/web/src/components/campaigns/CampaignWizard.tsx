"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Mail, MessageCircle, Plus, Rocket, Trash2, Users } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, fieldError, selectClassName } from "@/components/settings/shared";
import {
  ChannelBadge,
  EXCLUSION_LABELS,
  describeSendWindow,
  formatDateTime,
  formatDelay,
  useDebounced,
} from "@/components/campaigns/shared";
import { useAudiencePreview, useCreateCampaign, useLaunchCampaign, useMe, useUpdateCampaign } from "@/hooks";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type {
  CampaignAudienceFilter,
  CampaignChannel,
  CampaignDetail,
  CampaignInput,
  CampaignSendWindow,
  CampaignStepInput,
  ExclusionReason,
} from "@/types";

const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Hot", "Warm", "Cold", "Closed"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WIZARD_STEPS = ["Channel", "Audience", "Messages", "Schedule", "Review"] as const;
const VARIABLES = ["first_name", "name", "company", "course", "city", "email"];
type DelayUnit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 1440 };

interface StepDraft {
  key: string;
  delayValue: number;
  delayUnit: DelayUnit;
  subject: string;
  body: string;
  templateName: string;
  templateLanguage: string;
  bodyParams: string;
}

interface AudienceDraft {
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

let stepKey = 0;
const newKey = () => `step-${++stepKey}`;

function emptyStep(first: boolean): StepDraft {
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

function stepFromInput(step: CampaignStepInput): StepDraft {
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

function audienceFromFilter(f: CampaignAudienceFilter | undefined): AudienceDraft {
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

function toAudienceFilter(a: AudienceDraft): CampaignAudienceFilter {
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

function toStepInput(step: StepDraft, channel: CampaignChannel): CampaignStepInput {
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

function stepProblems(steps: StepDraft[], channel: CampaignChannel): string | null {
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

const chip = (active: boolean) =>
  cn(
    "h-8 rounded-lg px-3 text-xs font-medium border transition-colors",
    active ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
  );

const textareaClass =
  "w-full rounded-lg bg-card/60 border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all disabled:opacity-60";

function AudiencePreviewPanel({
  channel,
  filter,
  campaignId,
}: {
  channel: CampaignChannel;
  filter: CampaignAudienceFilter;
  campaignId?: string;
}) {
  const debounced = useDebounced(filter, 500);
  const preview = useAudiencePreview(channel, debounced, campaignId);
  const data = preview.data;
  const excluded = data ? (Object.entries(data.excluded) as [ExclusionReason, number][]).filter(([, n]) => n > 0) : [];

  return (
    <Card className="space-y-3 bg-muted/20">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Users className="h-4 w-4 text-muted-foreground" /> Audience preview
        {preview.isFetching && <span className="text-xs font-normal text-muted-foreground">updating…</span>}
      </div>
      {preview.isError ? (
        <p className="text-sm text-destructive">{(preview.error as Error)?.message || "Couldn't preview the audience."}</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Calculating…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Matching leads", value: data.matched },
              { label: "Added manually", value: data.manual },
              { label: "Will receive", value: data.eligible },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border bg-card/60 p-2">
                <div className="text-[11px] text-muted-foreground">{m.label}</div>
                <div className="text-lg font-semibold tabular-nums text-foreground">{m.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
          {data.capped && <p className="text-xs text-amber-500">Only the newest 20,000 matching leads are included. Narrow the filter.</p>}
          {excluded.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {excluded.map(([reason, n]) => (
                <li key={reason}>
                  {n.toLocaleString()} excluded: {EXCLUSION_LABELS[reason]}
                </li>
              ))}
            </ul>
          )}
          {data.sample.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground/80">Sample recipients</div>
              <ul className="space-y-0.5">
                {data.sample.slice(0, 5).map((s) => (
                  <li key={s.id} className="truncate">
                    {s.name || "Unnamed"}
                    {s.company && s.company !== "Not available" ? ` · ${s.company}` : ""} — {s.address}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Leads marked do-not-contact, unsubscribed, or without consent for {channel === "email" ? "email" : "WhatsApp"} are never
            contacted. Consent comes from the lead&apos;s consent channels or a lead-form consent.
          </p>
        </>
      )}
    </Card>
  );
}

export function CampaignWizard({ initial }: { initial?: CampaignDetail }) {
  const router = useRouter();
  const me = useMe();
  const orgTz = me.data?.settings.timezone || "UTC";
  const isEdit = !!initial;
  const lockedSetup = isEdit && initial.status !== "draft";

  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [channel, setChannel] = useState<CampaignChannel>(initial?.channel ?? "email");
  const [audience, setAudience] = useState<AudienceDraft>(() => audienceFromFilter(initial?.audienceFilter));
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    initial?.steps.length ? initial.steps.map(stepFromInput) : [emptyStep(true)]
  );
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">(initial?.scheduledAt ? "later" : "now");
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(initial?.scheduledAt));
  const [windowOn, setWindowOn] = useState(!!initial?.sendWindow?.start || !!initial?.sendWindow?.days);
  const [windowStart, setWindowStart] = useState(initial?.sendWindow?.start ?? "09:00");
  const [windowEnd, setWindowEnd] = useState(initial?.sendWindow?.end ?? "18:00");
  const [windowDays, setWindowDays] = useState<number[]>(initial?.sendWindow?.days ?? [1, 2, 3, 4, 5]);
  const [windowTz, setWindowTz] = useState(initial?.sendWindow?.timezone ?? "");
  const [throttle, setThrottle] = useState(String(initial?.throttlePerHour ?? 100));
  const [fromName, setFromName] = useState(initial?.fromIdentity.name ?? "");
  const [fromEmail, setFromEmail] = useState(initial?.fromIdentity.email ?? "");
  const [replyTo, setReplyTo] = useState(initial?.fromIdentity.replyTo ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(initial?.fromIdentity.phoneNumberId ?? "");

  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const launch = useLaunchCampaign();
  const saveError = create.error ?? update.error;

  const filter = useMemo(() => toAudienceFilter(audience), [audience]);
  const sendWindow: CampaignSendWindow = windowOn
    ? { start: windowStart, end: windowEnd, days: windowDays, timezone: windowTz || orgTz }
    : {};

  const buildInput = (): CampaignInput => {
    const input: CampaignInput = {
      name: name.trim(),
      description: description.trim() || null,
      channel,
      sendWindow,
      throttlePerHour: Math.max(1, Math.min(10_000, parseInt(throttle, 10) || 100)),
      fromIdentity:
        channel === "email"
          ? {
              ...(fromName.trim() ? { name: fromName.trim() } : {}),
              ...(fromEmail.trim() ? { email: fromEmail.trim() } : {}),
              ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}),
            }
          : phoneNumberId.trim()
            ? { phoneNumberId: phoneNumberId.trim() }
            : {},
      scheduledAt: scheduleMode === "later" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      steps: steps.map((s) => toStepInput(s, channel)),
    };
    if (!lockedSetup) input.audienceFilter = filter;
    if (lockedSetup) delete (input as Partial<CampaignInput>).channel;
    if (isEdit && initial.status !== "draft" && initial.status !== "paused") {
      delete input.steps;
      delete input.scheduledAt;
    }
    return input;
  };

  const validateCurrent = (index: number): string | null => {
    if (index === 0 && !name.trim()) return "Give the campaign a name.";
    if (index === 2) return stepProblems(steps, channel);
    if (index === 3) {
      if (scheduleMode === "later" && !stepsLocked) {
        if (!scheduledAt) return "Pick a start date and time.";
        if (new Date(scheduledAt).getTime() < Date.now()) return "The start time must be in the future.";
      }
      if (windowOn && windowDays.length === 0) return "Pick at least one sending day.";
      if (windowOn && windowStart === windowEnd) return "Sending hours need different start and end times.";
    }
    return null;
  };

  const goNext = () => {
    const problem = validateCurrent(step);
    if (problem) return notifyError(problem);
    setStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1));
  };

  const save = async (andLaunch: boolean) => {
    for (let i = 0; i < WIZARD_STEPS.length - 1; i++) {
      const problem = validateCurrent(i);
      if (problem) {
        setStep(i);
        return notifyError(problem);
      }
    }
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: initial.id, patch: buildInput() })
        : await create.mutateAsync(buildInput());
      if (andLaunch) {
        try {
          await launch.mutateAsync(saved.id);
        } catch {
          // The launch error toast explains why (e.g. channel not configured); the draft is kept.
        }
      }
      router.push(`/campaigns/${saved.id}`);
    } catch {
      // Toast already shown by useApiMutation.
    }
  };

  const updateStep = (key: string, patch: Partial<StepDraft>) =>
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const moveStep = (index: number, dir: -1 | 1) =>
    setSteps((list) => {
      const next = [...list];
      const target = index + dir;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const saving = create.isPending || update.isPending || launch.isPending;
  const stepsLocked = isEdit && initial.status !== "draft" && initial.status !== "paused";

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Wizard steps">
        {WIZARD_STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (i < step ? setStep(i) : undefined)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium",
                i === step
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : i < step
                    ? "border-border text-foreground hover:bg-muted"
                    : "border-border text-muted-foreground cursor-default"
              )}
              aria-current={i === step ? "step" : undefined}
            >
              {i < step ? <Check className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}
              {label}
            </button>
            {i < WIZARD_STEPS.length - 1 && <span className="h-px w-4 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card className="space-y-5 max-w-2xl">
          <Field id="cmp-name" label="Campaign name" error={fieldError(saveError, "name")}>
            <Input id="cmp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NEET 2027 batch — follow-up" maxLength={150} />
          </Field>
          <Field id="cmp-desc" label="Description (optional)">
            <textarea id="cmp-desc" className={textareaClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Channel</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  { value: "email", icon: Mail, title: "Email", text: "Sent through Resend with open/click tracking and an unsubscribe link." },
                  { value: "whatsapp", icon: MessageCircle, title: "WhatsApp", text: "Approved WhatsApp Cloud API templates; replies stop the sequence." },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={lockedSetup}
                  onClick={() => setChannel(opt.value)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                    channel === opt.value ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50"
                  )}
                  aria-pressed={channel === opt.value}
                >
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <opt.icon className="h-4 w-4" /> {opt.title}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{opt.text}</p>
                </button>
              ))}
            </div>
            {lockedSetup && <p className="text-[11px] text-muted-foreground">The channel can only change while the campaign is a draft.</p>}
          </div>
        </Card>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
          <Card className="space-y-5">
            {lockedSetup && (
              <p className="text-xs text-amber-500">
                The audience filter is locked after launch. Add more leads from the Leads page or the campaign detail page.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={lockedSetup} className={chip(audience.type === "filter")} onClick={() => setAudience((a) => ({ ...a, type: "filter" }))}>
                Leads matching filters
              </button>
              <button type="button" disabled={lockedSetup} className={chip(audience.type === "manual")} onClick={() => setAudience((a) => ({ ...a, type: "manual" }))}>
                Only leads I add manually
              </button>
            </div>
            {audience.type === "manual" ? (
              <p className="text-sm text-muted-foreground">
                Save the campaign, then add leads from the Leads page (&ldquo;Add to campaign&rdquo;). They are checked for consent and
                unsubscribes at launch.
              </p>
            ) : (
              <fieldset disabled={lockedSetup} className="space-y-4">
                <p className="text-xs text-muted-foreground">No filters means every lead in the workspace. Leads added manually are always included.</p>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Lead status</span>
                  <div className="flex flex-wrap gap-1.5">
                    {LEAD_STATUSES.map((s) => {
                      const active = audience.statuses.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          className={chip(active)}
                          onClick={() =>
                            setAudience((a) => ({ ...a, statuses: active ? a.statuses.filter((x) => x !== s) : [...a.statuses, s] }))
                          }
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="aud-min" label="Minimum score">
                    <Input id="aud-min" type="number" min={0} max={100} value={audience.minScore} onChange={(e) => setAudience((a) => ({ ...a, minScore: e.target.value }))} placeholder="0" />
                  </Field>
                  <Field id="aud-max" label="Maximum score">
                    <Input id="aud-max" type="number" min={0} max={100} value={audience.maxScore} onChange={(e) => setAudience((a) => ({ ...a, maxScore: e.target.value }))} placeholder="100" />
                  </Field>
                  <Field id="aud-sources" label="Sources" hint="Comma separated, e.g. Meta Lead Ads, AI Agent">
                    <Input id="aud-sources" value={audience.sources} onChange={(e) => setAudience((a) => ({ ...a, sources: e.target.value }))} />
                  </Field>
                  <Field id="aud-tags" label="Tags (any of)" hint="Comma separated">
                    <Input id="aud-tags" value={audience.tags} onChange={(e) => setAudience((a) => ({ ...a, tags: e.target.value }))} />
                  </Field>
                  <Field id="aud-course" label="Course interest contains">
                    <Input id="aud-course" value={audience.courseInterest} onChange={(e) => setAudience((a) => ({ ...a, courseInterest: e.target.value }))} placeholder="e.g. NEET" />
                  </Field>
                  <Field id="aud-location" label="Location contains">
                    <Input id="aud-location" value={audience.location} onChange={(e) => setAudience((a) => ({ ...a, location: e.target.value }))} placeholder="e.g. Kota" />
                  </Field>
                  <Field id="aud-after" label="Created on or after">
                    <Input id="aud-after" type="date" value={audience.createdAfter} onChange={(e) => setAudience((a) => ({ ...a, createdAfter: e.target.value }))} />
                  </Field>
                </div>
              </fieldset>
            )}
          </Card>
          <AudiencePreviewPanel channel={channel} filter={filter} campaignId={initial?.id} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 max-w-3xl">
          {stepsLocked && <p className="text-xs text-amber-500">Pause the campaign to edit its messages.</p>}
          <p className="text-xs text-muted-foreground">
            Personalise with{" "}
            {VARIABLES.map((v, i) => (
              <React.Fragment key={v}>
                <code className="rounded bg-muted px-1">{`{{${v}}}`}</code>
                {i < VARIABLES.length - 1 ? ", " : ""}
              </React.Fragment>
            ))}
            . Add a fallback with <code className="rounded bg-muted px-1">{"{{first_name|there}}"}</code>. A reply stops the sequence for that lead.
          </p>
          {steps.map((s, i) => (
            <Card key={s.key} className="space-y-4">
              <fieldset disabled={stepsLocked} className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Message {i + 1}</h3>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setSteps((list) => list.filter((x) => x.key !== s.key))}
                      disabled={steps.length === 1}
                      aria-label="Remove message"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field id={`delay-${s.key}`} label={i === 0 ? "Send after launch" : "Wait after previous message"} className="w-32">
                    <Input
                      id={`delay-${s.key}`}
                      type="number"
                      min={0}
                      value={s.delayValue}
                      onChange={(e) => updateStep(s.key, { delayValue: Math.max(0, Number(e.target.value)) })}
                    />
                  </Field>
                  <select
                    aria-label="Delay unit"
                    className={cn(selectClassName, "w-32")}
                    value={s.delayUnit}
                    onChange={(e) => updateStep(s.key, { delayUnit: e.target.value as DelayUnit })}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                </div>
                {channel === "email" ? (
                  <>
                    <Field id={`subject-${s.key}`} label="Subject" error={fieldError(saveError, `steps.${i}.subject`)}>
                      <Input id={`subject-${s.key}`} value={s.subject} maxLength={300} onChange={(e) => updateStep(s.key, { subject: e.target.value })} placeholder="Hi {{first_name|there}}, quick question" />
                    </Field>
                    <Field id={`body-${s.key}`} label="Body (plain text)" error={fieldError(saveError, `steps.${i}.body`)} hint="An unsubscribe link is added automatically.">
                      <textarea id={`body-${s.key}`} className={textareaClass} rows={7} value={s.body} maxLength={20_000} onChange={(e) => updateStep(s.key, { body: e.target.value })} />
                    </Field>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                      <Field id={`tpl-${s.key}`} label="Approved template name" error={fieldError(saveError, `steps.${i}.whatsappTemplate`)}>
                        <Input id={`tpl-${s.key}`} value={s.templateName} onChange={(e) => updateStep(s.key, { templateName: e.target.value })} placeholder="course_followup_1" />
                      </Field>
                      <Field id={`lang-${s.key}`} label="Language code">
                        <Input id={`lang-${s.key}`} value={s.templateLanguage} onChange={(e) => updateStep(s.key, { templateLanguage: e.target.value })} placeholder="en" />
                      </Field>
                    </div>
                    <Field id={`params-${s.key}`} label="Body parameters (one per line)" hint="Fill {{1}}, {{2}}, … of the approved template, in order. Variables like {{first_name}} work here.">
                      <textarea id={`params-${s.key}`} className={textareaClass} rows={3} value={s.bodyParams} onChange={(e) => updateStep(s.key, { bodyParams: e.target.value })} placeholder={"{{first_name|there}}\n{{course}}"} />
                    </Field>
                  </>
                )}
              </fieldset>
            </Card>
          ))}
          {!stepsLocked && steps.length < 10 && (
            <Button variant="outline" size="sm" onClick={() => setSteps((list) => [...list, emptyStep(false)])}>
              <Plus className="h-4 w-4" /> Add follow-up
            </Button>
          )}
        </div>
      )}

      {step === 3 && (
        <Card className="space-y-6 max-w-2xl">
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Start</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chip(scheduleMode === "now")} onClick={() => setScheduleMode("now")} disabled={stepsLocked}>
                As soon as I launch
              </button>
              <button type="button" className={chip(scheduleMode === "later")} onClick={() => setScheduleMode("later")} disabled={stepsLocked}>
                At a scheduled time
              </button>
            </div>
            {scheduleMode === "later" && (
              <Field id="cmp-at" label="Start at (your local time)" error={fieldError(saveError, "scheduledAt")}>
                <Input id="cmp-at" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={stepsLocked} />
              </Field>
            )}
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={windowOn} onChange={(e) => setWindowOn(e.target.checked)} className="h-4 w-4 accent-primary" />
              Only send during business hours
            </label>
            {windowOn && (
              <div className="space-y-3 pl-6">
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => {
                    const active = windowDays.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        className={chip(active)}
                        onClick={() => setWindowDays((days) => (active ? days.filter((x) => x !== i) : [...days, i].sort()))}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field id="win-start" label="From">
                    <Input id="win-start" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
                  </Field>
                  <Field id="win-end" label="Until">
                    <Input id="win-end" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
                  </Field>
                  <Field id="win-tz" label="Time zone" error={fieldError(saveError, "sendWindow.timezone")}>
                    <Input id="win-tz" value={windowTz} onChange={(e) => setWindowTz(e.target.value)} placeholder={orgTz} />
                  </Field>
                </div>
              </div>
            )}
          </div>

          <Field id="cmp-throttle" label="Maximum messages per hour" hint="Sends are spread evenly; protects your sender reputation and WhatsApp quality rating.">
            <Input id="cmp-throttle" type="number" min={1} max={10000} value={throttle} onChange={(e) => setThrottle(e.target.value)} className="w-40" />
          </Field>

          {channel === "email" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="from-name" label="From name (optional)">
                <Input id="from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Integration default" />
              </Field>
              <Field id="from-email" label="From email (optional)" hint="Must be on your verified Resend domain." error={fieldError(saveError, "fromIdentity.email")}>
                <Input id="from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="Integration default" />
              </Field>
              <Field id="reply-to" label="Reply-to (optional)" error={fieldError(saveError, "fromIdentity.replyTo")}>
                <Input id="reply-to" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="counsellor@yourdomain.com" />
              </Field>
            </div>
          ) : (
            <Field id="phone-id" label="WhatsApp phone number ID (optional)" hint="Defaults to the number configured in Integrations." error={fieldError(saveError, "fromIdentity.phoneNumberId")}>
              <Input id="phone-id" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className="max-w-xs" />
            </Field>
          )}
        </Card>
      )}

      {step === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
          <Card className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">{name || "Untitled campaign"}</h3>
              {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
              <ChannelBadge channel={channel} className="mt-2" />
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Start</dt>
                <dd className="text-foreground">{scheduleMode === "later" && scheduledAt ? formatDateTime(new Date(scheduledAt).toISOString()) : "When launched"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Sending hours</dt>
                <dd className="text-foreground">{describeSendWindow(sendWindow, orgTz)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Throttle</dt>
                <dd className="text-foreground">{parseInt(throttle, 10) || 100} per hour</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Audience</dt>
                <dd className="text-foreground">{audience.type === "manual" ? "Leads added manually" : "Leads matching filters"}</dd>
              </div>
            </dl>
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Sequence</h4>
              <ol className="space-y-2">
                {steps.map((s, i) => {
                  const input = toStepInput(s, channel);
                  return (
                    <li key={s.key} className="rounded-lg border border-border p-3 text-sm">
                      <div className="text-xs text-muted-foreground">
                        {i + 1}. {i === 0 ? (input.delayMinutes ? formatDelay(input.delayMinutes).replace("later", "after launch") : "At launch") : formatDelay(input.delayMinutes)}
                      </div>
                      <div className="text-foreground truncate">
                        {channel === "email" ? input.subject || "(no subject)" : `Template: ${input.whatsappTemplate?.name || "(none)"}`}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Card>
          <AudiencePreviewPanel channel={channel} filter={filter} campaignId={initial?.id} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => (step === 0 ? router.back() : setStep((s) => s - 1))} disabled={saving}>
          <ArrowLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
        </Button>
        <div className="flex flex-wrap gap-2">
          {step < WIZARD_STEPS.length - 1 ? (
            <>
              {isEdit && (
                <Button variant="outline" onClick={() => save(false)} isLoading={saving}>
                  Save changes
                </Button>
              )}
              <Button onClick={goNext} disabled={saving}>
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => save(false)} isLoading={create.isPending || update.isPending}>
                {isEdit ? "Save changes" : "Save as draft"}
              </Button>
              {(!isEdit || initial.status === "draft") && (
                <Button onClick={() => save(true)} isLoading={launch.isPending} disabled={saving}>
                  <Rocket className="h-4 w-4" /> {scheduleMode === "later" ? "Save & schedule" : "Save & launch"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
