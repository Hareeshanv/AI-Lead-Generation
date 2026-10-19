import crypto from "crypto";
import { MessagingError, fetchWithTimeout, isRetryableStatus } from "./errors";

const GRAPH_BASE_URL = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 20_000;

/** Graph error codes worth retrying (throttling / temporary failures). */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131016, 131048, 131056]);

export interface WhatsAppTemplate {
  name: string;
  /** Template language code, e.g. "en" or "en_US". */
  language: string;
  /** Raw Cloud API components; string values may hold {{placeholders}} rendered by the caller. */
  components?: unknown[];
}

export interface WhatsAppTemplateInput {
  phoneNumberId: string;
  accessToken: string;
  /** Digits only, with country code (e.g. 919876543210). */
  to: string;
  template: WhatsAppTemplate;
}

/** Sends an approved template message through the WhatsApp Cloud API; returns the wamid. */
export async function sendWhatsAppTemplate(input: WhatsAppTemplateInput): Promise<{ id: string }> {
  const template: Record<string, unknown> = { name: input.template.name, language: { code: input.template.language } };
  if (input.template.components && input.template.components.length > 0) template.components = input.template.components;

  const res = await fetchWithTimeout(
    `${GRAPH_BASE_URL}/${encodeURIComponent(input.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.to, type: "template", template }),
    },
    TIMEOUT_MS
  );
  const payload: any = await res.json().catch(() => null);
  if (!res.ok) {
    const error = payload?.error || {};
    const code = error.code as number | undefined;
    const detail = error.error_data?.details || error.message || res.statusText;
    const hint =
      code === 190
        ? " The access token is invalid or expired."
        : code === 132001
          ? " The template name or language does not exist or is not approved."
          : code === 132000
            ? " The number of template parameters does not match the approved template."
            : "";
    const retryable = isRetryableStatus(res.status) || (code !== undefined && RETRYABLE_CODES.has(code));
    throw new MessagingError(`WhatsApp rejected the message (${code ?? res.status}): ${detail}.${hint}`, retryable, res.status, code);
  }
  const id = payload?.messages?.[0]?.id;
  if (!id) throw new MessagingError("WhatsApp accepted the message but returned no id.", false, res.status);
  return { id: String(id) };
}

/** Verifies X-Hub-Signature-256 ("sha256=<hex HMAC of the raw body with the app secret>"). */
export function verifyMetaSignature(appSecret: string, header: string | undefined, rawBody: Buffer | string): boolean {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export interface WhatsAppStatusUpdate {
  phoneNumberId: string | null;
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipient: string | null;
  at: string;
  error: string | null;
  errorCode: number | null;
}

export interface WhatsAppInboundMessage {
  phoneNumberId: string | null;
  providerMessageId: string;
  from: string;
  /** wamid of the message being replied to, when the user used "reply". */
  contextId: string | null;
  type: string;
  text: string | null;
  at: string;
}

function toIso(timestamp: unknown): string {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

function inboundText(message: any): string | null {
  switch (message?.type) {
    case "text":
      return message.text?.body ?? null;
    case "button":
      return message.button?.text ?? message.button?.payload ?? null;
    case "interactive":
      return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null;
    default:
      return message?.[message?.type]?.caption ?? null;
  }
}

/** Flattens a Cloud API webhook body into status updates and inbound messages. */
export function parseWhatsAppWebhook(body: any): { statuses: WhatsAppStatusUpdate[]; messages: WhatsAppInboundMessage[] } {
  const statuses: WhatsAppStatusUpdate[] = [];
  const messages: WhatsAppInboundMessage[] = [];
  if (!body || body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return { statuses, messages };

  for (const entry of body.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!s?.id || !["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        const err = Array.isArray(s.errors) ? s.errors[0] : null;
        statuses.push({
          phoneNumberId,
          providerMessageId: String(s.id),
          status: s.status,
          recipient: s.recipient_id ?? null,
          at: toIso(s.timestamp),
          error: err ? String(err.error_data?.details || err.message || err.title || "Delivery failed") : null,
          errorCode: err?.code ?? null,
        });
      }
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m?.id || !m.from) continue;
        messages.push({
          phoneNumberId,
          providerMessageId: String(m.id),
          from: String(m.from),
          contextId: m.context?.id ?? null,
          type: String(m.type || "unknown"),
          text: inboundText(m),
          at: toIso(m.timestamp),
        });
      }
    }
  }
  return { statuses, messages };
}

/** Graph error codes meaning the number cannot receive the message (treated as a bounce). */
export const WHATSAPP_UNDELIVERABLE_CODES = new Set([131026, 131021]);
