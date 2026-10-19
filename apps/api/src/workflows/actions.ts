import { dbClient, dbError, orgsDb, tasksDb } from "@ai-lead-gen/database";
import { events } from "../events";
import { addLeadsToCampaign, type AddLeadsResult } from "../campaigns/service";
import { getProviderCredentials } from "../integrations/credentials";
import { postOutboundWebhook } from "../integrations/providers";
import { sendSlackNotification } from "../integrations/outbound";
import { assertSafeUrl } from "../integrations/safeHttp";
import { notify } from "../notifications/service";
import { renderTemplate, type WorkflowContext } from "./conditions";
import { delayMs, type ActionOf, type WorkflowAction } from "./schema";

/**
 * Workflow action implementations. Leads, deals and notifications are owned by other modules, so
 * the writes here are deliberately minimal direct queries.
 */

export interface ActionEnv {
  orgId: string;
  dryRun: boolean;
  workflow: { id: string; name: string };
  runId: string;
  ctx: WorkflowContext;
}

export interface ActionResult {
  status: "succeeded" | "skipped";
  output: Record<string, unknown>;
}

/** An expected failure with a user-facing message (recorded on the step, not retried). */
export class ActionError extends Error {}

const LEAD_CONTEXT_EXCLUDE = new Set(["embedding"]);

function cleanRow(row: Record<string, any> | null): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) if (!LEAD_CONTEXT_EXCLUDE.has(k)) out[k] = v;
  return out;
}

export async function loadLead(orgId: string, leadId: string | null | undefined): Promise<Record<string, any> | null> {
  if (!leadId) return null;
  const { data, error } = await dbClient.from("leads").select("*").eq("org_id", orgId).eq("id", leadId).maybeSingle();
  if (error) throw dbError("load lead for workflow", error);
  return cleanRow(data);
}

export async function loadDeal(orgId: string, dealId: string | null | undefined): Promise<Record<string, any> | null> {
  if (!dealId) return null;
  const { data, error } = await dbClient.from("deals").select("*").eq("org_id", orgId).eq("id", dealId).maybeSingle();
  if (error) throw dbError("load deal for workflow", error);
  return data;
}

/** Leads for schedule triggers with scope "leads" (most recently updated first). */
export async function loadRecentLeads(orgId: string, limit: number): Promise<Record<string, any>[]> {
  const { data, error } = await dbClient
    .from("leads")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw dbError("load leads for workflow", error);
  return (data || []).map((row) => cleanRow(row)!);
}

function requireLead(env: ActionEnv): Record<string, any> {
  if (!env.ctx.lead) throw new ActionError("This run has no lead to act on.");
  return env.ctx.lead;
}

function requireDeal(env: ActionEnv): Record<string, any> {
  if (!env.ctx.deal) throw new ActionError("This run has no deal to act on.");
  return env.ctx.deal;
}

const render = (env: ActionEnv, text: string | undefined) => (text ? renderTemplate(text, env.ctx) : text);

async function requireMember(orgId: string, userId: string, label: string) {
  if (!(await orgsDb.getMembership(orgId, userId))) throw new ActionError(`The selected ${label} is no longer a member of this workspace.`);
}

// ---- Actions ---------------------------------------------------------------------------------

async function assignOwner(env: ActionEnv, action: ActionOf<"assign_owner">): Promise<ActionResult> {
  const { ownerId, target } = action.params;
  const record = target === "deal" ? requireDeal(env) : requireLead(env);
  await requireMember(env.orgId, ownerId, "owner");
  if (record.owner_id === ownerId) return { status: "skipped", output: { reason: `The ${target} already has this owner.` } };
  if (env.dryRun) return { status: "succeeded", output: { preview: `Would assign the ${target} to user ${ownerId}.` } };

  const table = target === "deal" ? "deals" : "leads";
  const { data, error } = await dbClient
    .from(table)
    .update({ owner_id: ownerId })
    .eq("org_id", env.orgId)
    .eq("id", record.id)
    .select()
    .maybeSingle();
  if (error) throw dbError(`assign ${target} owner`, error);
  if (!data) throw new ActionError(`The ${target} no longer exists.`);

  if (target === "deal") {
    env.ctx.deal = data;
    events.emit("deal.assigned", { orgId: env.orgId, actorId: null, dealId: record.id, ownerId });
  } else {
    env.ctx.lead = cleanRow(data);
    events.emit("lead.assigned", {
      orgId: env.orgId,
      actorId: null,
      leadId: record.id,
      ownerId,
      previousOwnerId: record.owner_id ?? null,
    });
  }
  return { status: "succeeded", output: { ownerId, previousOwnerId: record.owner_id ?? null } };
}

async function setStatus(env: ActionEnv, action: ActionOf<"set_status">): Promise<ActionResult> {
  const lead = requireLead(env);
  const to = action.params.status;
  const from = (lead.status as string | null) ?? null;
  if (from === to) return { status: "skipped", output: { reason: `The lead is already ${to}.` } };
  if (env.dryRun) return { status: "succeeded", output: { preview: `Would change lead status from ${from ?? "none"} to ${to}.` } };

  const { data, error } = await dbClient
    .from("leads")
    .update({ status: to })
    .eq("org_id", env.orgId)
    .eq("id", lead.id)
    .select()
    .maybeSingle();
  if (error) throw dbError("set lead status", error);
  if (!data) throw new ActionError("The lead no longer exists.");
  env.ctx.lead = cleanRow(data);
  events.emit("lead.status_changed", { orgId: env.orgId, actorId: null, leadId: lead.id, from, to });
  return { status: "succeeded", output: { from, to } };
}

async function setStage(env: ActionEnv, action: ActionOf<"set_stage">): Promise<ActionResult> {
  const deal = requireDeal(env);
  const to = action.params.stage;
  const from = (deal.stage as string | null) ?? null;
  if (from === to) return { status: "skipped", output: { reason: `The deal is already in ${to}.` } };
  if (env.dryRun) return { status: "succeeded", output: { preview: `Would move the deal from ${from ?? "none"} to ${to}.` } };

  const closed = /^closed/i.test(to);
  const { data, error } = await dbClient
    .from("deals")
    .update({ stage: to, closed_at: closed ? new Date().toISOString() : null })
    .eq("org_id", env.orgId)
    .eq("id", deal.id)
    .select()
    .maybeSingle();
  if (error) throw dbError("set deal stage", error);
  if (!data) throw new ActionError("The deal no longer exists.");
  env.ctx.deal = data;
  events.emit("deal.stage_changed", {
    orgId: env.orgId,
    actorId: null,
    dealId: deal.id,
    leadId: deal.lead_id ?? null,
    from,
    to,
  });
  return { status: "succeeded", output: { from, to } };
}

async function addTag(env: ActionEnv, action: ActionOf<"add_tag">): Promise<ActionResult> {
  const lead = requireLead(env);
  const tag = render(env, action.params.tag)!.trim();
  if (!tag) throw new ActionError("The tag is empty after filling in placeholders.");
  const current: string[] = Array.isArray(lead.tags) ? lead.tags : [];
  if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) {
    return { status: "skipped", output: { reason: `The lead already has the tag "${tag}".` } };
  }
  const next = [...current, tag];
  if (env.dryRun) return { status: "succeeded", output: { preview: `Would add the tag "${tag}".` } };

  const { data, error } = await dbClient
    .from("leads")
    .update({ tags: next })
    .eq("org_id", env.orgId)
    .eq("id", lead.id)
    .select()
    .maybeSingle();
  if (error) throw dbError("add lead tag", error);
  if (!data) throw new ActionError("The lead no longer exists.");
  env.ctx.lead = cleanRow(data);
  events.emit("lead.updated", {
    orgId: env.orgId,
    actorId: null,
    leadId: lead.id,
    changes: { tags: { from: current, to: next } },
  });
  return { status: "succeeded", output: { tag, tags: next } };
}

async function createTask(env: ActionEnv, action: ActionOf<"create_task">): Promise<ActionResult> {
  const p = action.params;
  const title = render(env, p.title)!.trim() || "Follow up";
  const description = render(env, p.description) ?? null;
  const dueAt = p.dueInDays !== undefined ? new Date(Date.now() + p.dueInDays * 86_400_000).toISOString() : null;
  let assigneeId: string | null = null;
  if (p.assignTo === "owner") assigneeId = env.ctx.lead?.owner_id ?? env.ctx.deal?.owner_id ?? null;
  if (p.assignTo === "user" && p.assigneeId) {
    await requireMember(env.orgId, p.assigneeId, "assignee");
    assigneeId = p.assigneeId;
  }
  const leadId = env.ctx.lead?.id ?? null;
  const dealId = env.ctx.deal?.id ?? null;
  if (env.dryRun) {
    return {
      status: "succeeded",
      output: { preview: `Would create the task "${title}".`, title, dueAt, assigneeId, leadId, dealId },
    };
  }

  const task = await tasksDb.create(env.orgId, {
    title,
    description,
    leadId,
    dealId,
    dueAt,
    assigneeId,
    priority: p.priority,
    createdBy: null,
  });
  events.emit("task.created", { orgId: env.orgId, actorId: null, taskId: task.id, leadId, dealId, assigneeId });
  return { status: "succeeded", output: { taskId: task.id, title, dueAt, assigneeId } };
}

async function createDeal(env: ActionEnv, action: ActionOf<"create_deal">): Promise<ActionResult> {
  const lead = requireLead(env);
  const { data: open, error: openError } = await dbClient
    .from("deals")
    .select("*")
    .eq("org_id", env.orgId)
    .eq("lead_id", lead.id)
    .not("stage", "ilike", "closed%")
    .limit(1);
  if (openError) throw dbError("check open deals", openError);
  if (open && open.length > 0) {
    env.ctx.deal = open[0];
    return { status: "skipped", output: { reason: "The lead already has an open deal.", dealId: open[0].id } };
  }

  const p = action.params;
  const company = (lead.company as string) || (lead.name as string) || "Unknown company";
  const title = render(env, p.title)?.trim() || `${company} deal`;
  const row = {
    org_id: env.orgId,
    title,
    company,
    contact: lead.name ?? null,
    value: p.value ?? 0,
    stage: p.stage || "New",
    probability: p.probability ?? 20,
    lead_id: lead.id,
    owner_id: lead.owner_id ?? null,
  };
  if (env.dryRun) {
    env.ctx.deal = { id: null, ...row };
    return { status: "succeeded", output: { preview: `Would create the deal "${title}" in ${row.stage}.`, ...row } };
  }

  const { data, error } = await dbClient.from("deals").insert(row).select().single();
  if (error) throw dbError("create deal", error);
  env.ctx.deal = data;
  events.emit("deal.created", { orgId: env.orgId, actorId: null, dealId: data.id, leadId: lead.id });
  return { status: "succeeded", output: { dealId: data.id, title, stage: row.stage, value: row.value } };
}

async function addToCampaign(env: ActionEnv, action: ActionOf<"add_to_campaign">): Promise<ActionResult> {
  const lead = requireLead(env);
  const { data: campaign, error } = await dbClient
    .from("campaigns")
    .select("id, name, status, channel")
    .eq("org_id", env.orgId)
    .eq("id", action.params.campaignId)
    .maybeSingle();
  if (error) throw dbError("load campaign", error);
  if (!campaign) throw new ActionError("The selected campaign no longer exists.");
  if (campaign.status === "completed") throw new ActionError(`The campaign "${campaign.name}" has already completed.`);

  const { data: existing, error: existingError } = await dbClient
    .from("campaign_recipients")
    .select("id")
    .eq("org_id", env.orgId)
    .eq("campaign_id", campaign.id)
    .eq("lead_id", lead.id)
    .maybeSingle();
  if (existingError) throw dbError("check campaign recipient", existingError);
  if (existing) return { status: "skipped", output: { reason: `The lead is already in "${campaign.name}".` } };

  if (env.dryRun) {
    const channel = (campaign.channel as string) || "email";
    const consent: string[] = Array.isArray(lead.consent_channel) ? lead.consent_channel : [];
    const warning = lead.do_not_contact
      ? "The lead is marked do-not-contact, so the campaign will exclude it."
      : !consent.includes(channel)
        ? `The lead hasn't consented to ${channel} messages, so the campaign may exclude it.`
        : null;
    return {
      status: "succeeded",
      output: { preview: `Would add the lead to "${campaign.name}" (${campaign.status}).`, ...(warning ? { warning } : {}) },
    };
  }

  // The Campaigns module applies consent / do-not-contact / unsubscribe rules and schedules sends.
  let result: AddLeadsResult;
  try {
    result = await addLeadsToCampaign(env.orgId, campaign.id, [lead.id]);
  } catch (err: any) {
    throw new ActionError(err?.message || "Adding the lead to the campaign failed.");
  }
  if (result.added === 0) {
    const reasons = Object.entries(result.excluded || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([reason]) => reason.replace(/_/g, " "));
    return {
      status: "skipped",
      output: {
        reason: result.alreadyInCampaign
          ? `The lead is already in "${campaign.name}".`
          : `The campaign excluded the lead${reasons.length ? ` (${reasons.join(", ")})` : ""}.`,
        result,
      },
    };
  }
  return { status: "succeeded", output: { campaignId: campaign.id, queued: result.queued, result } };
}

async function notifyAction(env: ActionEnv, action: ActionOf<"notify">): Promise<ActionResult> {
  const p = action.params;
  const title = render(env, p.title)!.trim() || env.workflow.name;
  const body = render(env, p.body) ?? null;

  let audience: { userIds: string[] } | "admins" | "managers";
  if (p.recipients === "owner") {
    const owner = env.ctx.lead?.owner_id ?? env.ctx.deal?.owner_id ?? null;
    if (!owner) return { status: "skipped", output: { reason: "The record has no owner to notify." } };
    audience = { userIds: [owner] };
  } else if (p.recipients === "user") {
    await requireMember(env.orgId, p.userId!, "user");
    audience = { userIds: [p.userId!] };
  } else if (p.recipients === "all") {
    audience = { userIds: (await orgsDb.listMembers(env.orgId)).map((m) => m.user_id) };
  } else {
    audience = p.recipients;
  }
  if (env.dryRun) {
    const who = typeof audience === "string" ? `all ${audience}` : `${audience.userIds.length} user(s)`;
    return { status: "succeeded", output: { preview: `Would notify ${who}: "${title}".` } };
  }

  const lead = env.ctx.lead;
  const deal = env.ctx.deal;
  const notified = await notify(env.orgId, null, {
    audience,
    type: "workflow",
    title,
    body,
    link: lead?.id ? `/leads/${lead.id}` : deal?.id ? `/crm?deal=${deal.id}` : "/workflows",
    entityType: lead?.id ? "lead" : deal?.id ? "deal" : "workflow",
    entityId: lead?.id ?? deal?.id ?? env.workflow.id,
    includeActor: true,
  });
  if (notified === 0) return { status: "skipped", output: { reason: "Nobody to notify." } };
  return { status: "succeeded", output: { notified, title } };
}

async function slack(env: ActionEnv, action: ActionOf<"slack">): Promise<ActionResult> {
  const text = render(env, action.params.message)!.trim();
  if (!text) throw new ActionError("The Slack message is empty after filling in placeholders.");
  if (env.dryRun) {
    const creds = await getProviderCredentials(env.orgId, "slack");
    if (!creds) throw new ActionError("Slack is not connected. Add an incoming webhook on the Integrations page.");
    return { status: "succeeded", output: { preview: "Would post to Slack.", text } };
  }
  try {
    await sendSlackNotification(env.orgId, text);
  } catch (err: any) {
    throw new ActionError(err?.message || "Slack post failed.");
  }
  return { status: "succeeded", output: { text } };
}

async function webhook(env: ActionEnv, action: ActionOf<"webhook">): Promise<ActionResult> {
  const creds = await getProviderCredentials(env.orgId, "webhook");
  const url = action.params.url || creds?.url;
  if (!url) throw new ActionError("No webhook URL: set one on the action or connect an outbound webhook in Integrations.");
  let host: string;
  try {
    host = (await assertSafeUrl(url)).host;
  } catch (err: any) {
    throw new ActionError(`Webhook URL rejected: ${err?.message || "not allowed"}`);
  }

  const data: Record<string, unknown> = {
    workflow: env.workflow,
    runId: env.runId,
    trigger: env.ctx.trigger,
  };
  if (action.params.includeContext) {
    data.lead = env.ctx.lead;
    data.deal = env.ctx.deal;
    data.event = env.ctx.event;
  }
  if (env.dryRun) return { status: "succeeded", output: { preview: `Would POST to ${host}.`, url } };

  try {
    const result = await postOutboundWebhook(url, creds?.signingSecret, {
      event: "workflow.action",
      sentAt: new Date().toISOString(),
      orgId: env.orgId,
      data,
    });
    return { status: "succeeded", output: { url, status: result.status } };
  } catch (err: any) {
    throw new ActionError(err?.message || "Webhook request failed.");
  }
}

/** Runs one action. Delay is handled by the engine and only previewed here. */
export async function executeAction(env: ActionEnv, action: WorkflowAction): Promise<ActionResult> {
  switch (action.type) {
    case "assign_owner":
      return assignOwner(env, action);
    case "set_status":
      return setStatus(env, action);
    case "set_stage":
      return setStage(env, action);
    case "add_tag":
      return addTag(env, action);
    case "create_task":
      return createTask(env, action);
    case "create_deal":
      return createDeal(env, action);
    case "add_to_campaign":
      return addToCampaign(env, action);
    case "notify":
      return notifyAction(env, action);
    case "slack":
      return slack(env, action);
    case "webhook":
      return webhook(env, action);
    case "delay":
      return {
        status: "succeeded",
        output: {
          preview: `Would wait ${action.params.amount} ${action.params.unit}.`,
          resumeAt: new Date(Date.now() + delayMs(action.params)).toISOString(),
        },
      };
  }
}
