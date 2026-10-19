import type { Request, Response } from "express";
import { campaignsDb, type MessageRow } from "@ai-lead-gen/database";
import {
  parseWhatsAppWebhook,
  resendEventStatus,
  verifyMetaSignature,
  verifySvixSignature,
  WHATSAPP_UNDELIVERABLE_CODES,
} from "../../../../services/messaging";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { getProviderCredentials } from "../integrations/credentials";
import { isOptOutText, verifyUnsubscribeToken } from "./content";
import { applyMessageEvent, recordReply } from "./service";
import type { MessageEvent } from "./messageState";

/**
 * Campaign provider callbacks, mounted under /api/webhooks (no auth; every handler verifies the
 * provider signature or a signed token before writing anything).
 *   POST /resend                      Resend (Svix-signed) delivery events
 *   GET|POST /whatsapp[/:orgId]       WhatsApp Cloud API verify + statuses + inbound replies
 *   GET|POST /unsubscribe/:token      signed unsubscribe link from campaign emails
 */
export const campaignWebhooksRouter = createRouter();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function orgParam(req: Request): string | null {
  const id = req.params.orgId;
  if (id === undefined) return null;
  if (!UUID_RE.test(id)) throw HttpError.notFound("Webhook");
  return id;
}

function rawBody(req: Request): Buffer {
  if (!req.rawBody || req.rawBody.length === 0) throw HttpError.badRequest("Empty webhook body.");
  return req.rawBody;
}

// ---- Resend ----

campaignWebhooksRouter.post("/resend", async (req, res) => {
  const raw = rawBody(req);
  const body = req.body || {};
  const emailId: string | undefined = body?.data?.email_id;
  const message = emailId ? await campaignsDb.findMessageByProviderId("resend", String(emailId)) : null;

  const secrets = new Set<string>();
  if (message) {
    const creds = await getProviderCredentials(message.org_id, "resend");
    if (creds?.webhookSecret) secrets.add(creds.webhookSecret);
  }
  if (process.env.RESEND_WEBHOOK_SECRET) secrets.add(process.env.RESEND_WEBHOOK_SECRET);
  if (secrets.size === 0) {
    throw HttpError.unauthorized("Resend webhook signing secret is not configured (RESEND_WEBHOOK_SECRET or the Resend integration).");
  }
  const headers = { id: req.header("svix-id"), timestamp: req.header("svix-timestamp"), signature: req.header("svix-signature") };
  if (![...secrets].some((s) => verifySvixSignature(s, headers, raw))) throw HttpError.unauthorized("Invalid webhook signature.");

  const status = resendEventStatus(String(body.type || ""));
  if (!message || !status || status === "delayed") {
    res.json({ received: true, handled: false });
    return;
  }

  const at = String(body.created_at || body.data?.created_at || new Date().toISOString());
  const bounceType = String(body.data?.bounce?.type || "");
  const bounceDetail = body.data?.bounce?.message ? String(body.data.bounce.message) : null;
  if (status === "complained") {
    await applyMessageEvent(message, "delivered", at, "Marked as spam", { unsubscribeReason: "complaint", source: "resend" });
  } else if (status === "bounced") {
    const permanent = !/transient|soft/i.test(bounceType);
    await applyMessageEvent(
      message,
      "bounced",
      at,
      bounceDetail || `${bounceType || "Hard"} bounce`,
      permanent ? { unsubscribeReason: "bounced", source: "resend" } : {}
    );
  } else {
    await applyMessageEvent(message, status, at, status === "failed" ? String(body.data?.failed?.reason || "Send failed") : null);
  }
  res.json({ received: true, handled: true });
});

// ---- WhatsApp Cloud API ----

async function whatsappSecrets(orgIds: string[], field: "verifyToken" | "appSecret"): Promise<string[]> {
  const out = new Set<string>();
  for (const orgId of new Set(orgIds)) {
    const creds = await getProviderCredentials(orgId, "whatsapp");
    if (creds?.[field]) out.add(creds[field]);
  }
  const env = field === "verifyToken" ? process.env.WHATSAPP_VERIFY_TOKEN : process.env.WHATSAPP_APP_SECRET;
  if (env) out.add(env);
  return [...out];
}

async function whatsappVerify(req: Request, res: Response) {
  const orgId = orgParam(req);
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  const tokens = await whatsappSecrets(orgId ? [orgId] : [], "verifyToken");
  if (mode !== "subscribe" || !token || !tokens.includes(token)) throw HttpError.forbidden("Webhook verification failed.");
  res.status(200).type("text/plain").send(challenge);
}

const STATUS_EVENTS: Record<"sent" | "delivered" | "read", MessageEvent> = { sent: "sent", delivered: "delivered", read: "opened" };

async function whatsappEvents(req: Request, res: Response) {
  const orgId = orgParam(req);
  const raw = rawBody(req);
  const { statuses, messages } = parseWhatsAppWebhook(req.body);

  // Messages referenced by the payload tell us which workspaces' app secrets may have signed it.
  const known = new Map<string, MessageRow>();
  for (const id of [...statuses.map((s) => s.providerMessageId), ...messages.map((m) => m.contextId)].filter(Boolean) as string[]) {
    if (known.has(id)) continue;
    const message = await campaignsDb.findMessageByProviderId("whatsapp", id);
    if (message) known.set(id, message);
  }
  const candidateOrgs = orgId ? [orgId] : [...known.values()].map((m) => m.org_id);
  const secrets = await whatsappSecrets(candidateOrgs, "appSecret");
  if (secrets.length === 0) {
    throw HttpError.unauthorized("WhatsApp app secret is not configured (WHATSAPP_APP_SECRET or the WhatsApp integration).");
  }
  const signature = req.header("x-hub-signature-256");
  if (!secrets.some((s) => verifyMetaSignature(s, signature, raw))) throw HttpError.unauthorized("Invalid webhook signature.");

  const inScope = (m: MessageRow) => !orgId || m.org_id === orgId;

  for (const s of statuses) {
    const message = known.get(s.providerMessageId);
    if (!message || !inScope(message)) continue;
    if (s.status === "failed") {
      const bounced = s.errorCode != null && WHATSAPP_UNDELIVERABLE_CODES.has(s.errorCode);
      await applyMessageEvent(message, bounced ? "bounced" : "failed", s.at, s.error || "Delivery failed");
    } else {
      await applyMessageEvent(message, STATUS_EVENTS[s.status], s.at);
    }
  }

  for (const m of messages) {
    let outbound = m.contextId ? known.get(m.contextId) ?? null : null;
    if (!outbound) {
      outbound = await campaignsDb.latestOutboundTo("whatsapp", m.from, { orgId, fromAddress: m.phoneNumberId });
    }
    if (!outbound || !inScope(outbound)) continue;
    if (isOptOutText(m.text)) {
      await applyMessageEvent(outbound, "delivered", m.at, `Replied "${(m.text || "").trim()}"`, {
        unsubscribeReason: "opt_out_reply",
        source: "whatsapp",
      });
    } else {
      await recordReply(outbound, { providerMessageId: m.providerMessageId, body: m.text, at: m.at, fromAddress: m.from });
    }
  }
  res.json({ received: true });
}

campaignWebhooksRouter.get("/whatsapp", whatsappVerify);
campaignWebhooksRouter.get("/whatsapp/:orgId", whatsappVerify);
campaignWebhooksRouter.post("/whatsapp", whatsappEvents);
campaignWebhooksRouter.post("/whatsapp/:orgId", whatsappEvents);

// ---- Unsubscribe link ----

function page(title: string, text: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#222">` +
    `<h1 style="font-size:20px">${title}</h1><p style="color:#555;line-height:1.5">${text}</p></body></html>`
  );
}

async function unsubscribe(req: Request, res: Response) {
  const messageId = verifyUnsubscribeToken(req.params.token);
  const message = messageId ? await campaignsDb.getMessageById(messageId) : null;
  if (!message || !message.to_address) {
    res.status(404).type("html").send(page("Link not valid", "This unsubscribe link is invalid or has expired."));
    return;
  }
  const already = await campaignsDb.unsubscribedAmong(message.org_id, message.channel, [message.to_address]);
  if (already.size === 0) {
    await applyMessageEvent(message, "delivered", new Date().toISOString(), "Unsubscribe link", {
      unsubscribeReason: "unsubscribe_link",
      source: "email_link",
    });
  }
  if (req.method === "POST") {
    res.status(200).type("text/plain").send("Unsubscribed");
    return;
  }
  res
    .status(200)
    .type("html")
    .send(page("You're unsubscribed", `${message.to_address} will no longer receive these campaign emails.`));
}

campaignWebhooksRouter.get("/unsubscribe/:token", unsubscribe);
campaignWebhooksRouter.post("/unsubscribe/:token", unsubscribe);
