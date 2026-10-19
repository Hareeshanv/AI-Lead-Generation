import type { CampaignRecipientRow, CampaignRow, CampaignStepRow, MessageRow } from "@ai-lead-gen/database";
import { readAudienceFilter } from "./audience";
import { readSendWindow } from "./schedule";
import type { CampaignStats } from "./stats";

const num = (v: unknown) => Number(v) || 0;

export function toCampaignDto(row: CampaignRow, extra: { stepsCount?: number } = {}) {
  const totalLeads = num(row.total_leads);
  const sentCount = num(row.sent_count);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    channel: row.channel,
    audienceFilter: readAudienceFilter(row.audience_filter),
    sendWindow: readSendWindow(row.send_window),
    throttlePerHour: row.throttle_per_hour,
    fromIdentity: row.from_identity || {},
    scheduledAt: row.scheduled_at,
    launchedAt: row.launched_at,
    completedAt: row.completed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stepsCount: extra.stepsCount ?? null,
    totalLeads,
    sentCount,
    deliveredCount: num(row.delivered_count),
    bouncedCount: num(row.bounced_count),
    openRate: num(row.open_rate),
    clickRate: num(row.click_rate),
    replyRate: num(row.reply_rate),
  };
}

export function toStepDto(row: CampaignStepRow) {
  return {
    id: row.id,
    position: row.position,
    delayMinutes: row.delay_minutes,
    subject: row.subject,
    body: row.body,
    whatsappTemplate: row.whatsapp_template,
  };
}

export function toMessageSummary(row: MessageRow | undefined | null) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    toAddress: row.to_address,
    subject: row.subject,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    openedAt: row.opened_at,
    clickedAt: row.clicked_at,
    repliedAt: row.replied_at,
    bouncedAt: row.bounced_at,
    failedAt: row.failed_at,
    error: row.error,
  };
}

export function toRecipientDto(row: CampaignRecipientRow & { lead?: Record<string, any> | null }, lastMessage?: MessageRow | null) {
  const lead = row.lead;
  return {
    id: row.id,
    leadId: row.lead_id,
    lead: lead
      ? {
          id: lead.id,
          name: lead.name ?? null,
          company: lead.company ?? null,
          email: lead.email && lead.email !== "Not available" ? lead.email : null,
          phone: lead.phone ?? null,
          status: lead.status ?? null,
          score: lead.score ?? null,
        }
      : null,
    status: row.status,
    currentStep: row.current_step,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: toMessageSummary(lastMessage),
  };
}

export type CampaignStatsDto = CampaignStats;
