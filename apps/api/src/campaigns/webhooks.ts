import crypto from "crypto";
import type { Request, Response } from "express";
import { campaignsDb, integrationsDb, type MessageRow } from "@ai-lead-gen/database";
import {
  parseWhatsAppWebhook,
  resendEventStatus,
  verifyMetaSignature,
  verifySvixSignature,
  WHATSAPP_UNDELIVERABLE_CODES,
} from "../../../../services/messaging";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { getProviderCredentials, resolveProviderCredentials } from "../integrations/credentials";
import { isOptOutText, verifyUnsubscribeToken } from "./content";
import { applyMessageEvent, recordReply } from "./service";
import type { MessageEvent } from "./messageState";

/**
 * Campaign provider callbacks, mounted under /api/webhooks (no auth; every handler verifies the
 * provider signature or a signed token before writing anything).
 *   POST /resend                      Resend (Svix-signed) delivery events
 *   GET|POST /whatsapp[/:orgId]       WhatsApp Cloud API verify + statuses + inbound replies
 *   GET /unsubscribe/:token           confirmation page for the signed unsubscribe link in campaign emails
 *   POST /unsubscribe/:token          unsubscribes (confirmation form or RFC 8058 one-click)
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

  // Only the sending workspace's secret (platform-managed workspaces resolve to RESEND_WEBHOOK_SECRET) may vouch for its messages.
  const secret = message
    ? (await getProviderCredentials(message.org_id, "resend"))?.webhookSecret
    : process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    throw HttpError.unauthorized("Resend webhook signing secret is not configured (RESEND_WEBHOOK_SECRET or the Resend integration).");
  }
  const headers = { id: req.header("svix-id"), timestamp: req.header("svix-timestamp"), signature: req.header("svix-signature") };
  if (!verifySvixSignature(secret, headers, raw)) throw HttpError.unauthorized("Invalid webhook signature.");

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

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function whatsappVerify(req: Request, res: Response) {
  const orgId = orgParam(req);
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  const expected = orgId ? (await getProviderCredentials(orgId, "whatsapp"))?.verifyToken : process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode !== "subscribe" || !token || !expected || !safeEqual(token, expected)) throw HttpError.forbidden("Webhook verification failed.");
  res.status(200).type("text/plain").send(challenge);
}

const STATUS_EVENTS: Record<"sent" | "delivered" | "read", MessageEvent> = { sent: "sent", delivered: "delivered", read: "opened" };

/**
 * Exactly one secret verifies a payload. With /whatsapp/:orgId it is that workspace's app secret.
 * On the shared URL, the workspace is found from the payload's phone_number_id (saved integration
 * config) and the messages it references; payloads that point at several workspaces with their
 * own apps are rejected (use the per-workspace URL). When nothing points at a workspace with its
 * own credentials, WHATSAPP_APP_SECRET verifies and only platform-managed workspaces are updated.
 */
async function whatsappSigner(
  orgId: string | null,
  phoneNumberIds: string[],
  known: Map<string, MessageRow>
): Promise<{ secret: string | undefined; orgId: string | null; inScope: (orgId: string) => Promise<boolean> }> {
  if (orgId) {
    const creds = await getProviderCredentials(orgId, "whatsapp");
    return { secret: creds?.appSecret, orgId, inScope: async (id) => id === orgId };
  }

  const candidates = new Set([...known.values()].map((m) => m.org_id));
  for (const phoneNumberId of phoneNumberIds) {
    for (const id of await integrationsDb.findOrgIdsByConfig("whatsapp", "phoneNumberId", phoneNumberId)) candidates.add(id);
  }
  const sources = new Map<string, string | null>();
  for (const id of candidates) sources.set(id, (await resolveProviderCredentials(id, "whatsapp"))?.source ?? null);
  const own = [...candidates].filter((id) => sources.get(id) === "vault");
  const platform = [...candidates].filter((id) => sources.get(id) === "env");

  if (own.length > 1 || (own.length === 1 && platform.length > 0)) {
    throw HttpError.unauthorized("This payload matches several workspaces. Point the webhook at /api/webhooks/whatsapp/<workspace id>.");
  }
  if (own.length === 1) {
    const creds = await getProviderCredentials(own[0], "whatsapp");
    return { secret: creds?.appSecret, orgId: own[0], inScope: async (id) => id === own[0] };
  }
  return {
    secret: process.env.WHATSAPP_APP_SECRET,
    orgId: null,
    inScope: async (id) => {
      if (!sources.has(id)) sources.set(id, (await resolveProviderCredentials(id, "whatsapp"))?.source ?? null);
      return sources.get(id) === "env";
    },
  };
}

async function whatsappEvents(req: Request, res: Response) {
  const orgId = orgParam(req);
  const raw = rawBody(req);
  const { statuses, messages } = parseWhatsAppWebhook(req.body);

  const known = new Map<string, MessageRow>();
  for (const id of [...statuses.map((s) => s.providerMessageId), ...messages.map((m) => m.contextId)].filter(Boolean) as string[]) {
    if (known.has(id)) continue;
    const message = await campaignsDb.findMessageByProviderId("whatsapp", id);
    if (message) known.set(id, message);
  }
  const phoneNumberIds = [
    ...new Set([...statuses.map((s) => s.phoneNumberId), ...messages.map((m) => m.phoneNumberId)].filter(Boolean) as string[]),
  ];
  const signer = await whatsappSigner(orgId, phoneNumberIds, known);
  if (!signer.secret) {
    throw HttpError.unauthorized("WhatsApp app secret is not configured (WHATSAPP_APP_SECRET or the WhatsApp integration).");
  }
  if (!verifyMetaSignature(signer.secret, req.header("x-hub-signature-256"), raw)) {
    throw HttpError.unauthorized("Invalid webhook signature.");
  }

  for (const s of statuses) {
    const message = known.get(s.providerMessageId);
    if (!message || !(await signer.inScope(message.org_id))) continue;
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
      outbound = await campaignsDb.latestOutboundTo("whatsapp", m.from, { orgId: signer.orgId, fromAddress: m.phoneNumberId });
    }
    if (!outbound || !(await signer.inScope(outbound.org_id))) continue;
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** `body` is trusted HTML; interpolate user data with escapeHtml. */
function page(title: string, body: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${title}</title></head>` +
    `<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#222">` +
    `<h1 style="font-size:20px">${title}</h1>${body}</body></html>`
  );
}

const paragraph = (text: string) => `<p style="color:#555;line-height:1.5">${text}</p>`;

async function unsubscribeTarget(req: Request): Promise<MessageRow | null> {
  const messageId = verifyUnsubscribeToken(req.params.token);
  const message = messageId ? await campaignsDb.getMessageById(messageId) : null;
  return message?.to_address ? message : null;
}

function invalidLink(res: Response) {
  res.status(404).type("html").send(page("Link not valid", paragraph("This unsubscribe link is invalid or has expired.")));
}

// GET only shows a confirmation form: mail scanners and link previews fetch links without the recipient's intent.
campaignWebhooksRouter.get("/unsubscribe/:token", async (req, res) => {
  const message = await unsubscribeTarget(req);
  if (!message) return invalidLink(res);
  const address = escapeHtml(message.to_address!);
  const already = await campaignsDb.unsubscribedAmong(message.org_id, message.channel, [message.to_address!]);
  res.setHeader("Cache-Control", "no-store");
  if (already.size > 0) {
    res.status(200).type("html").send(page("You're unsubscribed", paragraph(`${address} will no longer receive these campaign emails.`)));
    return;
  }
  res
    .status(200)
    .type("html")
    .send(
      page(
        "Unsubscribe?",
        paragraph(`Stop sending campaign emails to ${address}?`) +
          `<form method="post"><button type="submit" style="font-size:15px;padding:10px 18px;border:0;border-radius:6px;` +
          `background:#222;color:#fff;cursor:pointer">Unsubscribe</button></form>`
      )
    );
});

// POST: the confirmation form above, or a mail client's RFC 8058 one-click request (List-Unsubscribe-Post).
campaignWebhooksRouter.post("/unsubscribe/:token", async (req, res) => {
  const message = await unsubscribeTarget(req);
  if (!message) return invalidLink(res);
  const already = await campaignsDb.unsubscribedAmong(message.org_id, message.channel, [message.to_address!]);
  if (already.size === 0) {
    await applyMessageEvent(message, "delivered", new Date().toISOString(), "Unsubscribe link", {
      unsubscribeReason: "unsubscribe_link",
      source: "email_link",
    });
  }
  res.setHeader("Cache-Control", "no-store");
  if (!req.accepts("html")) {
    res.status(200).type("text/plain").send("Unsubscribed");
    return;
  }
  res
    .status(200)
    .type("html")
    .send(page("You're unsubscribed", paragraph(`${escapeHtml(message.to_address!)} will no longer receive these campaign emails.`)));
});
