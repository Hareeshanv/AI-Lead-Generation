import { describe, expect, it } from "vitest";
import type { MessageRow } from "@ai-lead-gen/database";
import { nextMessageState } from "../../apps/api/src/campaigns/messageState";

type Msg = Parameters<typeof nextMessageState>[0];

const T0 = "2026-03-02T10:00:00.000Z";
const T1 = "2026-03-02T10:05:00.000Z";

function msg(overrides: Partial<MessageRow> = {}): Msg {
  return {
    status: "queued",
    status_history: [],
    sent_at: null,
    delivered_at: null,
    opened_at: null,
    clicked_at: null,
    replied_at: null,
    bounced_at: null,
    failed_at: null,
    ...overrides,
  };
}

describe("nextMessageState", () => {
  it("records a send", () => {
    expect(nextMessageState(msg(), "sent", T0)).toEqual({
      sent_at: T0,
      status: "sent",
      status_history: [{ status: "sent", at: T0 }],
    });
  });

  it("fills implied timestamps for a click", () => {
    expect(nextMessageState(msg({ status: "sent", sent_at: T0 }), "clicked", T1)).toEqual({
      clicked_at: T1,
      opened_at: T1,
      delivered_at: T1,
      status: "clicked",
      status_history: [{ status: "clicked", at: T1 }],
    });
  });

  it("fills sent and delivered for a reply but not opened", () => {
    const patch = nextMessageState(msg(), "replied", T1);
    expect(patch).toMatchObject({ replied_at: T1, delivered_at: T1, sent_at: T1, status: "replied" });
    expect(patch).not.toHaveProperty("opened_at");
  });

  it("keeps first-seen timestamps", () => {
    const patch = nextMessageState(msg({ status: "sent", delivered_at: T0 }), "delivered", T1);
    expect(patch).toEqual({
      sent_at: T1,
      status: "delivered",
      status_history: [{ status: "delivered", at: T1 }],
    });
  });

  it("returns null for a duplicate event", () => {
    expect(nextMessageState(msg({ status: "delivered", sent_at: T0, delivered_at: T0 }), "delivered", T1)).toBeNull();
    expect(nextMessageState(msg({ status: "sent", sent_at: T0 }), "sent", T1)).toBeNull();
  });

  it("never moves the status backwards", () => {
    const clicked = msg({ status: "clicked", sent_at: T0, delivered_at: T0, opened_at: T0, clicked_at: T0 });
    expect(nextMessageState(clicked, "opened", T1)).toBeNull();
    expect(nextMessageState(clicked, "delivered", T1)).toBeNull();

    const patch = nextMessageState(msg({ status: "opened", sent_at: T0, opened_at: T0 }), "delivered", T1);
    expect(patch).toEqual({ delivered_at: T1, status_history: [{ status: "delivered", at: T1 }] });
  });

  it("marks a bounce with its detail", () => {
    expect(nextMessageState(msg({ status: "sent", sent_at: T0 }), "bounced", T1, "Mailbox does not exist")).toEqual({
      bounced_at: T1,
      status: "bounced",
      error: "Mailbox does not exist",
      status_history: [{ status: "bounced", at: T1, detail: "Mailbox does not exist" }],
    });
  });

  it("does not imply anything for a failure", () => {
    expect(nextMessageState(msg(), "failed", T0, "Invalid number")).toEqual({
      failed_at: T0,
      status: "failed",
      error: "Invalid number",
      status_history: [{ status: "failed", at: T0, detail: "Invalid number" }],
    });
  });

  it("truncates long error details", () => {
    const patch = nextMessageState(msg(), "failed", T0, "x".repeat(5000));
    expect(patch?.error).toHaveLength(1000);
  });

  it("only stores error details for failures", () => {
    const patch = nextMessageState(msg({ status: "sent", sent_at: T0 }), "delivered", T1, "Marked as spam");
    expect(patch).not.toHaveProperty("error");
    expect(patch?.status_history).toEqual([{ status: "delivered", at: T1, detail: "Marked as spam" }]);
  });

  it("keeps a replied status when a bounce arrives later", () => {
    const replied = msg({ status: "replied", sent_at: T0, delivered_at: T0, replied_at: T0 });
    const patch = nextMessageState(replied, "bounced", T1, "Late bounce");
    expect(patch).toMatchObject({ bounced_at: T1, error: "Late bounce" });
    expect(patch).not.toHaveProperty("status");
  });

  it("treats bounced and failed as terminal for engagement events", () => {
    const bounced = msg({ status: "bounced", sent_at: T0, bounced_at: T0 });
    const patch = nextMessageState(bounced, "opened", T1);
    expect(patch).toMatchObject({ opened_at: T1, delivered_at: T1 });
    expect(patch).not.toHaveProperty("status");

    const failed = msg({ status: "failed", failed_at: T0 });
    expect(nextMessageState(failed, "delivered", T1)).not.toHaveProperty("status");
  });

  it("lets a reply override a terminal status", () => {
    const bounced = msg({ status: "bounced", sent_at: T0, bounced_at: T0 });
    expect(nextMessageState(bounced, "replied", T1)?.status).toBe("replied");
  });

  it("returns null for a duplicate bounce webhook that carries the same detail", () => {
    const bounced = msg({ status: "bounced", sent_at: T0, bounced_at: T0 });
    expect(nextMessageState(bounced, "bounced", T1, "Mailbox does not exist")).toBeNull();
  });

  it("appends to the history and keeps the last 50 entries", () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ status: "opened", at: `h${i}` }));
    const patch = nextMessageState(msg({ status: "queued", status_history: history }), "sent", T0);
    expect(patch?.status_history).toHaveLength(50);
    expect(patch?.status_history?.[0]).toEqual({ status: "opened", at: "h1" });
    expect(patch?.status_history?.[49]).toEqual({ status: "sent", at: T0 });
  });

  it("tolerates a null history", () => {
    const patch = nextMessageState(msg({ status_history: null as unknown as MessageRow["status_history"] }), "sent", T0);
    expect(patch?.status_history).toEqual([{ status: "sent", at: T0 }]);
  });
});
