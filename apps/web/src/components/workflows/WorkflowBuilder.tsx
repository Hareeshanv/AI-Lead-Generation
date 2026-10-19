"use client";

import React, { useMemo, useState } from "react";
import { Filter, Zap, ListOrdered } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, selectClassName } from "@/components/settings/shared";
import { useCampaigns, useMembers } from "@/hooks";
import type { WorkflowAction, WorkflowInput, WorkflowTrigger, WorkflowTriggerType } from "@/types";
import { TRIGGERS, defaultTrigger, triggerMeta, validateDraft } from "./catalog";
import { SectionHeading, type ErrorLookup } from "./builder/fields";
import { TriggerFields } from "./builder/TriggerFields";
import { ConditionsEditor } from "./builder/ConditionsEditor";
import { ActionsEditor } from "./builder/ActionsEditor";
import type { ActionFieldOptions } from "./builder/ActionFields";

export interface WorkflowBuilderProps {
  initial: WorkflowInput;
  title: string;
  saving?: boolean;
  /** Field errors from the API (ApiError.fields). */
  serverErrors?: Record<string, string[]>;
  onSave: (draft: WorkflowInput) => void;
  onCancel: () => void;
}

export function WorkflowBuilder({ initial, title, saving, serverErrors, onSave, onCancel }: WorkflowBuilderProps) {
  const [draft, setDraft] = useState<WorkflowInput>(initial);
  const [submitted, setSubmitted] = useState(false);
  const members = useMembers();
  const campaigns = useCampaigns({ pageSize: 100 });

  const clientErrors = useMemo(() => validateDraft(draft), [draft]);
  const err: ErrorLookup = (key) => (submitted ? clientErrors[key] : undefined) ?? serverErrors?.[key]?.[0];

  const campaignOptions = (campaigns.data?.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.status})` }));
  const actionOptions: ActionFieldOptions = {
    members: (members.data ?? [])
      .filter((m) => m.status !== "pending")
      .map((m) => ({ value: m.userId, label: m.fullName || m.email || m.userId })),
    membersLoading: members.isLoading,
    campaigns: campaignOptions,
    campaignsLoading: campaigns.isLoading,
  };

  const setTrigger = (patch: Partial<WorkflowTrigger>) => setDraft((d) => ({ ...d, trigger: { ...d.trigger, ...patch } }));
  const setRules = (fn: (rules: WorkflowInput["conditions"]["rules"]) => WorkflowInput["conditions"]["rules"]) =>
    setDraft((d) => ({ ...d, conditions: { ...d.conditions, rules: fn(d.conditions.rules) } }));
  const setActions = (fn: (actions: WorkflowAction[]) => WorkflowAction[]) => setDraft((d) => ({ ...d, actions: fn(d.actions) }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(validateDraft(draft)).length > 0) return;
    onSave(draft);
  };

  const t = draft.trigger;
  const subjects = t.type === "schedule" ? (t.scope === "leads" ? ["lead"] : []) : triggerMeta(t.type)?.subjects ?? [];

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={saving}>
              Save workflow
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field id="wf-name" label="Name" error={err("name")}>
            <Input id="wf-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </Field>
          <Field id="wf-description" label="Description (optional)">
            <Input id="wf-description" value={draft.description ?? ""} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <SectionHeading icon={Zap} step={1} title="When this happens" hint={triggerMeta(t.type)?.description} />
        <Field id="wf-trigger" label="Trigger" error={err("trigger.type") ?? err("trigger")}>
          <select
            id="wf-trigger"
            className={selectClassName}
            value={t.type}
            onChange={(e) => setDraft((d) => ({ ...d, trigger: defaultTrigger(e.target.value as WorkflowTriggerType) }))}
          >
            {TRIGGERS.map((tr) => (
              <option key={tr.type} value={tr.type}>
                {tr.label}
              </option>
            ))}
          </select>
        </Field>
        <TriggerFields trigger={t} setTrigger={setTrigger} err={err} campaignOptions={campaignOptions} />
      </Card>

      <Card className="space-y-4">
        <SectionHeading
          icon={Filter}
          step={2}
          title="Only if (optional)"
          hint="Compare fields of the lead, deal or event. With no conditions, every trigger runs the actions."
        />
        <ConditionsEditor
          conditions={draft.conditions}
          onOpChange={(op) => setDraft((d) => ({ ...d, conditions: { ...d.conditions, op } }))}
          setRules={setRules}
          defaultField={subjects.includes("lead") ? "lead.score" : "event.to"}
          err={err}
        />
      </Card>

      <Card className="space-y-4">
        <SectionHeading icon={ListOrdered} step={3} title="Then do this" hint="Actions run in order. A failed action stops the run." />
        <ActionsEditor actions={draft.actions} setActions={setActions} err={err} options={actionOptions} />
      </Card>

      {submitted && Object.keys(clientErrors).length > 0 && (
        <p className="text-sm text-destructive" role="alert">
          Fix the highlighted fields before saving.
        </p>
      )}
    </form>
  );
}
