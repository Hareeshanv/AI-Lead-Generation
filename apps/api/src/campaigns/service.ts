import {
  activitiesDb,
  campaignsDb,
  jobsDb,
  settingsDb,
  type CampaignChannel,
  type CampaignLeadRow,
  type CampaignRecipientRow,
  type CampaignRow,
  type MessageRow,
  type NewJobRow,
  type RecipientInsert,
  type RecipientStatus,
} from "@ai-lead-gen/database";
import { MessagingError, sendResendEmail, sendWhatsAppTemplate } from "../../../../services/messaging";
import { getProviderCredentials } from "../integrations/credentials";
import { HttpError } from "../http/errors";
import { events } from "../events";
import { enqueueJob, PermanentJobError, registerJobHandler, type JobContext, type JobPayloadMap } from "../jobs/runner";
import {
  candidateAddresses,
  EXCLUSION_LABELS,
  readAudienceFilter,
  resolveAudience,
  toLeadCriteria,
  type AudienceFilter,
  type ExclusionReason,
} from "./audience";
import {
  buildEmailBodies,
  buildWhatsAppTemplate,
  renderTemplate,
  templateVariables,
  UNSUBSCRIBE_SECRET_MISSING,
  unsubscribeConfigured,
  unsubscribeUrl,
  whatsappTemplateSchema,
} from "./content";
import { nextMessageState, type MessageEvent } from "./messageState";
import { isWithinSendWindow, nextSendWindowStart, planSendTimes, readSendWindow, throttleDelayMs } from "./schedule";
import { computeCampaignStats, statsColumns, type CampaignStats } from "./stats";
import { stepRowToBody, validateSteps } from "./validation";

const SEND_JOB = "campaign.send_step" as const;
const AUDIENCE_LIMIT = 20_000;
const RESCHEDULE_JITTER_MS = 5 * 60 * 1000;
/** Longer than a WhatsApp send request can take (20s timeout), so an older claim belongs to a dead attempt. */
const SEND_CLAIM_STALE_MS = 2 * 60 * 1000;

export function defaultCountryCode(): string {
  return (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91").replace(/\D/g, "") || "91";
}

export function jobKeyPrefix(campaignId: string): string {
  return `campaign:${campaignId}:`;
}

function jobKey(campaignId: string, recipientId: string, step: number, attempt: string | number = 0): string {
  return `${jobKeyPrefix(campaignId)}${recipientId}:${step}:${attempt}`;
}

/** Cancels every queued send job of a campaign (running ones re-check the status and stop). */
export function cancelCampaignJobs(orgId: string, campaignId: string): Promise<number> {
  return jobsDb.cancel({ orgId, type: SEND_JOB, dedupeKeyPrefix: jobKeyPrefix(campaignId) });
}

function sendJob(campaignId: string, recipient: Pick<CampaignRecipientRow, "id">, step: number, runAt: Date, suffix: string | number = 0): NewJobRow {
  const payload: JobPayloadMap[typeof SEND_JOB] = { campaignId, recipientId: recipient.id, stepPosition: step };
  return { type: SEND_JOB, payload, runAt: runAt.toISOString(), dedupeKey: jobKey(campaignId, recipient.id, step, suffix) };
}

async function orgTimeZone(orgId: string): Promise<string> {
  try {
    return (await settingsDb.get(orgId)).timezone || "UTC";
  } catch {
    return "UTC";
  }
}

// ---- Channel configuration ----

export interface ChannelConfig {
  channel: CampaignChannel;
  provider: "resend" | "whatsapp";
  /** Resend: "Name <email>"; WhatsApp: phone number id. */
  from: string;
  replyTo: string | null;
  credentials: Record<string, string>;
}

function formatFrom(name: string | undefined, email: string): string {
  const clean = (name || "").replace(/["<>\r\n]/g, "").trim();
  return clean ? `${clean} <${email}>` : email;
}

/** Resolved sender for a campaign, or a user-facing reason it cannot send. */
export async function getChannelConfig(
  orgId: string,
  campaign: Pick<CampaignRow, "channel" | "from_identity">
): Promise<{ config: ChannelConfig } | { error: string }> {
  const identity = (campaign.from_identity || {}) as Record<string, string | undefined>;
  if (campaign.channel === "email") {
    if (!unsubscribeConfigured()) return { error: UNSUBSCRIBE_SECRET_MISSING };
    const creds = await getProviderCredentials(orgId, "resend");
    if (!creds?.apiKey) {
      return { error: "Email is not configured. Add a Resend API key and a verified from address under Integrations → Resend." };
    }
    const email = identity.email || creds.fromEmail;
    if (!email) return { error: "Set a from email for this campaign or a default from address in the Resend integration." };
    return {
      config: {
        channel: "email",
        provider: "resend",
        from: formatFrom(identity.name || creds.fromName, email),
        replyTo: identity.replyTo || null,
        credentials: creds,
      },
    };
  }
  const creds = await getProviderCredentials(orgId, "whatsapp");
  const phoneNumberId = identity.phoneNumberId || creds?.phoneNumberId;
  if (!creds?.accessToken || !phoneNumberId) {
    return { error: "WhatsApp is not configured. Add the phone number ID and access token under Integrations → WhatsApp Cloud API." };
  }
  return { config: { channel: "whatsapp", provider: "whatsapp", from: phoneNumberId, replyTo: null, credentials: creds } };
}

async function requireChannelConfig(orgId: string, campaign: CampaignRow): Promise<ChannelConfig> {
  const result = await getChannelConfig(orgId, campaign);
  if ("error" in result) throw HttpError.notConfigured(result.error);
  return result.config;
}

// ---- Stats ----

export async function computeStats(orgId: string, campaignId: string): Promise<CampaignStats> {
  const [recipients, messages] = await Promise.all([
    campaignsDb.recipientCounts(orgId, campaignId),
    campaignsDb.messageCounts(orgId, campaignId),
  ]);
  return computeCampaignStats(recipients, messages);
}

/** Recomputes stats and caches them on the campaign row. */
export async function refreshCampaignStats(orgId: string, campaignId: string): Promise<CampaignStats> {
  const stats = await computeStats(orgId, campaignId);
  await campaignsDb.update(orgId, campaignId, statsColumns(stats));
  return stats;
}

async function maybeCompleteCampaign(orgId: string, campaignId: string): Promise<void> {
  const counts = await campaignsDb.recipientCounts(orgId, campaignId);
  if (counts.byStatus.active + counts.byStatus.pending > 0) return;
  const done = await campaignsDb.transition(orgId, campaignId, ["active", "scheduled"], {
    status: "completed",
    completed_at: new Date().toISOString(),
  });
  if (done) events.emit("campaign.completed", { orgId, actorId: null, campaignId });
}

// ---- Audience ----

export interface AudiencePreview {
  matched: number;
  manual: number;
  eligible: number;
  excluded: Record<ExclusionReason, number>;
  capped: boolean;
  sample: { id: string; name: string | null; company: string | null; address: string }[];
}

async function audienceLeads(
  orgId: string,
  filter: AudienceFilter,
  manualLeadIds: string[]
): Promise<{ leads: CampaignLeadRow[]; matched: number; capped: boolean }> {
  const matchedLeads = filter.type === "filter" ? await campaignsDb.findLeads(orgId, toLeadCriteria(filter), AUDIENCE_LIMIT) : [];
  const known = new Set(matchedLeads.map((l) => l.id));
  const missing = manualLeadIds.filter((id) => !known.has(id));
  const manualLeads = missing.length ? await campaignsDb.getLeadsByIds(orgId, missing) : [];
  return { leads: [...matchedLeads, ...manualLeads], matched: matchedLeads.length, capped: matchedLeads.length >= AUDIENCE_LIMIT };
}

async function unsubscribedFor(orgId: string, channel: CampaignChannel, leads: CampaignLeadRow[]) {
  return campaignsDb.unsubscribedAmong(orgId, channel, candidateAddresses(leads, channel, defaultCountryCode()));
}

export async function previewAudience(
  orgId: string,
  channel: CampaignChannel,
  filter: AudienceFilter,
  campaignId?: string | null
): Promise<AudiencePreview> {
  const manualIds = campaignId ? [...(await campaignsDb.existingRecipientLeadIds(orgId, campaignId))] : [];
  const { leads, matched, capped } = await audienceLeads(orgId, filter, manualIds);
  const resolved = resolveAudience(leads, channel, await unsubscribedFor(orgId, channel, leads), defaultCountryCode());
  return {
    matched,
    manual: manualIds.length,
    eligible: resolved.eligible.length,
    excluded: resolved.excludedCounts,
    capped,
    sample: resolved.eligible.slice(0, 10).map(({ lead, address }) => ({
      id: lead.id,
      name: lead.name,
      company: lead.company,
      address,
    })),
  };
}

function exclusionSummary(counts: Record<ExclusionReason, number>): string {
  const parts = (Object.keys(counts) as ExclusionReason[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${EXCLUSION_LABELS[k].toLowerCase()}`);
  return parts.length ? ` Excluded: ${parts.join(", ")}.` : "";
}

// ---- Lifecycle ----

export interface LaunchResult {
  campaign: CampaignRow;
  recipients: number;
  skipped: number;
  excluded: Record<ExclusionReason, number>;
  firstSendAt: string | null;
}

export async function launchCampaign(orgId: string, actorId: string, campaignId: string): Promise<LaunchResult> {
  const campaign = await campaignsDb.get(orgId, campaignId);
  if (!campaign) throw HttpError.notFound("Campaign");
  if (campaign.status !== "draft") {
    throw HttpError.conflict(
      campaign.status === "paused" ? "This campaign is paused. Resume it instead." : `This campaign is already ${campaign.status}.`
    );
  }

  const steps = await campaignsDb.listSteps(orgId, campaignId);
  if (steps.length === 0) throw HttpError.badRequest("Add at least one step before launching.");
  const stepErrors = validateSteps(campaign.channel, steps.map(stepRowToBody));
  if (Object.keys(stepErrors).length > 0) throw HttpError.badRequest("Some steps are incomplete.", stepErrors);
  await requireChannelConfig(orgId, campaign);

  const filter = readAudienceFilter(campaign.audience_filter);
  const manual = await campaignsDb.listRecipientsByStatus(orgId, campaignId, ["pending"]);
  const { leads } = await audienceLeads(orgId, filter, manual.map((r) => r.lead_id));
  const unsubscribed = await unsubscribedFor(orgId, campaign.channel, leads);
  const resolved = resolveAudience(leads, campaign.channel, unsubscribed, defaultCountryCode());
  if (resolved.eligible.length === 0) {
    throw HttpError.badRequest(`No eligible recipients for this campaign.${exclusionSummary(resolved.excludedCounts)}`);
  }

  const now = new Date();
  const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at) : null;
  const startAt = scheduledAt && scheduledAt > now ? scheduledAt : now;
  const launched = await campaignsDb.transition(orgId, campaignId, ["draft"], {
    status: startAt > now ? "scheduled" : "active",
    launched_at: now.toISOString(),
    completed_at: null,
  });
  if (!launched) throw HttpError.conflict("This campaign was launched by someone else just now.");

  try {
    const tz = await orgTimeZone(orgId);
    const times = planSendTimes(resolved.eligible.length, startAt, campaign.throttle_per_hour, readSendWindow(campaign.send_window), tz);
    const rows: RecipientInsert[] = [
      ...resolved.eligible.map(({ lead }, i) => ({
        lead_id: lead.id,
        status: "active" as RecipientStatus,
        current_step: 0,
        next_run_at: times[i].toISOString(),
        last_error: null,
      })),
      ...resolved.excluded.map(({ lead, reason }) => ({
        lead_id: lead.id,
        status: (reason === "unsubscribed" ? "unsubscribed" : "skipped") as RecipientStatus,
        current_step: 0,
        next_run_at: null,
        last_error: EXCLUSION_LABELS[reason],
      })),
    ];
    const written = await campaignsDb.insertRecipients(orgId, campaignId, rows, { overwrite: true });
    const jobs = written
      .filter((r) => r.status === "active" && r.next_run_at)
      .map((r) => sendJob(campaignId, r, 0, new Date(r.next_run_at!)));
    await campaignsDb.enqueueJobs(orgId, jobs);
    await refreshCampaignStats(orgId, campaignId);

    events.emit("campaign.launched", { orgId, actorId, campaignId, recipients: jobs.length });
    return {
      campaign: (await campaignsDb.get(orgId, campaignId)) ?? launched,
      recipients: jobs.length,
      skipped: resolved.excluded.length,
      excluded: resolved.excludedCounts,
      firstSendAt: times[0]?.toISOString() ?? null,
    };
  } catch (err) {
    await cancelCampaignJobs(orgId, campaignId);
    await campaignsDb.transition(orgId, campaignId, ["active", "scheduled"], { status: "draft", launched_at: null });
    throw err;
  }
}

export async function pauseCampaign(orgId: string, actorId: string, campaignId: string): Promise<CampaignRow> {
  const campaign = await campaignsDb.get(orgId, campaignId);
  if (!campaign) throw HttpError.notFound("Campaign");
  const paused = await campaignsDb.transition(orgId, campaignId, ["active", "scheduled"], { status: "paused" });
  if (!paused) throw HttpError.conflict(`Only active or scheduled campaigns can be paused (this one is ${campaign.status}).`);
  await cancelCampaignJobs(orgId, campaignId);
  events.emit("campaign.paused", { orgId, actorId, campaignId });
  return paused;
}

/** Queues the current step for active recipients, keeping later run times and the hourly throttle. */
async function enqueueActiveRecipients(orgId: string, campaign: CampaignRow, startAt: Date, recipients: CampaignRecipientRow[]) {
  const tz = await orgTimeZone(orgId);
  const times = planSendTimes(recipients.length, startAt, campaign.throttle_per_hour, readSendWindow(campaign.send_window), tz);
  const suffix = `r${Date.now()}`;
  const jobs: NewJobRow[] = [];
  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const planned = recipient.next_run_at && new Date(recipient.next_run_at) > times[i] ? new Date(recipient.next_run_at) : times[i];
    jobs.push(sendJob(campaign.id, recipient, recipient.current_step, planned, suffix));
    if (recipient.next_run_at !== planned.toISOString()) {
      await campaignsDb.updateRecipient(orgId, recipient.id, { next_run_at: planned.toISOString() });
    }
  }
  await campaignsDb.enqueueJobs(orgId, jobs);
  return jobs.length;
}

export async function resumeCampaign(orgId: string, actorId: string, campaignId: string): Promise<CampaignRow> {
  const campaign = await campaignsDb.get(orgId, campaignId);
  if (!campaign) throw HttpError.notFound("Campaign");
  if (campaign.status !== "paused") throw HttpError.conflict(`Only paused campaigns can be resumed (this one is ${campaign.status}).`);
  const steps = await campaignsDb.listSteps(orgId, campaignId);
  if (steps.length === 0) throw HttpError.badRequest("Add at least one step before resuming.");
  const stepErrors = validateSteps(campaign.channel, steps.map(stepRowToBody));
  if (Object.keys(stepErrors).length > 0) throw HttpError.badRequest("Some steps are incomplete.", stepErrors);
  await requireChannelConfig(orgId, campaign);

  const now = new Date();
  const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at) : null;
  const startAt = scheduledAt && scheduledAt > now ? scheduledAt : now;
  const resumed = await campaignsDb.transition(orgId, campaignId, ["paused"], {
    status: startAt > now ? "scheduled" : "active",
    launched_at: campaign.launched_at ?? now.toISOString(),
  });
  if (!resumed) throw HttpError.conflict("This campaign changed just now. Refresh and try again.");

  const active = await campaignsDb.listRecipientsByStatus(orgId, campaignId, ["active"]);
  await enqueueActiveRecipients(orgId, resumed, startAt, active);
  events.emit("campaign.resumed", { orgId, actorId, campaignId });
  if (active.length === 0) await maybeCompleteCampaign(orgId, campaignId);
  return (await campaignsDb.get(orgId, campaignId)) ?? resumed;
}

export async function deleteCampaign(orgId: string, campaignId: string): Promise<void> {
  await cancelCampaignJobs(orgId, campaignId);
  if (!(await campaignsDb.remove(orgId, campaignId))) throw HttpError.notFound("Campaign");
}

export interface AddLeadsResult {
  added: number;
  alreadyInCampaign: number;
  notFound: number;
  skipped: number;
  excluded: Record<ExclusionReason, number>;
  queued: number;
}

/** Adds leads to a campaign audience. Draft: pending until launch; running: queued right away. */
export async function addLeadsToCampaign(orgId: string, campaignId: string, leadIds: string[]): Promise<AddLeadsResult> {
  const campaign = await campaignsDb.get(orgId, campaignId);
  if (!campaign) throw HttpError.notFound("Campaign");
  if (campaign.status === "completed") throw HttpError.conflict("This campaign has completed. Create a new campaign for these leads.");

  const uniqueIds = [...new Set(leadIds)];
  const leads = await campaignsDb.getLeadsByIds(orgId, uniqueIds);
  const existing = await campaignsDb.existingRecipientLeadIds(orgId, campaignId);
  const fresh = leads.filter((l) => !existing.has(l.id));
  const resolved = resolveAudience(fresh, campaign.channel, await unsubscribedFor(orgId, campaign.channel, fresh), defaultCountryCode());

  const result: AddLeadsResult = {
    added: 0,
    alreadyInCampaign: leads.length - fresh.length,
    notFound: uniqueIds.length - leads.length,
    skipped: 0,
    excluded: resolved.excludedCounts,
    queued: 0,
  };
  if (fresh.length === 0) return result;

  if (campaign.status === "draft") {
    const written = await campaignsDb.insertRecipients(
      orgId,
      campaignId,
      fresh.map((l) => ({ lead_id: l.id, status: "pending" as RecipientStatus }))
    );
    result.added = written.length;
    return result;
  }

  const excludedRows: RecipientInsert[] = resolved.excluded.map(({ lead, reason }) => ({
    lead_id: lead.id,
    status: reason === "unsubscribed" ? "unsubscribed" : "skipped",
    last_error: EXCLUSION_LABELS[reason],
  }));
  const eligibleRows: RecipientInsert[] = resolved.eligible.map(({ lead }) => ({ lead_id: lead.id, status: "active", current_step: 0 }));
  const written = await campaignsDb.insertRecipients(orgId, campaignId, [...eligibleRows, ...excludedRows]);
  result.added = written.filter((r) => r.status === "active").length;
  result.skipped = written.length - result.added;

  if (campaign.status === "active" || campaign.status === "scheduled") {
    const now = new Date();
    const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at) : null;
    const startAt = scheduledAt && scheduledAt > now ? scheduledAt : now;
    result.queued = await enqueueActiveRecipients(orgId, campaign, startAt, written.filter((r) => r.status === "active"));
  }
  await refreshCampaignStats(orgId, campaignId);
  return result;
}

// ---- Sending (job handler) ----

async function reschedule(orgId: string, campaignId: string, recipient: CampaignRecipientRow, step: number, at: Date) {
  const runAt = new Date(at.getTime() + Math.floor(Math.random() * RESCHEDULE_JITTER_MS));
  await campaignsDb.updateRecipient(orgId, recipient.id, { next_run_at: runAt.toISOString() });
  await enqueueJob(
    SEND_JOB,
    { campaignId, recipientId: recipient.id, stepPosition: step },
    { orgId, runAt, dedupeKey: jobKey(campaignId, recipient.id, step, `t${runAt.getTime()}`) }
  );
}

async function endRecipient(orgId: string, campaignId: string, recipientId: string, status: RecipientStatus, lastError: string | null) {
  await campaignsDb.updateRecipient(orgId, recipientId, { status, next_run_at: null, last_error: lastError }, ["active", "pending"]);
  await refreshCampaignStats(orgId, campaignId);
  await maybeCompleteCampaign(orgId, campaignId);
}

async function deliver(
  config: ChannelConfig,
  campaign: CampaignRow,
  step: { subject: string | null; body: string | null; whatsapp_template: Record<string, any> | null },
  lead: CampaignLeadRow,
  message: MessageRow,
  to: string
): Promise<{ providerMessageId: string; subject: string | null; body: string | null }> {
  const vars = templateVariables(lead);
  if (config.channel === "email") {
    const subject = renderTemplate(step.subject || "", vars).trim();
    const text = renderTemplate(step.body || "", vars);
    if (!subject || !text.trim()) throw new MessagingError("The email step has an empty subject or body.", false);
    const url = unsubscribeUrl(message.id);
    const bodies = buildEmailBodies(text, url);
    const { id } = await sendResendEmail({
      apiKey: config.credentials.apiKey,
      from: config.from,
      to,
      subject,
      html: bodies.html,
      text: bodies.text,
      replyTo: config.replyTo,
      headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: { campaign_id: campaign.id, message_id: message.id },
      idempotencyKey: `campaign-message-${message.id}`,
    });
    return { providerMessageId: id, subject, body: text };
  }

  const parsed = whatsappTemplateSchema.safeParse(step.whatsapp_template);
  if (!parsed.success) throw new MessagingError("The WhatsApp step has no valid approved template.", false);
  const template = buildWhatsAppTemplate(parsed.data, vars);
  const { id } = await sendWhatsAppTemplate({
    phoneNumberId: config.from,
    accessToken: config.credentials.accessToken,
    to,
    template,
  });
  const params = (parsed.data.bodyParams || []).map((p) => renderTemplate(p, vars));
  return { providerMessageId: id, subject: null, body: `Template ${template.name} (${template.language})${params.length ? `: ${params.join(" | ")}` : ""}` };
}

export async function handleSendStep(payload: JobPayloadMap[typeof SEND_JOB], ctx: JobContext<typeof SEND_JOB>): Promise<void> {
  const orgId = ctx.orgId;
  if (!orgId) throw new PermanentJobError("Campaign send job has no org.");
  const { campaignId, recipientId, stepPosition } = payload;

  const campaign = await campaignsDb.get(orgId, campaignId);
  if (!campaign || !["active", "scheduled"].includes(campaign.status)) return;
  const recipient = await campaignsDb.getRecipient(orgId, recipientId);
  if (!recipient || recipient.campaign_id !== campaignId) return;
  if (recipient.status !== "active" || recipient.current_step !== stepPosition) return;

  const steps = await campaignsDb.listSteps(orgId, campaignId);
  const index = steps.findIndex((s) => s.position === stepPosition);
  if (index < 0) return endRecipient(orgId, campaignId, recipientId, "completed", null);
  const step = steps[index];

  const now = new Date();
  const tz = await orgTimeZone(orgId);
  const window = readSendWindow(campaign.send_window);
  if (!isWithinSendWindow(now, window, tz)) {
    return reschedule(orgId, campaignId, recipient, stepPosition, nextSendWindowStart(now, window, tz));
  }

  let message = await campaignsDb.findStepMessage(orgId, recipientId, step.id);
  const alreadySent = !!message && message.status !== "queued";

  if (!alreadySent) {
    const recent = await campaignsDb.countSentSince(orgId, campaignId, new Date(now.getTime() - 3_600_000).toISOString());
    const wait = throttleDelayMs({ sentLastHour: recent.count, oldestSentAt: recent.oldest, throttlePerHour: campaign.throttle_per_hour, now });
    if (wait > 0) return reschedule(orgId, campaignId, recipient, stepPosition, new Date(now.getTime() + wait));
  }

  if (campaign.status === "scheduled") {
    await campaignsDb.transition(orgId, campaignId, ["scheduled"], { status: "active" });
  }

  if (!alreadySent) {
    const lead = await campaignsDb.getLead(orgId, recipient.lead_id);
    if (!lead) return endRecipient(orgId, campaignId, recipientId, "failed", "The lead was deleted.");

    const unsubscribed = await unsubscribedFor(orgId, campaign.channel, [lead]);
    const verdict = resolveAudience([lead], campaign.channel, unsubscribed, defaultCountryCode());
    if (verdict.eligible.length === 0) {
      const reason = verdict.excluded[0]?.reason ?? "missing_address";
      return endRecipient(orgId, campaignId, recipientId, reason === "unsubscribed" ? "unsubscribed" : "skipped", EXCLUSION_LABELS[reason]);
    }
    const to = verdict.eligible[0].address;

    const channel = await getChannelConfig(orgId, campaign);
    if ("error" in channel) {
      await endRecipient(orgId, campaignId, recipientId, "failed", channel.error);
      throw new PermanentJobError(channel.error);
    }
    const config = channel.config;

    if (!message) {
      message = await campaignsDb.createMessage(orgId, {
        campaign_id: campaignId,
        step_id: step.id,
        recipient_id: recipientId,
        lead_id: lead.id,
        channel: campaign.channel,
        direction: "outbound",
        provider: config.provider,
        to_address: to,
        from_address: config.from,
        status: "queued",
        status_history: [{ status: "queued", at: now.toISOString() }],
      });
    }

    // WhatsApp has no idempotency key (Resend gets one in deliver): claim the message so a retried or
    // duplicate job never sends it twice.
    const claimsSend = config.channel === "whatsapp";
    if (claimsSend && !(await campaignsDb.claimMessageSend(orgId, message.id))) {
      const current = await campaignsDb.getMessage(orgId, message.id);
      const startedAt = current?.send_started_at ? new Date(current.send_started_at).getTime() : 0;
      if (current && current.status === "queued" && Date.now() - startedAt > SEND_CLAIM_STALE_MS) {
        const reason = "A previous send attempt was interrupted, so it is unknown whether WhatsApp delivered it. Not resent to avoid a duplicate.";
        const patch = nextMessageState(current, "failed", new Date().toISOString(), reason);
        if (patch) await campaignsDb.updateMessage(orgId, message.id, patch);
        await endRecipient(orgId, campaignId, recipientId, "failed", reason);
        throw new PermanentJobError(reason);
      }
      throw new Error("Another attempt is sending this message; checking again shortly.");
    }

    let sent: Awaited<ReturnType<typeof deliver>>;
    try {
      sent = await deliver(config, campaign, step, lead, message, to);
    } catch (err: any) {
      const reason = String(err?.message || err).slice(0, 1000);
      const retryable = err instanceof MessagingError ? err.retryable : true;
      // Only an error response from the provider proves nothing was sent; timeouts and dropped connections stay claimed.
      if (claimsSend && err instanceof MessagingError && err.status !== undefined) {
        await campaignsDb.releaseMessageSend(orgId, message.id);
      }
      if (retryable && ctx.attempt < ctx.job.max_attempts) {
        await campaignsDb.updateMessage(orgId, message.id, { error: reason });
        throw err;
      }
      const failedAt = new Date().toISOString();
      const patch = nextMessageState(message, "failed", failedAt, reason);
      if (patch) await campaignsDb.updateMessage(orgId, message.id, patch);
      events.emit("campaign.message_status", {
        orgId,
        actorId: null,
        campaignId,
        messageId: message.id,
        leadId: lead.id,
        channel: campaign.channel,
        status: "failed",
      });
      await endRecipient(orgId, campaignId, recipientId, "failed", reason);
      throw new PermanentJobError(reason);
    }

    const sentAt = new Date().toISOString();
    await campaignsDb.updateMessage(orgId, message.id, {
      provider_message_id: sent.providerMessageId,
      subject: sent.subject,
      body: sent.body,
      status: "sent",
      sent_at: sentAt,
      error: null,
      status_history: [...(message.status_history || []), { status: "sent", at: sentAt }],
    });
    await Promise.all([
      campaignsDb.markLeadContacted(orgId, lead.id, sentAt),
      activitiesDb.create(orgId, {
        type: campaign.channel === "email" ? "email" : "whatsapp",
        leadId: lead.id,
        title: campaign.channel === "email" ? `Campaign email sent: ${sent.subject}` : `Campaign WhatsApp sent (${campaign.name})`,
        body: sent.body ? sent.body.slice(0, 2000) : null,
        metadata: { campaignId, campaignName: campaign.name, messageId: message.id, stepPosition },
        occurredAt: sentAt,
      }),
    ]);
    events.emit("campaign.message_status", {
      orgId,
      actorId: null,
      campaignId,
      messageId: message.id,
      leadId: lead.id,
      channel: campaign.channel,
      status: "sent",
    });
  }

  const next = steps[index + 1];
  if (next) {
    const tzWindowStart = nextSendWindowStart(new Date(Date.now() + next.delay_minutes * 60_000), window, tz);
    const advanced = await campaignsDb.updateRecipient(
      orgId,
      recipientId,
      { current_step: next.position, next_run_at: tzWindowStart.toISOString(), last_error: null },
      ["active"]
    );
    if (advanced) {
      await enqueueJob(
        SEND_JOB,
        { campaignId, recipientId, stepPosition: next.position },
        { orgId, runAt: tzWindowStart, dedupeKey: jobKey(campaignId, recipientId, next.position) }
      );
    }
    await refreshCampaignStats(orgId, campaignId);
    return;
  }
  await endRecipient(orgId, campaignId, recipientId, "completed", null);
}

registerJobHandler(SEND_JOB, handleSendStep);

// ---- Provider events (webhooks) ----

/** Applies a delivery event to a message and its recipient. Returns false for duplicate events. */
export async function applyMessageEvent(
  message: MessageRow,
  event: MessageEvent,
  at: string,
  detail?: string | null,
  options: { unsubscribeReason?: string; source?: string } = {}
): Promise<boolean> {
  const orgId = message.org_id;
  const patch = nextMessageState(message, event, at, detail);
  if (patch) await campaignsDb.updateMessage(orgId, message.id, patch);

  const endsSequence = event === "bounced" || event === "failed" || !!options.unsubscribeReason;
  if (message.recipient_id && endsSequence) {
    const status: RecipientStatus = options.unsubscribeReason ? "unsubscribed" : event === "failed" ? "failed" : "bounced";
    await campaignsDb.updateRecipient(
      orgId,
      message.recipient_id,
      { status, next_run_at: null, last_error: detail?.slice(0, 500) ?? null },
      ["pending", "active", "completed"]
    );
  }
  if (options.unsubscribeReason && message.to_address) {
    await campaignsDb.addUnsubscribe(orgId, {
      channel: message.channel,
      address: message.to_address,
      leadId: message.lead_id,
      campaignId: message.campaign_id,
      reason: options.unsubscribeReason,
      source: options.source ?? message.provider,
    });
  }
  if ((event === "bounced" || options.unsubscribeReason) && message.lead_id) {
    await activitiesDb.create(orgId, {
      type: "campaign",
      leadId: message.lead_id,
      title: options.unsubscribeReason ? "Unsubscribed from campaigns" : `Campaign ${message.channel} bounced`,
      body: detail ?? null,
      metadata: { campaignId: message.campaign_id, messageId: message.id, reason: options.unsubscribeReason ?? null },
    });
  }

  if (!patch && !options.unsubscribeReason) return false;
  events.emit("campaign.message_status", {
    orgId,
    actorId: null,
    campaignId: message.campaign_id,
    messageId: message.id,
    leadId: message.lead_id,
    channel: message.channel,
    status: options.unsubscribeReason ? "unsubscribed" : event,
  });
  if (message.campaign_id) {
    await refreshCampaignStats(orgId, message.campaign_id);
    if (endsSequence) await maybeCompleteCampaign(orgId, message.campaign_id);
  }
  return true;
}

/** A reply to an outbound campaign message: stops the sequence for that lead. */
export async function recordReply(
  outbound: MessageRow,
  reply: { providerMessageId?: string | null; body: string | null; at: string; fromAddress: string | null },
  actorId: string | null = null
): Promise<void> {
  const orgId = outbound.org_id;
  let inboundId = outbound.id;
  if (reply.providerMessageId) {
    const existing = await campaignsDb.findMessageByProviderId(outbound.provider, reply.providerMessageId);
    if (existing) return;
    const inbound = await campaignsDb.createMessage(orgId, {
      campaign_id: outbound.campaign_id,
      step_id: outbound.step_id,
      recipient_id: outbound.recipient_id,
      lead_id: outbound.lead_id,
      channel: outbound.channel,
      direction: "inbound",
      provider: outbound.provider,
      provider_message_id: reply.providerMessageId,
      from_address: reply.fromAddress,
      to_address: outbound.from_address,
      body: reply.body,
      status: "received",
      status_history: [{ status: "received", at: reply.at }],
    });
    inboundId = inbound.id;
  }

  const patch = nextMessageState(outbound, "replied", reply.at);
  if (patch) await campaignsDb.updateMessage(orgId, outbound.id, patch);
  if (outbound.recipient_id) {
    await campaignsDb.updateRecipient(orgId, outbound.recipient_id, { status: "replied", next_run_at: null }, [
      "pending",
      "active",
      "completed",
    ]);
  }
  if (outbound.lead_id) {
    await activitiesDb.create(orgId, {
      type: outbound.channel === "email" ? "email" : "whatsapp",
      leadId: outbound.lead_id,
      title: `Replied to campaign ${outbound.channel === "email" ? "email" : "WhatsApp"}`,
      body: reply.body ? reply.body.slice(0, 4000) : null,
      metadata: { campaignId: outbound.campaign_id, messageId: inboundId, direction: "inbound" },
      actorId,
      occurredAt: reply.at,
    });
  }
  events.emit("campaign.replied", {
    orgId,
    actorId,
    campaignId: outbound.campaign_id,
    messageId: inboundId,
    leadId: outbound.lead_id,
    channel: outbound.channel,
    body: reply.body,
  });
  if (outbound.campaign_id) {
    await refreshCampaignStats(orgId, outbound.campaign_id);
    await maybeCompleteCampaign(orgId, outbound.campaign_id);
  }
}

/** Manual "mark as replied" for email replies that land in the sender's mailbox. */
export async function markRecipientReplied(orgId: string, actorId: string, campaignId: string, recipientId: string) {
  const recipient = await campaignsDb.getRecipient(orgId, recipientId);
  if (!recipient || recipient.campaign_id !== campaignId) throw HttpError.notFound("Recipient");
  const latest = (await campaignsDb.latestRecipientMessages(orgId, [recipientId])).get(recipientId);
  if (!latest) throw HttpError.badRequest("Nothing has been sent to this lead yet.");
  await recordReply(latest, { body: null, at: new Date().toISOString(), fromAddress: latest.to_address }, actorId);
}
