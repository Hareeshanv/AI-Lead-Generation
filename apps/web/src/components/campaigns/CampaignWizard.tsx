"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Rocket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCreateCampaign, useLaunchCampaign, useMe, useUpdateCampaign } from "@/hooks";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { CampaignChannel, CampaignDetail, CampaignInput, CampaignSendWindow } from "@/types";
import {
  WIZARD_STEPS,
  audienceFromFilter,
  emptyStep,
  scheduleFromCampaign,
  stepFromInput,
  stepProblems,
  toAudienceFilter,
  toStepInput,
  type AudienceDraft,
  type ScheduleDraft,
  type StepDraft,
} from "./wizard/draft";
import { AudiencePreviewPanel } from "./wizard/AudiencePreviewPanel";
import { SetupStep } from "./wizard/SetupStep";
import { AudienceStep } from "./wizard/AudienceStep";
import { MessagesStep } from "./wizard/MessagesStep";
import { ScheduleStep } from "./wizard/ScheduleStep";
import { ReviewStep } from "./wizard/ReviewStep";

export function CampaignWizard({ initial }: { initial?: CampaignDetail }) {
  const router = useRouter();
  const me = useMe();
  const orgTz = me.data?.settings.timezone || "UTC";
  const isEdit = !!initial;
  const lockedSetup = isEdit && initial.status !== "draft";
  const stepsLocked = isEdit && initial.status !== "draft" && initial.status !== "paused";

  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [channel, setChannel] = useState<CampaignChannel>(initial?.channel ?? "email");
  const [audience, setAudience] = useState<AudienceDraft>(() => audienceFromFilter(initial?.audienceFilter));
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    initial?.steps.length ? initial.steps.map(stepFromInput) : [emptyStep(true)]
  );
  const [schedule, setSchedule] = useState<ScheduleDraft>(() => scheduleFromCampaign(initial));

  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const launch = useLaunchCampaign();
  const saveError = create.error ?? update.error;

  const filter = useMemo(() => toAudienceFilter(audience), [audience]);
  const sendWindow: CampaignSendWindow = schedule.windowOn
    ? { start: schedule.windowStart, end: schedule.windowEnd, days: schedule.windowDays, timezone: schedule.windowTz || orgTz }
    : {};

  const buildInput = (): CampaignInput => {
    const { fromName, fromEmail, replyTo, phoneNumberId } = schedule;
    const input: CampaignInput = {
      name: name.trim(),
      description: description.trim() || null,
      channel,
      sendWindow,
      throttlePerHour: Math.max(1, Math.min(10_000, parseInt(schedule.throttle, 10) || 100)),
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
      scheduledAt: schedule.scheduleMode === "later" && schedule.scheduledAt ? new Date(schedule.scheduledAt).toISOString() : null,
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
      const { scheduleMode, scheduledAt, windowOn, windowDays, windowStart, windowEnd } = schedule;
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

  const saving = create.isPending || update.isPending || launch.isPending;

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
        <SetupStep
          name={name}
          onNameChange={setName}
          description={description}
          onDescriptionChange={setDescription}
          channel={channel}
          onChannelChange={setChannel}
          lockedSetup={lockedSetup}
          saveError={saveError}
        />
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
          <AudienceStep audience={audience} setAudience={setAudience} lockedSetup={lockedSetup} />
          <AudiencePreviewPanel channel={channel} filter={filter} campaignId={initial?.id} />
        </div>
      )}

      {step === 2 && <MessagesStep steps={steps} setSteps={setSteps} channel={channel} stepsLocked={stepsLocked} saveError={saveError} />}

      {step === 3 && (
        <ScheduleStep schedule={schedule} setSchedule={setSchedule} channel={channel} stepsLocked={stepsLocked} orgTz={orgTz} saveError={saveError} />
      )}

      {step === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
          <ReviewStep
            name={name}
            description={description}
            channel={channel}
            audience={audience}
            steps={steps}
            schedule={schedule}
            sendWindow={sendWindow}
            orgTz={orgTz}
          />
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
                  <Rocket className="h-4 w-4" /> {schedule.scheduleMode === "later" ? "Save & schedule" : "Save & launch"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
