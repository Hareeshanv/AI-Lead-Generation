import { createRouter } from "../http/router";
import { campaignWebhooksRouter } from "../campaigns/webhooks";

/**
 * Mounted at /api/webhooks WITHOUT auth (provider callbacks: Resend, WhatsApp, ...).
 * Every handler must verify the provider signature / verify token itself.
 * Handlers that need the raw body for signature checks get it as req.rawBody (see app.ts).
 */
export const webhooksRouter = createRouter();

// Campaigns: /resend, /whatsapp[/:orgId], /unsubscribe/:token
webhooksRouter.use(campaignWebhooksRouter);
