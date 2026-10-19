import type { MessageRow, MessageStatus } from "@ai-lead-gen/database";

export type MessageEvent = "sent" | "delivered" | "opened" | "clicked" | "replied" | "bounced" | "failed";

const RANK: Record<MessageStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  replied: 5,
  received: 5,
  bounced: 6,
  failed: 6,
};

const TIMESTAMP: Record<MessageEvent, keyof MessageRow> = {
  sent: "sent_at",
  delivered: "delivered_at",
  opened: "opened_at",
  clicked: "clicked_at",
  replied: "replied_at",
  bounced: "bounced_at",
  failed: "failed_at",
};

/** Events that imply earlier ones (a click means it was opened, delivered and sent). */
const IMPLIES: Record<MessageEvent, MessageEvent[]> = {
  sent: [],
  delivered: ["sent"],
  opened: ["delivered", "sent"],
  clicked: ["opened", "delivered", "sent"],
  replied: ["delivered", "sent"],
  bounced: ["sent"],
  failed: [],
};

export type MessagePatch = Partial<
  Pick<
    MessageRow,
    "status" | "status_history" | "error" | "sent_at" | "delivered_at" | "opened_at" | "clicked_at" | "replied_at" | "bounced_at" | "failed_at"
  >
>;

/**
 * Patch for a provider event: first-seen timestamps are kept, implied timestamps filled in, and
 * the status only moves forward (bounced/failed are terminal unless the lead already replied).
 * Returns null when the event changes nothing (duplicate webhook delivery).
 */
export function nextMessageState(
  message: Pick<MessageRow, "status" | "status_history" | TimestampKey>,
  event: MessageEvent,
  at: string,
  detail?: string | null
): MessagePatch | null {
  const patch: MessagePatch = {};
  for (const e of [event, ...IMPLIES[event]]) {
    const key = TIMESTAMP[e] as TimestampKey;
    if (!message[key]) (patch as any)[key] = at;
  }

  const current = message.status;
  const terminal = current === "bounced" || current === "failed";
  let nextStatus: MessageStatus = current;
  if (event === "bounced" || event === "failed") {
    if (current !== "replied") nextStatus = event;
  } else if (!terminal && RANK[event] > RANK[current]) {
    nextStatus = event;
  } else if (terminal && event === "replied") {
    nextStatus = "replied";
  }
  if (nextStatus !== current) patch.status = nextStatus;
  if (Object.keys(patch).length === 0) return null;

  if ((event === "bounced" || event === "failed") && detail) patch.error = detail.slice(0, 1000);
  patch.status_history = [...(message.status_history || []), { status: event, at, ...(detail ? { detail } : {}) }].slice(-50);
  return patch;
}

type TimestampKey = "sent_at" | "delivered_at" | "opened_at" | "clicked_at" | "replied_at" | "bounced_at" | "failed_at";
