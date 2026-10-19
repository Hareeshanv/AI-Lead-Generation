"use client";

import React from "react";
import { Input } from "@/components/ui/Input";
import { Field, selectClassName } from "@/components/settings/shared";
import type { WorkflowAction, WorkflowActionType } from "@/types";
import { DEAL_STAGES, LEAD_STATUSES } from "../catalog";
import { OptionSelect, SuggestInput, textareaClassName, type ErrorLookup, type SelectOption } from "./fields";

export interface ActionFieldOptions {
  members: SelectOption[];
  membersLoading: boolean;
  campaigns: SelectOption[];
  campaignsLoading: boolean;
}

/** Parameters of one action; `index` scopes element ids and error paths. */
export function ActionFields({
  action,
  index: i,
  setParam,
  err,
  options,
}: {
  action: WorkflowAction;
  index: number;
  setParam: (index: number, key: string, value: unknown) => void;
  err: ErrorLookup;
  options: ActionFieldOptions;
}) {
  const p = action.params || {};
  const id = (k: string) => `wf-action-${i}-${k}`;
  const e = (k: string) => err(`actions.${i}.params.${k}`);
  const memberSelect = (key: string, value: string | undefined) => (
    <OptionSelect
      id={id(key)}
      value={value}
      onChange={(v) => setParam(i, key, v)}
      options={options.members}
      loading={options.membersLoading}
      placeholder="Pick a teammate"
    />
  );

  switch (action.type as WorkflowActionType) {
    case "assign_owner":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id={id("ownerId")} label="Owner" error={e("ownerId")}>
            {memberSelect("ownerId", p.ownerId)}
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
              {memberSelect("assigneeId", p.assigneeId)}
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
        <Field id={id("campaignId")} label="Campaign" error={e("campaignId")} hint="Consent, do-not-contact and unsubscribe rules still apply.">
          <OptionSelect
            id={id("campaignId")}
            value={p.campaignId}
            onChange={(v) => setParam(i, "campaignId", v)}
            options={options.campaigns}
            loading={options.campaignsLoading}
            placeholder="Pick a campaign"
          />
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
                {memberSelect("userId", p.userId)}
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
}
