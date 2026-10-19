"use client";

import React from "react";
import { Input } from "@/components/ui/Input";
import { Field, selectClassName } from "@/components/settings/shared";
import type { WorkflowTrigger } from "@/types";
import { DEAL_STAGES, LEAD_STATUSES } from "../catalog";
import { SuggestInput, type ErrorLookup, type SelectOption } from "./fields";

/** Extra settings for the selected trigger type. */
export function TriggerFields({
  trigger: t,
  setTrigger,
  err,
  campaignOptions,
}: {
  trigger: WorkflowTrigger;
  setTrigger: (patch: Partial<WorkflowTrigger>) => void;
  err: ErrorLookup;
  campaignOptions: SelectOption[];
}) {
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
    default:
      return null;
  }
}
