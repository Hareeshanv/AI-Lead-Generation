import type { MessageCounts, RecipientCounts, RecipientStatus } from "@ai-lead-gen/database";

export interface CampaignStats {
  recipients: number;
  recipientsByStatus: Record<RecipientStatus, number>;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  failed: number;
  /** Percentages (0-100, two decimals). */
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
}

export function percent(part: number, whole: number): number {
  if (!whole || whole <= 0 || !part || part <= 0) return 0;
  return Math.round(Math.min(1, part / whole) * 10_000) / 100;
}

const EMPTY_BY_STATUS: Record<RecipientStatus, number> = {
  pending: 0,
  active: 0,
  completed: 0,
  replied: 0,
  bounced: 0,
  unsubscribed: 0,
  failed: 0,
  skipped: 0,
};

/**
 * Message-level rates. Delivery, reply and bounce are relative to sent messages; open and click
 * are relative to delivered ones (an open or click implies delivery).
 */
export function computeCampaignStats(recipients: RecipientCounts | null, messages: MessageCounts | null): CampaignStats {
  const m = messages ?? { sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, failed: 0 };
  const delivered = Math.max(m.delivered, m.opened, m.clicked);
  const opened = Math.max(m.opened, m.clicked);
  return {
    recipients: recipients?.total ?? 0,
    recipientsByStatus: { ...EMPTY_BY_STATUS, ...(recipients?.byStatus ?? {}) },
    sent: m.sent,
    delivered,
    opened,
    clicked: m.clicked,
    replied: m.replied,
    bounced: m.bounced,
    failed: m.failed,
    deliveryRate: percent(delivered, m.sent),
    openRate: percent(opened, delivered),
    clickRate: percent(m.clicked, delivered),
    replyRate: percent(m.replied, m.sent),
    bounceRate: percent(m.bounced, m.sent),
  };
}

/** Columns cached on the campaigns row (list view, analytics). */
export function statsColumns(stats: CampaignStats) {
  return {
    total_leads: stats.recipients - stats.recipientsByStatus.skipped,
    sent_count: stats.sent,
    delivered_count: stats.delivered,
    bounced_count: stats.bounced,
    open_rate: stats.openRate,
    click_rate: stats.clickRate,
    reply_rate: stats.replyRate,
  };
}

export interface FunnelStage {
  key: "recipients" | "sent" | "delivered" | "opened" | "clicked" | "replied";
  label: string;
  value: number;
}

export function campaignFunnel(stats: CampaignStats, channel: "email" | "whatsapp"): FunnelStage[] {
  const stages: FunnelStage[] = [
    { key: "recipients", label: "Recipients", value: stats.recipients - stats.recipientsByStatus.skipped },
    { key: "sent", label: "Sent", value: stats.sent },
    { key: "delivered", label: "Delivered", value: stats.delivered },
    { key: "opened", label: channel === "whatsapp" ? "Read" : "Opened", value: stats.opened },
  ];
  if (channel === "email") stages.push({ key: "clicked", label: "Clicked", value: stats.clicked });
  stages.push({ key: "replied", label: "Replied", value: stats.replied });
  return stages;
}
