import crypto from "crypto";
import { MessagingError, fetchWithTimeout, isRetryableStatus } from "./errors";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 20_000;

export interface ResendEmailInput {
  apiKey: string;
  /** "Name <email@domain>" or a bare address on a domain verified in Resend. */
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  /** Resend tags: names/values may only contain ASCII letters, numbers, "_" and "-". */
  tags?: Record<string, string>;
  /** Sent as Idempotency-Key so a retried job does not send twice. */
  idempotencyKey?: string;
}

/** Sends one email through the Resend API and returns Resend's email id. */
export async function sendResendEmail(input: ResendEmailInput): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (input.replyTo) body.reply_to = input.replyTo;
  if (input.headers && Object.keys(input.headers).length > 0) body.headers = input.headers;
  if (input.tags) body.tags = Object.entries(input.tags).map(([name, value]) => ({ name, value }));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;

  const res = await fetchWithTimeout(RESEND_EMAILS_URL, { method: "POST", headers, body: JSON.stringify(body) }, TIMEOUT_MS);
  const payload: any = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = payload?.message || payload?.error || res.statusText;
    const hint =
      res.status === 401 || res.status === 403
        ? " Check the Resend API key and that the from address is on a verified domain."
        : "";
    throw new MessagingError(`Resend rejected the email (${res.status}): ${detail}.${hint}`, isRetryableStatus(res.status), res.status, payload?.name);
  }
  if (!payload?.id) throw new MessagingError("Resend accepted the email but returned no id.", false, res.status);
  return { id: String(payload.id) };
}

export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/**
 * Verifies a Resend (Svix) webhook: HMAC-SHA256 of "{svix-id}.{svix-timestamp}.{raw body}" with the
 * base64 key after "whsec_", compared to any "v1,<base64>" entry of svix-signature.
 */
export function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  rawBody: Buffer | string,
  options: { toleranceSeconds?: number; now?: number } = {}
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > (options.toleranceSeconds ?? 300)) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  } catch {
    return false;
  }
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

export type ResendEventStatus = "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "failed" | "delayed";

/** Maps a Resend webhook type ("email.delivered", ...) to a status, or null for events we ignore. */
export function resendEventStatus(type: string): ResendEventStatus | null {
  switch (type) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "opened";
    case "email.clicked":
      return "clicked";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.failed":
      return "failed";
    case "email.delivery_delayed":
      return "delayed";
    default:
      return null;
  }
}
