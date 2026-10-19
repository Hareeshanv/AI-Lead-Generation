import { describe, expect, it } from "vitest";
import type { MessageCounts, RecipientCounts } from "@ai-lead-gen/database";
import { campaignFunnel, computeCampaignStats, percent, statsColumns } from "../../apps/api/src/campaigns/stats";

const recipients = (byStatus: Partial<RecipientCounts["byStatus"]>, total?: number): RecipientCounts => {
  const full = { pending: 0, active: 0, completed: 0, replied: 0, bounced: 0, unsubscribed: 0, failed: 0, skipped: 0, ...byStatus };
  return { total: total ?? Object.values(full).reduce((a, b) => a + b, 0), byStatus: full };
};

const messages = (m: Partial<MessageCounts>): MessageCounts => ({
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  replied: 0,
  bounced: 0,
  failed: 0,
  ...m,
});

describe("percent", () => {
  it("returns a percentage with two decimals", () => {
    expect(percent(1, 3)).toBe(33.33);
    expect(percent(2, 3)).toBe(66.67);
    expect(percent(1, 8)).toBe(12.5);
    expect(percent(5, 5)).toBe(100);
  });

  it("caps at 100", () => {
    expect(percent(12, 10)).toBe(100);
  });

  it("returns 0 for empty, zero or negative inputs", () => {
    expect(percent(0, 10)).toBe(0);
    expect(percent(5, 0)).toBe(0);
    expect(percent(-1, 10)).toBe(0);
    expect(percent(1, -10)).toBe(0);
    expect(percent(Number.NaN, 10)).toBe(0);
  });
});

describe("computeCampaignStats", () => {
  it("returns zeros with no data", () => {
    const stats = computeCampaignStats(null, null);
    expect(stats).toEqual({
      recipients: 0,
      recipientsByStatus: { pending: 0, active: 0, completed: 0, replied: 0, bounced: 0, unsubscribed: 0, failed: 0, skipped: 0 },
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      replied: 0,
      bounced: 0,
      failed: 0,
      deliveryRate: 0,
      openRate: 0,
      clickRate: 0,
      replyRate: 0,
      bounceRate: 0,
    });
  });

  it("computes rates against sent (delivery, reply, bounce) and delivered (open, click)", () => {
    const stats = computeCampaignStats(
      recipients({ completed: 90, skipped: 10 }),
      messages({ sent: 80, delivered: 60, opened: 30, clicked: 15, replied: 8, bounced: 4, failed: 2 })
    );
    expect(stats.recipients).toBe(100);
    expect(stats.deliveryRate).toBe(75);
    expect(stats.openRate).toBe(50);
    expect(stats.clickRate).toBe(25);
    expect(stats.replyRate).toBe(10);
    expect(stats.bounceRate).toBe(5);
    expect(stats.failed).toBe(2);
  });

  it("treats opens and clicks as implied deliveries", () => {
    const stats = computeCampaignStats(null, messages({ sent: 10, delivered: 2, opened: 5, clicked: 7 }));
    expect(stats.delivered).toBe(7);
    expect(stats.opened).toBe(7);
    expect(stats.clicked).toBe(7);
    expect(stats.openRate).toBe(100);
    expect(stats.deliveryRate).toBe(70);
  });

  it("fills missing recipient statuses with 0", () => {
    const stats = computeCampaignStats({ total: 3, byStatus: { pending: 3 } as RecipientCounts["byStatus"] }, null);
    expect(stats.recipientsByStatus.pending).toBe(3);
    expect(stats.recipientsByStatus.skipped).toBe(0);
  });
});

describe("statsColumns", () => {
  it("maps stats onto campaign columns, excluding skipped recipients", () => {
    const stats = computeCampaignStats(
      recipients({ completed: 8, skipped: 2 }),
      messages({ sent: 8, delivered: 8, opened: 4, clicked: 2, replied: 1, bounced: 0 })
    );
    expect(statsColumns(stats)).toEqual({
      total_leads: 8,
      sent_count: 8,
      delivered_count: 8,
      bounced_count: 0,
      open_rate: 50,
      click_rate: 25,
      reply_rate: 12.5,
    });
  });
});

describe("campaignFunnel", () => {
  const stats = computeCampaignStats(
    recipients({ completed: 9, skipped: 1 }),
    messages({ sent: 9, delivered: 8, opened: 6, clicked: 3, replied: 2 })
  );

  it("includes clicks for email", () => {
    expect(campaignFunnel(stats, "email")).toEqual([
      { key: "recipients", label: "Recipients", value: 9 },
      { key: "sent", label: "Sent", value: 9 },
      { key: "delivered", label: "Delivered", value: 8 },
      { key: "opened", label: "Opened", value: 6 },
      { key: "clicked", label: "Clicked", value: 3 },
      { key: "replied", label: "Replied", value: 2 },
    ]);
  });

  it("uses Read and skips clicks for WhatsApp", () => {
    const funnel = campaignFunnel(stats, "whatsapp");
    expect(funnel.map((s) => s.key)).toEqual(["recipients", "sent", "delivered", "opened", "replied"]);
    expect(funnel[3].label).toBe("Read");
  });
});
