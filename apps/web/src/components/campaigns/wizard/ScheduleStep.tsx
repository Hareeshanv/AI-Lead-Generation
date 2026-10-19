"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Field, fieldError } from "@/components/settings/shared";
import type { CampaignChannel } from "@/types";
import { chip, type ScheduleDraft } from "./draft";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleStep({
  schedule,
  setSchedule,
  channel,
  stepsLocked,
  orgTz,
  saveError,
}: {
  schedule: ScheduleDraft;
  setSchedule: React.Dispatch<React.SetStateAction<ScheduleDraft>>;
  channel: CampaignChannel;
  stepsLocked: boolean;
  orgTz: string;
  saveError: unknown;
}) {
  const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => setSchedule((s) => ({ ...s, [key]: value }));
  const { scheduleMode, windowOn, windowDays } = schedule;

  return (
    <Card className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">Start</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(scheduleMode === "now")} onClick={() => set("scheduleMode", "now")} disabled={stepsLocked}>
            As soon as I launch
          </button>
          <button type="button" className={chip(scheduleMode === "later")} onClick={() => set("scheduleMode", "later")} disabled={stepsLocked}>
            At a scheduled time
          </button>
        </div>
        {scheduleMode === "later" && (
          <Field id="cmp-at" label="Start at (your local time)" error={fieldError(saveError, "scheduledAt")}>
            <Input id="cmp-at" type="datetime-local" value={schedule.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} disabled={stepsLocked} />
          </Field>
        )}
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={windowOn} onChange={(e) => set("windowOn", e.target.checked)} className="h-4 w-4 accent-primary" />
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
                    onClick={() => set("windowDays", active ? windowDays.filter((x) => x !== i) : [...windowDays, i].sort())}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field id="win-start" label="From">
                <Input id="win-start" type="time" value={schedule.windowStart} onChange={(e) => set("windowStart", e.target.value)} />
              </Field>
              <Field id="win-end" label="Until">
                <Input id="win-end" type="time" value={schedule.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} />
              </Field>
              <Field id="win-tz" label="Time zone" error={fieldError(saveError, "sendWindow.timezone")}>
                <Input id="win-tz" value={schedule.windowTz} onChange={(e) => set("windowTz", e.target.value)} placeholder={orgTz} />
              </Field>
            </div>
          </div>
        )}
      </div>

      <Field id="cmp-throttle" label="Maximum messages per hour" hint="Sends are spread evenly; protects your sender reputation and WhatsApp quality rating.">
        <Input id="cmp-throttle" type="number" min={1} max={10000} value={schedule.throttle} onChange={(e) => set("throttle", e.target.value)} className="w-40" />
      </Field>

      {channel === "email" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="from-name" label="From name (optional)">
            <Input id="from-name" value={schedule.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder="Integration default" />
          </Field>
          <Field id="from-email" label="From email (optional)" hint="Must be on your verified Resend domain." error={fieldError(saveError, "fromIdentity.email")}>
            <Input id="from-email" type="email" value={schedule.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} placeholder="Integration default" />
          </Field>
          <Field id="reply-to" label="Reply-to (optional)" error={fieldError(saveError, "fromIdentity.replyTo")}>
            <Input id="reply-to" type="email" value={schedule.replyTo} onChange={(e) => set("replyTo", e.target.value)} placeholder="counsellor@yourdomain.com" />
          </Field>
        </div>
      ) : (
        <Field id="phone-id" label="WhatsApp phone number ID (optional)" hint="Defaults to the number configured in Integrations." error={fieldError(saveError, "fromIdentity.phoneNumberId")}>
          <Input id="phone-id" value={schedule.phoneNumberId} onChange={(e) => set("phoneNumberId", e.target.value)} className="max-w-xs" />
        </Field>
      )}
    </Card>
  );
}
