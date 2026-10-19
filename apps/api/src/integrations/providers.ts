import crypto from "crypto";
import axios, { type AxiosError } from "axios";
import type { IntegrationProvider } from "./credentials";
import { assertSafeUrl, safePost, UnsafeUrlError, type SafeResponse } from "./safeHttp";

const TIMEOUT_MS = 15_000;
const GRAPH_URL = "https://graph.facebook.com/v21.0";

export interface ProviderCheckResult {
  ok: boolean;
  /** User-facing summary of what was checked, or why it failed. */
  message: string;
  details?: Record<string, unknown>;
}

/** Best-effort readable message from a provider's error response. */
function upstreamMessage(err: unknown, fallback: string): string {
  const e = err as AxiosError<any>;
  if (!e?.response) {
    if (e?.code === "ECONNABORTED" || e?.code === "ETIMEDOUT") return `${fallback}: the request timed out.`;
    if (e?.code === "ENOTFOUND") return `${fallback}: the host could not be resolved.`;
    return `${fallback}: ${e?.message || "network error"}.`;
  }
  const data = e.response.data;
  const detail =
    (typeof data === "string" && data.slice(0, 200)) ||
    data?.error?.message ||
    data?.message ||
    (typeof data?.error === "string" ? data.error : null) ||
    data?.detail ||
    null;
  return `${fallback} (HTTP ${e.response.status})${detail ? `: ${detail}` : "."}`;
}

async function checkResend(c: Record<string, string>): Promise<ProviderCheckResult> {
  const domain = (c.fromEmail || "").split("@")[1]?.toLowerCase();
  if (!domain) return { ok: false, message: "The from email address is not valid." };
  try {
    const res = await axios.get("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${c.apiKey}` },
      timeout: TIMEOUT_MS,
    });
    const domains: { name: string; status: string }[] = res.data?.data || [];
    const match = domains.find((d) => d.name?.toLowerCase() === domain);
    if (!match) {
      return {
        ok: false,
        message: `The API key works, but ${domain} is not a domain in this Resend account. Add and verify it in Resend.`,
        details: { domains: domains.map((d) => d.name) },
      };
    }
    if (match.status !== "verified") {
      return { ok: false, message: `${domain} is in Resend but its status is "${match.status}". Finish DNS verification first.` };
    }
    return { ok: true, message: `API key valid and ${domain} is verified.`, details: { domain } };
  } catch (err: any) {
    const name = err?.response?.data?.name;
    if (name === "restricted_api_key") {
      return { ok: true, message: `API key valid (sending-only key, so the ${domain} domain status could not be checked).` };
    }
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      return { ok: false, message: "Resend rejected the API key. Check that it is correct and not revoked." };
    }
    return { ok: false, message: upstreamMessage(err, "Resend check failed") };
  }
}

async function checkWhatsApp(c: Record<string, string>): Promise<ProviderCheckResult> {
  try {
    const res = await axios.get(`${GRAPH_URL}/${encodeURIComponent(c.phoneNumberId)}`, {
      params: { fields: "display_phone_number,verified_name,quality_rating", access_token: c.accessToken },
      timeout: TIMEOUT_MS,
    });
    const { display_phone_number: phone, verified_name: verifiedName, quality_rating: quality } = res.data || {};
    return {
      ok: true,
      message: `Connected to ${verifiedName || "WhatsApp number"} (${phone || c.phoneNumberId}).`,
      details: { displayPhoneNumber: phone, verifiedName, qualityRating: quality },
    };
  } catch (err: any) {
    const graph = err?.response?.data?.error;
    if (graph?.code === 190) return { ok: false, message: "The WhatsApp access token is invalid or expired." };
    if (graph?.code === 100) {
      return { ok: false, message: "Phone number ID not found, or the token has no access to it." };
    }
    return { ok: false, message: upstreamMessage(err, "WhatsApp check failed") };
  }
}

async function checkSerper(c: Record<string, string>): Promise<ProviderCheckResult> {
  try {
    const res = await axios.post(
      "https://google.serper.dev/search",
      { q: "test", num: 1 },
      { headers: { "X-API-KEY": c.apiKey, "Content-Type": "application/json" }, timeout: TIMEOUT_MS }
    );
    const credits = res.data?.credits;
    return { ok: true, message: "Test search succeeded.", details: credits !== undefined ? { creditsUsed: credits } : undefined };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) return { ok: false, message: "Serper rejected the API key." };
    if (status === 400 && /credits/i.test(JSON.stringify(err?.response?.data || ""))) {
      return { ok: false, message: "The Serper account has no search credits left." };
    }
    return { ok: false, message: upstreamMessage(err, "Serper test search failed") };
  }
}

async function checkSarvam(c: Record<string, string>): Promise<ProviderCheckResult> {
  const base = (c.baseUrl || "https://api.sarvam.ai").replace(/\/+$/, "");
  try {
    await assertSafeUrl(base);
  } catch (err: any) {
    return { ok: false, message: `Sarvam base URL: ${err.message}` };
  }
  try {
    await axios.post(
      `${base}/v1/chat/completions`,
      { model: c.model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 5, temperature: 0 },
      { headers: { "api-subscription-key": c.apiKey, "Content-Type": "application/json" }, timeout: 30_000 }
    );
    return { ok: true, message: `Model ${c.model} responded.` };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) return { ok: false, message: "Sarvam rejected the API subscription key." };
    if (status === 400 || status === 404) {
      return { ok: false, message: upstreamMessage(err, `Sarvam rejected the request for model "${c.model}"`) };
    }
    return { ok: false, message: upstreamMessage(err, "Sarvam ping failed") };
  }
}

export const SLACK_WEBHOOK_HOSTS = ["hooks.slack.com"];
const SLACK_URL = /^https:\/\/hooks\.slack\.com\//;
const SLACK_URL_MESSAGE = "The Slack webhook URL must start with https://hooks.slack.com/.";

/** Message for a safePost failure: unsafe URLs keep their own message, transport errors get a prefix. */
function outboundMessage(err: unknown, fallback: string): string {
  if (err instanceof UnsafeUrlError) return err.message;
  return `${fallback}: ${(err as Error)?.message || "network error"}`;
}

/** Save-time check for a Slack incoming webhook URL; returns a user-facing problem or null. */
export async function slackWebhookUrlProblem(url: string): Promise<string | null> {
  if (!SLACK_URL.test(url)) return SLACK_URL_MESSAGE;
  try {
    await assertSafeUrl(url, { allowedHosts: SLACK_WEBHOOK_HOSTS });
    return null;
  } catch (err: any) {
    return err?.message || "The Slack webhook URL is not allowed.";
  }
}

/** Save-time check for a URL the server will call (outbound webhook, Sarvam base URL); returns a user-facing problem or null. */
export async function publicUrlProblem(url: string): Promise<string | null> {
  try {
    await assertSafeUrl(url);
    return null;
  } catch (err: any) {
    return err?.message || "The URL is not allowed.";
  }
}

async function postToSlack(webhookUrl: string, payload: unknown): Promise<SafeResponse> {
  if (!SLACK_URL.test(webhookUrl)) throw new Error(SLACK_URL_MESSAGE);
  try {
    return await safePost(webhookUrl, JSON.stringify(payload), {
      allowedHosts: SLACK_WEBHOOK_HOSTS,
      headers: { "Content-Type": "application/json" },
      timeoutMs: TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(outboundMessage(err, "Slack post failed"));
  }
}

function slackProblem(res: SafeResponse, fallback: string): string {
  const body = res.body.trim();
  if (body === "no_service" || body === "invalid_token") return "Slack says this webhook URL is revoked or invalid.";
  if (body === "channel_not_found" || body === "channel_is_archived") return `Slack channel problem: ${body}.`;
  return `${fallback} (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : "."}`;
}

/** Posts a message to a Slack incoming webhook. Throws with a readable message on failure. */
export async function postSlackMessage(webhookUrl: string, payload: { text: string; blocks?: unknown[] }): Promise<void> {
  const res = await postToSlack(webhookUrl, payload);
  if (res.status < 200 || res.status >= 300) throw new Error(slackProblem(res, "Slack post failed"));
}

/** POSTs JSON to an outbound webhook (https, public hosts only), signed with HMAC-SHA256 when a secret is set. */
export async function postOutboundWebhook(
  url: string,
  signingSecret: string | undefined,
  body: Record<string, unknown>
): Promise<{ status: number }> {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "AI-LeadGen-Webhooks/1.0" };
  if (signingSecret) {
    headers["X-Signature"] = `sha256=${crypto.createHmac("sha256", signingSecret).update(json).digest("hex")}`;
  }
  let res: SafeResponse;
  try {
    res = await safePost(url, json, { headers, timeoutMs: TIMEOUT_MS });
  } catch (err) {
    throw new Error(outboundMessage(err, "Webhook endpoint request failed"));
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = res.body.trim().slice(0, 200);
    throw new Error(`Webhook endpoint request failed (HTTP ${res.status})${detail ? `: ${detail}` : "."}`);
  }
  return { status: res.status };
}

async function checkSlack(c: Record<string, string>): Promise<ProviderCheckResult> {
  try {
    await postSlackMessage(c.webhookUrl, { text: ":white_check_mark: AI LeadGen is connected to this channel." });
    return { ok: true, message: "Test message posted to Slack." };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

async function checkWebhook(c: Record<string, string>): Promise<ProviderCheckResult> {
  try {
    const { status } = await postOutboundWebhook(c.url, c.signingSecret, {
      event: "integration.test",
      sentAt: new Date().toISOString(),
      data: { message: "Test event from AI LeadGen" },
    });
    return { ok: true, message: `Endpoint answered HTTP ${status}.` };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

async function checkMeta(c: Record<string, string>): Promise<ProviderCheckResult> {
  const appToken = `${c.appId}|${c.appSecret}`;
  try {
    const res = await axios.get(`${GRAPH_URL}/debug_token`, {
      params: { input_token: appToken, access_token: appToken },
      timeout: TIMEOUT_MS,
    });
    const data = res.data?.data || {};
    if (!data.is_valid) return { ok: false, message: "Meta says the app credentials are not valid." };
    return {
      ok: true,
      message: `App ${data.application || c.appId} credentials are valid.`,
      details: { application: data.application, type: data.type },
    };
  } catch (err: any) {
    const graph = err?.response?.data?.error;
    if (graph?.code === 190 || graph?.code === 101) return { ok: false, message: "Meta rejected the App ID / App secret pair." };
    return { ok: false, message: upstreamMessage(err, "Meta token debug failed") };
  }
}

/** Slack answers an empty payload with 400 "no_text" for a live webhook, without posting anything. */
async function probeSlack(c: Record<string, string>): Promise<ProviderCheckResult> {
  try {
    const res = await postToSlack(c.webhookUrl, {});
    if ((res.status >= 200 && res.status < 300) || (res.status === 400 && /no_text|missing_text/.test(res.body))) {
      return { ok: true, message: "Slack webhook is reachable." };
    }
    return { ok: false, message: slackProblem(res, "Slack check failed") };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

const CHECKS: Record<IntegrationProvider, (c: Record<string, string>) => Promise<ProviderCheckResult>> = {
  resend: checkResend,
  whatsapp: checkWhatsApp,
  serper: checkSerper,
  sarvam: checkSarvam,
  slack: checkSlack,
  webhook: checkWebhook,
  meta: checkMeta,
};

/**
 * Validates credentials live against the provider. Never throws.
 * mode "health" avoids visible side effects: Slack is probed without posting and outbound
 * webhooks are not called (returns null = no new information).
 */
export async function checkProvider(
  provider: IntegrationProvider,
  credentials: Record<string, string>,
  mode: "manual" | "health" = "manual"
): Promise<ProviderCheckResult | null> {
  try {
    if (mode === "health") {
      if (provider === "webhook") return null;
      if (provider === "slack") return await probeSlack(credentials);
    }
    return await CHECKS[provider](credentials);
  } catch (err: any) {
    return { ok: false, message: err?.message || `${provider} check failed.` };
  }
}
