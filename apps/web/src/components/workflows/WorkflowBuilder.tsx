"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Filter, Plus, Trash2, Zap, ListOrdered } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, selectClassName } from "@/components/settings/shared";
import { useCampaigns, useMembers } from "@/hooks";
import { cn } from "@/lib/utils";
import type {
  WorkflowAction,
  WorkflowActionType,
  WorkflowConditionOperator,
  WorkflowConditionRule,
  WorkflowInput,
  WorkflowTrigger,
  WorkflowTriggerType,
} from "@/types";
import {
  ACTIONS,
  CONDITION_FIELDS,
  DEAL_STAGES,
  LEAD_STATUSES,
  OPERATORS,
  TRIGGERS,
  actionMeta,
  defaultParams,
  defaultTrigger,
  isRule,
  isUnary,
  triggerMeta,
  validateDraft,
} from "./catalog";

const textareaClassName =
  "w-full min-h-[72px] rounded-lg bg-card/60 border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all";

export interface WorkflowBuilderProps {
  initial: WorkflowInput;
  title: string;
  saving?: boolean;
  /** Field errors from the API (ApiError.fields). */
  serverErrors?: Record<string, string[]>;
  onSave: (draft: WorkflowInput) => void;
  onCancel: () => void;
}

const SectionHeading: React.FC<{ icon: React.ComponentType<{ className?: string }>; step: number; title: string; hint?: string }> = ({
  icon: Icon,
  step,
  title,
  hint,
}) => (
  <div className="flex items-start gap-3">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">{step}</div>
    <div>
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" /> {title}
      </h3>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  </div>
);

/** A select with free-text fallback via datalist, for statuses and stages. */
const SuggestInput: React.FC<{
  id: string;
  value: string | undefined;
  options: string[];
  placeholder?: string;
  onChange: (v: string) => void;
}> = ({ id, value, options, placeholder, onChange }) => (
  <>
    <Input id={id} list={`${id}-options`} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    <datalist id={`${id}-options`}>
      {options.map((o) => (
        <option key={o} value={o} />
      ))}
    </datalist>
  </>
);

export function WorkflowBuilder({ initial, title, saving, serverErrors, onSave, onCancel }: WorkflowBuilderProps) {
  const [draft, setDraft] = useState<WorkflowInput>(initial);
  const [submitted, setSubmitted] = useState(false);
  const members = useMembers();
  const campaigns = useCampaigns({ pageSize: 100 });

  const clientErrors = useMemo(() => validateDraft(draft), [draft]);
  const err = (key: string): string | undefined => (submitted ? clientErrors[key] : undefined) ?? serverErrors?.[key]?.[0];

  const memberOptions = (members.data ?? [])
    .filter((m) => m.status !== "pending")
    .map((m) => ({ value: m.userId, label: m.fullName || m.email || m.userId }));
  const campaignOptions = (campaigns.data?.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.status})` }));

  const setTrigger = (patch: Partial<WorkflowTrigger>) => setDraft((d) => ({ ...d, trigger: { ...d.trigger, ...patch } }));
  const setRules = (fn: (rules: WorkflowInput["conditions"]["rules"]) => WorkflowInput["conditions"]["rules"]) =>
    setDraft((d) => ({ ...d, conditions: { ...d.conditions, rules: fn(d.conditions.rules) } }));
  const setActions = (fn: (actions: WorkflowAction[]) => WorkflowAction[]) => setDraft((d) => ({ ...d, actions: fn(d.actions) }));
  const setParam = (index: number, key: string, value: unknown) =>
    setActions((list) => list.map((a, i) => (i === index ? { ...a, params: { ...a.params, [key]: value } } : a)));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(validateDraft(draft)).length > 0) return;
    onSave(draft);
  };

  const t = draft.trigger;
  const subjects = t.type === "schedule" ? (t.scope === "leads" ? ["lead"] : []) : triggerMeta(t.type)?.subjects ?? [];
  const nestedGroups = draft.conditions.rules.filter((r) => !isRule(r)).length;

  const renderTriggerFields = () => {
    switch (t.type) {
      case "lead.created":
        return (
          <Field id="wf-trigger-source" label="Only from source (optional)" hint="e.g. meta, google, AI Agent, CSV import">
            <Input id="wf-trigger-source" value={t.source ?? ""} onChange={(e) => setTrigger({ source: e.target.value })} />
          </Field>
        );
      case "lead.status_changed":
      case "deal.stage_changed": {
        const options = t.type === "lead.status_changed" ? LEAD_STATUSES : DEAL_STAGES;
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="wf-trigger-from" label="From (optional)">
              <SuggestInput id="wf-trigger-from" value={t.from} options={options} placeholder="Any" onChange={(v) => setTrigger({ from: v })} />
            </Field>
            <Field id="wf-trigger-to" label="To (optional)">
              <SuggestInput id="wf-trigger-to" value={t.to} options={options} placeholder="Any" onChange={(v) => setTrigger({ to: v })} />
            </Field>
          </div>
        );
      }
      case "lead.score_above":
        return (
          <Field id="wf-trigger-threshold" label="Score threshold (0-100)" error={err("trigger.threshold")} hint="Fires once when the score rises to or above this value.">
            <Input
              id="wf-trigger-threshold"
              type="number"
              min={0}
              max={100}
              value={t.threshold ?? ""}
              onChange={(e) => setTrigger({ threshold: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </Field>
        );
      case "campaign.replied":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="wf-trigger-campaign" label="Campaign (optional)">
              <select
                id="wf-trigger-campaign"
                className={selectClassName}
                value={t.campaignId ?? ""}
                onChange={(e) => setTrigger({ campaignId: e.target.value || undefined })}
              >
                <option value="">Any campaign</option>
                {campaignOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="wf-trigger-channel" label="Channel (optional)">
              <select
                id="wf-trigger-channel"
                className={selectClassName}
                value={t.channel ?? ""}
                onChange={(e) => setTrigger({ channel: (e.target.value || undefined) as WorkflowTrigger["channel"] })}
              >
                <option value="">Any channel</option>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </Field>
          </div>
        );
      case "agent.run_completed":
        return (
          <Field id="wf-trigger-agent-status" label="Run result (optional)">
            <select
              id="wf-trigger-agent-status"
              className={selectClassName}
              value={t.status ?? ""}
              onChange={(e) => setTrigger({ status: (e.target.value || undefined) as WorkflowTrigger["status"] })}
            >
              <option value="">Any result</option>
              <option value="completed">Completed</option>
              <option value="completed_with_errors">Completed with errors</option>
              <option value="failed">Failed</option>
            </select>
          </Field>
        );
      case "schedule":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              id="wf-trigger-cron"
              label="Cron expression"
              error={err("trigger.cron")}
              hint="minute hour day month weekday, e.g. 0 9 * * 1-5 = weekdays 9:00"
            >
              <Input id="wf-trigger-cron" value={t.cron ?? ""} onChange={(e) => setTrigger({ cron: e.target.value })} />
            </Field>
            <Field id="wf-trigger-tz" label="Time zone" error={err("trigger.timezone")}>
              <Input id="wf-trigger-tz" value={t.timezone ?? ""} placeholder="UTC" onChange={(e) => setTrigger({ timezone: e.target.value })} />
            </Field>
            <Field id="wf-trigger-scope" label="Run for" hint="Per-lead runs are capped at 100 per tick.">
              <select
                id="wf-trigger-scope"
                className={selectClassName}
                value={t.scope ?? "none"}
                onChange={(e) => setTrigger({ scope: e.target.value as "none" | "leads" })}
              >
                <option value="none">Once per schedule</option>
                <option value="leads">Each lead matching the conditions</option>
              </select>
            </Field>
          </div>
        );
    }
  };

  const memberSelect = (id: string, value: string | undefined, onChange: (v: string) => void, placeholder = "Pick a teammate") => (
    <select id={id} className={selectClassName} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{members.isLoading ? "Loading…" : placeholder}</option>
      {memberOptions.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );

  const renderActionFields = (action: WorkflowAction, i: number) => {
    const p = action.params || {};
    const id = (k: string) => `wf-action-${i}-${k}`;
    const e = (k: string) => err(`actions.${i}.params.${k}`);
    switch (action.type as WorkflowActionType) {
      case "assign_owner":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id={id("ownerId")} label="Owner" error={e("ownerId")}>
              {memberSelect(id("ownerId"), p.ownerId, (v) => setParam(i, "ownerId", v))}
            </Field>
            <Field id={id("target")} label="Assign">
              <select id={id("target")} className={selectClassName} value={p.target ?? "lead"} onChange={(ev) => setParam(i, "target", ev.target.value)}>
                <option value="lead">The lead</option>
                <option value="deal">The deal</option>
              </select>
            </Field>
          </div>
        );
      case "set_status":
        return (
          <Field id={id("status")} label="New status" error={e("status")}>
            <SuggestInput id={id("status")} value={p.status} options={LEAD_STATUSES} onChange={(v) => setParam(i, "status", v)} />
          </Field>
        );
      case "set_stage":
        return (
          <Field id={id("stage")} label="New stage" error={e("stage")}>
            <SuggestInput id={id("stage")} value={p.stage} options={DEAL_STAGES} onChange={(v) => setParam(i, "stage", v)} />
          </Field>
        );
      case "add_tag":
        return (
          <Field id={id("tag")} label="Tag" error={e("tag")}>
            <Input id={id("tag")} value={p.tag ?? ""} onChange={(ev) => setParam(i, "tag", ev.target.value)} />
          </Field>
        );
      case "create_task":
        return (
          <div className="space-y-3">
            <Field id={id("title")} label="Task title" error={e("title")} hint="Placeholders like {{lead.name}} are filled in.">
              <Input id={id("title")} value={p.title ?? ""} onChange={(ev) => setParam(i, "title", ev.target.value)} />
            </Field>
            <Field id={id("description")} label="Description (optional)">
              <textarea
                id={id("description")}
                className={textareaClassName}
                value={p.description ?? ""}
                onChange={(ev) => setParam(i, "description", ev.target.value)}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field id={id("dueInDays")} label="Due in (days)" error={e("dueInDays")}>
                <Input
                  id={id("dueInDays")}
                  type="number"
                  min={0}
                  max={365}
                  value={p.dueInDays ?? ""}
                  onChange={(ev) => setParam(i, "dueInDays", ev.target.value === "" ? undefined : Number(ev.target.value))}
                />
              </Field>
              <Field id={id("priority")} label="Priority">
                <select id={id("priority")} className={selectClassName} value={p.priority ?? "normal"} onChange={(ev) => setParam(i, "priority", ev.target.value)}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </Field>
              <Field id={id("assignTo")} label="Assign to">
                <select id={id("assignTo")} className={selectClassName} value={p.assignTo ?? "owner"} onChange={(ev) => setParam(i, "assignTo", ev.target.value)}>
                  <option value="owner">Record owner</option>
                  <option value="user">A teammate</option>
                  <option value="none">Nobody</option>
                </select>
              </Field>
            </div>
            {p.assignTo === "user" && (
              <Field id={id("assigneeId")} label="Teammate" error={e("assigneeId")}>
                {memberSelect(id("assigneeId"), p.assigneeId, (v) => setParam(i, "assigneeId", v))}
              </Field>
            )}
          </div>
        );
      case "create_deal":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id={id("title")} label="Deal title" hint="Defaults to the lead's company.">
              <Input id={id("title")} value={p.title ?? ""} onChange={(ev) => setParam(i, "title", ev.target.value)} />
            </Field>
            <Field id={id("stage")} label="Stage">
              <SuggestInput id={id("stage")} value={p.stage} options={DEAL_STAGES} onChange={(v) => setParam(i, "stage", v)} />
            </Field>
            <Field id={id("value")} label="Value (optional)" error={e("value")}>
              <Input
                id={id("value")}
                type="number"
                min={0}
                value={p.value ?? ""}
                onChange={(ev) => setParam(i, "value", ev.target.value === "" ? undefined : Number(ev.target.value))}
              />
            </Field>
            <Field id={id("probability")} label="Probability % (optional)" error={e("probability")}>
              <Input
                id={id("probability")}
                type="number"
                min={0}
                max={100}
                value={p.probability ?? ""}
                onChange={(ev) => setParam(i, "probability", ev.target.value === "" ? undefined : Number(ev.target.value))}
              />
            </Field>
          </div>
        );
      case "add_to_campaign":
        return (
          <Field
            id={id("campaignId")}
            label="Campaign"
            error={e("campaignId")}
            hint="Consent, do-not-contact and unsubscribe rules still apply."
          >
            <select id={id("campaignId")} className={selectClassName} value={p.campaignId ?? ""} onChange={(ev) => setParam(i, "campaignId", ev.target.value)}>
              <option value="">{campaigns.isLoading ? "Loading…" : "Pick a campaign"}</option>
              {campaignOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        );
      case "notify":
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field id={id("recipients")} label="Notify">
                <select id={id("recipients")} className={selectClassName} value={p.recipients ?? "owner"} onChange={(ev) => setParam(i, "recipients", ev.target.value)}>
                  <option value="owner">Record owner</option>
                  <option value="managers">Admins and managers</option>
                  <option value="admins">Admins</option>
                  <option value="all">Everyone</option>
                  <option value="user">A teammate</option>
                </select>
              </Field>
              {p.recipients === "user" && (
                <Field id={id("userId")} label="Teammate" error={e("userId")}>
                  {memberSelect(id("userId"), p.userId, (v) => setParam(i, "userId", v))}
                </Field>
              )}
            </div>
            <Field id={id("title")} label="Title" error={e("title")} hint="Placeholders like {{lead.name}} are filled in.">
              <Input id={id("title")} value={p.title ?? ""} onChange={(ev) => setParam(i, "title", ev.target.value)} />
            </Field>
            <Field id={id("body")} label="Message (optional)">
              <textarea id={id("body")} className={textareaClassName} value={p.body ?? ""} onChange={(ev) => setParam(i, "body", ev.target.value)} />
            </Field>
          </div>
        );
      case "slack":
        return (
          <Field id={id("message")} label="Message" error={e("message")} hint="Posted through the Slack webhook from Integrations.">
            <textarea id={id("message")} className={textareaClassName} value={p.message ?? ""} onChange={(ev) => setParam(i, "message", ev.target.value)} />
          </Field>
        );
      case "webhook":
        return (
          <div className="space-y-3">
            <Field id={id("url")} label="URL (optional)" error={e("url")} hint="Leave empty to use the outbound webhook from Integrations.">
              <Input id={id("url")} value={p.url ?? ""} placeholder="https://" onChange={(ev) => setParam(i, "url", ev.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={p.includeContext !== false}
                onChange={(ev) => setParam(i, "includeContext", ev.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Include the lead, deal and trigger data
            </label>
          </div>
        );
      case "delay":
        return (
          <div className="grid grid-cols-2 gap-3">
            <Field id={id("amount")} label="Wait" error={e("amount")}>
              <Input
                id={id("amount")}
                type="number"
                min={1}
                value={p.amount ?? ""}
                onChange={(ev) => setParam(i, "amount", ev.target.value === "" ? undefined : Number(ev.target.value))}
              />
            </Field>
            <Field id={id("unit")} label="Unit">
              <select id={id("unit")} className={selectClassName} value={p.unit ?? "hours"} onChange={(ev) => setParam(i, "unit", ev.target.value)}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </Field>
          </div>
        );
      default:
        return <p className="text-xs text-muted-foreground">This action type is not supported by the builder.</p>;
    }
  };

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
        {renderTriggerFields()}
      </Card>

      <Card className="space-y-4">
        <SectionHeading
          icon={Filter}
          step={2}
          title="Only if (optional)"
          hint="Compare fields of the lead, deal or event. With no conditions, every trigger runs the actions."
        />
        {draft.conditions.rules.length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Match</span>
            {(["and", "or"] as const).map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, conditions: { ...d.conditions, op } }))}
                className={cn(
                  "px-2.5 py-1 rounded-md border font-medium",
                  draft.conditions.op === op ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {op === "and" ? "All conditions" : "Any condition"}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {draft.conditions.rules.map((rule, i) => {
            if (!isRule(rule)) return null;
            const unary = isUnary(rule.operator);
            const knownField = CONDITION_FIELDS.some((f) => f.value === rule.field);
            const update = (patch: Partial<WorkflowConditionRule>) =>
              setRules((rules) => rules.map((r, j) => (j === i ? { ...(r as WorkflowConditionRule), ...patch } : r)));
            return (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-start">
                <div>
                  <select
                    aria-label="Field"
                    className={selectClassName}
                    value={rule.field}
                    onChange={(e) => update({ field: e.target.value })}
                  >
                    <option value="">Pick a field</option>
                    {!knownField && rule.field && <option value={rule.field}>{rule.field}</option>}
                    {CONDITION_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  {err(`conditions.rules.${i}.field`) && <p className="text-[11px] text-destructive mt-1">{err(`conditions.rules.${i}.field`)}</p>}
                </div>
                <select
                  aria-label="Operator"
                  className={selectClassName}
                  value={rule.operator}
                  onChange={(e) => update({ operator: e.target.value as WorkflowConditionOperator })}
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div>
                  {!unary && (
                    <Input
                      aria-label="Value"
                      value={rule.value == null ? "" : Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value)}
                      onChange={(e) => update({ value: e.target.value })}
                    />
                  )}
                  {err(`conditions.rules.${i}.value`) && <p className="text-[11px] text-destructive mt-1">{err(`conditions.rules.${i}.value`)}</p>}
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove condition" onClick={() => setRules((rules) => rules.filter((_, j) => j !== i))}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
          {nestedGroups > 0 && (
            <p className="text-xs text-muted-foreground">
              Plus {nestedGroups} nested condition group{nestedGroups > 1 ? "s" : ""} (kept as is; edit through the API).
            </p>
          )}
          {err("conditions") && <p className="text-[11px] text-destructive">{err("conditions")}</p>}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRules((rules) => [...rules, { field: subjects.includes("lead") ? "lead.score" : "event.to", operator: "gte", value: "" }])}
        >
          <Plus className="w-3.5 h-3.5" /> Add condition
        </Button>
      </Card>

      <Card className="space-y-4">
        <SectionHeading icon={ListOrdered} step={3} title="Then do this" hint="Actions run in order. A failed action stops the run." />
        {err("actions") && <p className="text-[11px] text-destructive">{err("actions")}</p>}
        <div className="space-y-3">
          {draft.actions.map((action, i) => {
            const typeError = err(`actions.${i}.type`);
            return (
              <div key={i} className={cn("rounded-lg border bg-background p-4 space-y-3", typeError ? "border-destructive/50" : "border-border")}>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <select
                    aria-label={`Action ${i + 1} type`}
                    className={cn(selectClassName, "h-9")}
                    value={action.type}
                    onChange={(e) =>
                      setActions((list) =>
                        list.map((a, j) => (j === i ? { type: e.target.value as WorkflowActionType, params: defaultParams(e.target.value as WorkflowActionType) } : a))
                      )
                    }
                  >
                    {ACTIONS.map((a) => (
                      <option key={a.type} value={a.type}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center">
                    <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => setActions((list) => swap(list, i, i - 1))}>
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Move down"
                      disabled={i === draft.actions.length - 1}
                      onClick={() => setActions((list) => swap(list, i, i + 1))}
                    >
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove action" onClick={() => setActions((list) => list.filter((_, j) => j !== i))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{actionMeta(action.type)?.description}</p>
                {typeError && <p className="text-[11px] text-destructive">{typeError}</p>}
                {renderActionFields(action, i)}
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.actions.length >= 20}
          onClick={() => setActions((list) => [...list, { type: "notify", params: defaultParams("notify") }])}
        >
          <Plus className="w-3.5 h-3.5" /> Add action
        </Button>
      </Card>

      {submitted && Object.keys(clientErrors).length > 0 && (
        <p className="text-sm text-destructive" role="alert">
          Fix the highlighted fields before saving.
        </p>
      )}
    </form>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
