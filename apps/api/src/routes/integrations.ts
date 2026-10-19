import crypto from "crypto";
import axios from "axios";
import { z, type ZodTypeAny } from "zod";
import { dbQueries } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { send } from "../http/pagination";
import { parse, parseId } from "../http/validate";
import { getCtx, requireRole } from "../middleware/auth";
import { webAppUrl } from "../services/account";
import {
  PROVIDER_SPECS,
  completeCredentials,
  getProviderCredentials,
  isIntegrationProvider,
  resolveProviderCredentials,
  type IntegrationProvider,
} from "../integrations/credentials";
import {
  deleteIntegration,
  getIntegration,
  listIntegrations,
  saveIntegration,
  testIntegration,
} from "../integrations/service";
import { publicUrlProblem, slackWebhookUrlProblem } from "../integrations/providers";
import { logger } from "../logger";

const log = logger.child({ module: "integrations" });

const GRAPH_VERSION = "v21.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_SCOPES = [
  "leads_retrieval",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "ads_read",
];
/** The pre-auth academy belongs to the Default Workspace; other workspaces' sources have no academy. */
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_ACADEMY_ID = "00000000-0000-0000-0000-000000000001";
const STATE_TTL_MS = 10 * 60 * 1000;

function academyFor(orgId: string): string | null {
  return orgId === DEFAULT_ORG_ID ? DEFAULT_ACADEMY_ID : null;
}

function metaRedirectUri(): string {
  return process.env.META_REDIRECT_URI || "http://localhost:4000/api/integrations/meta/callback";
}

function webhookBaseUrl(): string {
  const base =
    process.env.PUBLIC_WEBHOOK_BASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return base.replace(/\/+$/, "");
}

function googleWebhookUrl(sourceId: string): string {
  return `${webhookBaseUrl()}/functions/v1/lead-webhook?source=google&source_id=${encodeURIComponent(sourceId)}`;
}

/** Callback URL for a workspace's own Meta app; the edge function verifies it with that workspace's "meta" secret. */
function metaWebhookUrl(orgId: string): string | null {
  const base = webhookBaseUrl();
  return base ? `${base}/functions/v1/lead-webhook?org_id=${encodeURIComponent(orgId)}` : null;
}

function toSourceDto(row: Record<string, any>) {
  return {
    id: row.id,
    platform: row.platform,
    pageName: row.page_name ?? null,
    externalPageId: row.external_page_id ?? null,
    formIds: row.form_ids ?? [],
    status: row.status ?? null,
    lastLeadAt: row.last_lead_at ?? null,
    createdAt: row.created_at ?? null,
    ...(row.platform === "google" ? { webhookUrl: googleWebhookUrl(row.id) } : {}),
  };
}

interface OAuthState {
  orgId: string;
  userId: string;
  exp: number;
  nonce: string;
}

/** Stateless OAuth state: base64url(JSON).hmac, bound to the org and user that started the flow. */
function issueState(state: Omit<OAuthState, "exp" | "nonce">, secret: string): string {
  const payload: OAuthState = { ...state, exp: Date.now() + STATE_TTL_MS, nonce: crypto.randomBytes(8).toString("hex") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${crypto.createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

/** Org claimed by an (unverified) state; only used to pick which Meta app secret verifies it. */
function claimedStateOrg(state: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(state.split(".")[0] || "", "base64url").toString("utf8"));
    return typeof payload?.orgId === "string" ? payload.orgId : null;
  } catch {
    return null;
  }
}

function readState(state: string, secret: string): OAuthState | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(encoded).digest("base64url"));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState;
    return payload.exp >= Date.now() && payload.orgId && payload.userId ? payload : null;
  } catch {
    return null;
  }
}

function graphErrorMessage(err: any): string {
  return err?.response?.data?.error?.message || err?.message || "Meta Graph API request failed";
}

function redirectToWeb(res: import("express").Response, params: Record<string, string>) {
  res.redirect(302, `${webAppUrl()}/integrations?${new URLSearchParams(params).toString()}`);
}

/** Mounted at /api/integrations WITHOUT auth: browser redirects from Meta. */
export const integrationsPublicRouter = createRouter();

// GET /api/integrations/meta/callback — store page tokens and subscribe pages to leadgen
integrationsPublicRouter.get("/meta/callback", async (req, res) => {
  const { code, state, error_description: errorDescription } = req.query as Record<string, string | undefined>;
  if (errorDescription) return redirectToWeb(res, { meta: "error", message: errorDescription });

  const claimedOrg = state ? claimedStateOrg(state) : null;
  const meta = claimedOrg ? await getProviderCredentials(claimedOrg, "meta") : null;
  if (!meta) {
    return redirectToWeb(res, { meta: "error", message: "Meta is not configured for this workspace." });
  }
  const { appId, appSecret } = meta;
  const oauth = state ? readState(state, appSecret) : null;
  if (!code || !oauth) {
    return redirectToWeb(res, { meta: "error", message: "Invalid or expired login state. Please try connecting again." });
  }

  try {
    const shortLived = await axios.get(`${GRAPH_URL}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, redirect_uri: metaRedirectUri(), code },
    });
    const longLived = await axios.get(`${GRAPH_URL}/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLived.data.access_token,
      },
    });
    const userToken: string = longLived.data.access_token;

    const accounts = await axios.get(`${GRAPH_URL}/me/accounts`, {
      params: { access_token: userToken, fields: "id,name,access_token", limit: 100 },
    });
    const pages: { id: string; name?: string; access_token?: string }[] = accounts.data?.data || [];
    if (pages.length === 0) {
      return redirectToWeb(res, { meta: "error", message: "No Facebook pages were shared with the app." });
    }

    const failures: string[] = [];
    for (const page of pages) {
      try {
        if (!page.access_token) throw new Error("no page access token returned");
        const source = await dbQueries.upsertLeadSourceByPage(oauth.orgId, "meta", page.id, {
          academy_id: academyFor(oauth.orgId),
          page_name: page.name || page.id,
          status: "active",
        });
        if (!source) throw new Error("lead source was not saved");
        await dbQueries.storeLeadSourceToken(source.id, page.access_token);
        await axios.post(`${GRAPH_URL}/${page.id}/subscribed_apps`, null, {
          params: { subscribed_fields: "leadgen", access_token: page.access_token },
        });
      } catch (err: any) {
        const message = graphErrorMessage(err);
        log.error("Meta page setup failed", { orgId: oauth.orgId, pageId: page.id, error: message });
        failures.push(`${page.name || page.id}: ${message}`);
      }
    }

    if (failures.length === pages.length) {
      return redirectToWeb(res, { meta: "error", message: failures.join("; ") });
    }
    redirectToWeb(res, { meta: "connected" });
  } catch (err: any) {
    const message = graphErrorMessage(err);
    log.error("Meta OAuth callback failed", { orgId: oauth.orgId, error: message });
    redirectToWeb(res, { meta: "error", message });
  }
});

/** Mounted at /api/integrations behind requireAuth(); owned by the Integrations module. */
export const integrationsRouter = createRouter();

const optionalText = z.string().trim().max(4000).optional();
const httpsUrl = z
  .string()
  .trim()
  .url("Enter a full URL")
  .refine((v) => /^https:\/\//i.test(v), "Must be an https:// URL")
  .optional();
const digits = (label: string) =>
  z.string().trim().regex(/^\d{5,25}$/, `${label} is a numeric id`).optional();

/** Per-provider field validators; blank secret fields keep the stored value. */
const FIELD_VALIDATORS: Partial<Record<IntegrationProvider, Record<string, ZodTypeAny>>> = {
  resend: {
    apiKey: z.string().trim().regex(/^re_\w+/, "Resend API keys start with re_").optional(),
    fromEmail: z.string().trim().email("Enter a valid email address").optional(),
    fromName: z.string().trim().max(120).optional(),
    webhookSecret: z.string().trim().regex(/^whsec_/, "Resend signing secrets start with whsec_").optional(),
  },
  whatsapp: {
    phoneNumberId: digits("Phone number ID"),
    businessAccountId: digits("Business account ID"),
  },
  sarvam: { baseUrl: httpsUrl, model: z.string().trim().max(100).optional() },
  slack: {
    webhookUrl: z
      .string()
      .trim()
      .refine((v) => /^https:\/\/hooks\.slack\.com\/services\//.test(v), "Use a Slack incoming webhook URL (https://hooks.slack.com/services/...)")
      .optional(),
  },
  webhook: { url: httpsUrl },
  meta: { appId: digits("App ID") },
};

/** URLs the server will call: https + public addresses only (Slack: hooks.slack.com only). */
const OUTBOUND_URL_CHECKS: Partial<Record<IntegrationProvider, Record<string, (url: string) => Promise<string | null>>>> = {
  slack: { webhookUrl: slackWebhookUrlProblem },
  webhook: { url: publicUrlProblem },
  sarvam: { baseUrl: publicUrlProblem },
};

function credentialsSchema(provider: IntegrationProvider) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of PROVIDER_SPECS[provider].fields) {
    const validator = FIELD_VALIDATORS[provider]?.[field.key] ?? optionalText;
    // "" means "leave unchanged" for secrets and "clear" for optional plain fields.
    shape[field.key] = z.union([z.literal(""), validator]).optional();
  }
  return z.object({ credentials: z.object(shape).strict() });
}

function parseProvider(value: unknown): IntegrationProvider {
  if (!isIntegrationProvider(value)) {
    throw HttpError.notFound(`Integration "${String(value)}"`);
  }
  return value;
}

// GET /api/integrations — every provider with status, plus connected lead sources (secrets are only masked)
integrationsRouter.get("/", async (req, res) => {
  const { orgId } = getCtx(req);
  const [providers, rows, meta] = await Promise.all([
    listIntegrations(orgId),
    dbQueries.getLeadSources(orgId),
    resolveProviderCredentials(orgId, "meta"),
  ]);
  send(res, { providers, sources: rows.map(toSourceDto), metaConfigured: !!meta, metaWebhookUrl: metaWebhookUrl(orgId) });
});

// POST /api/integrations/meta/connect-url (admin) — Facebook Login URL bound to this workspace
integrationsRouter.post("/meta/connect-url", requireRole("admin"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const meta = await getProviderCredentials(orgId, "meta");
  if (!meta) {
    throw HttpError.notConfigured("Meta is not configured. Add the Meta app ID and secret on the Integrations page.");
  }
  const params = new URLSearchParams({
    client_id: meta.appId,
    redirect_uri: metaRedirectUri(),
    state: issueState({ orgId, userId }, meta.appSecret),
    scope: META_SCOPES.join(","),
    response_type: "code",
  });
  send(res, { url: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}` });
});

// POST /api/integrations/google (admin) — create a Google Ads lead form webhook; the key is shown only once
integrationsRouter.post("/google", requireRole("admin"), async (req, res) => {
  const { orgId } = getCtx(req);
  const { name } = parse(z.object({ name: z.string().trim().max(120).optional() }), req.body ?? {});
  const webhookKey = crypto.randomBytes(24).toString("hex");
  const row = await dbQueries.insertLeadSource(orgId, {
    academy_id: academyFor(orgId),
    platform: "google",
    page_name: name || "Google Ads lead form",
    webhook_key: webhookKey,
    status: "active",
  });
  if (!row) throw new Error("Lead source was not created");
  send(res, { source: toSourceDto(row), webhookUrl: googleWebhookUrl(row.id), webhookKey }, 201);
});

// GET /api/integrations/:provider
integrationsRouter.get("/:provider", async (req, res) => {
  const { orgId } = getCtx(req);
  send(res, await getIntegration(orgId, parseProvider(req.params.provider)));
});

// PUT /api/integrations/:provider (admin) — store credentials in Vault, then validate them live
integrationsRouter.put("/:provider", requireRole("admin"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const provider = parseProvider(req.params.provider);
  const { credentials } = parse(credentialsSchema(provider), req.body ?? {});

  // Blank secrets keep what this workspace already saved (never env values).
  const existing = await resolveProviderCredentials(orgId, provider);
  const merged: Record<string, string> = {};
  const fieldErrors: Record<string, string[]> = {};
  for (const field of PROVIDER_SPECS[provider].fields) {
    const given = (credentials as Record<string, string | undefined>)[field.key];
    const kept = field.secret && existing?.source === "vault" ? existing.values[field.key] : undefined;
    const value = given ? given : given === "" && !field.secret ? undefined : kept;
    if (value) merged[field.key] = value;
    else if (field.required && !field.defaultValue) fieldErrors[`credentials.${field.key}`] = [`${field.label} is required`];
  }
  if (Object.keys(fieldErrors).length > 0 || !completeCredentials(provider, merged)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", fieldErrors);
  }
  for (const [field, check] of Object.entries(OUTBOUND_URL_CHECKS[provider] ?? {})) {
    const problem = merged[field] ? await check(merged[field]) : null;
    if (problem) fieldErrors[`credentials.${field}`] = [problem];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", fieldErrors);
  }

  const result = await saveIntegration(orgId, userId, provider, merged);
  send(res, result);
});

// POST /api/integrations/:provider/test (manager+) — live validation of the effective credentials
integrationsRouter.post("/:provider/test", requireRole("manager"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const provider = parseProvider(req.params.provider);
  const result = await testIntegration(orgId, userId, provider);
  if (!result) {
    throw HttpError.notConfigured(`${PROVIDER_SPECS[provider].name} is not configured. Save its credentials first.`);
  }
  send(res, result);
});

// DELETE /api/integrations/:provider (admin) — remove saved credentials (env fallback, if any, still applies)
// DELETE /api/integrations/:id (admin) — remove a Meta/Google lead source
integrationsRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  if (isIntegrationProvider(req.params.id)) {
    send(res, await deleteIntegration(orgId, userId, req.params.id));
    return;
  }

  const id = parseId(req.params.id, "source id");
  const source = await dbQueries.getLeadSource(orgId, id);
  if (!source) throw HttpError.notFound("Lead source");
  try {
    await dbQueries.deleteLeadSourceToken(id);
  } catch (err: any) {
    log.error("Vault token cleanup failed", { orgId, sourceId: id, err });
  }
  await dbQueries.deleteLeadSource(orgId, id);
  send(res, { id });
});
