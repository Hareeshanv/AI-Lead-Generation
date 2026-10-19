"use client";

import React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, fieldError, selectClassName } from "@/components/settings/shared";
import { cn } from "@/lib/utils";
import type { CampaignChannel } from "@/types";
import { MAX_MESSAGES, emptyStep, textareaClass, type DelayUnit, type StepDraft } from "./draft";

const VARIABLES = ["first_name", "name", "company", "course", "city", "email"];

export function MessagesStep({
  steps,
  setSteps,
  channel,
  stepsLocked,
  saveError,
}: {
  steps: StepDraft[];
  setSteps: React.Dispatch<React.SetStateAction<StepDraft[]>>;
  channel: CampaignChannel;
  stepsLocked: boolean;
  saveError: unknown;
}) {
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

  return (
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
      {!stepsLocked && steps.length < MAX_MESSAGES && (
        <Button variant="outline" size="sm" onClick={() => setSteps((list) => [...list, emptyStep(false)])}>
          <Plus className="h-4 w-4" /> Add follow-up
        </Button>
      )}
    </div>
  );
}
