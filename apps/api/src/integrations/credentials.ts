import { integrationsDb, isDbConfigured } from "@ai-lead-gen/database";
import { logger } from "../logger";

const log = logger.child({ module: "integrations" });

export type IntegrationProvider = "resend" | "whatsapp" | "serper" | "sarvam" | "slack" | "webhook" | "meta";

export interface CredentialField {
  key: string;
  label: string;
  /** Stored in Vault and only ever returned masked. */
  secret: boolean;
  required: boolean;
  env: string;
  defaultValue?: string;
  placeholder?: string;
  help?: string;
}

export interface ProviderSpec {
  provider: IntegrationProvider;
  name: string;
  description: string;
  category: "messaging" | "data" | "ai" | "notifications" | "lead_source";
  fields: CredentialField[];
}

/**
 * Credential keys returned by getProviderCredentials, per provider:
 * - resend:   apiKey, fromEmail, fromName?, webhookSecret?
 * - whatsapp: phoneNumberId, accessToken, businessAccountId?, verifyToken?, appSecret?
 * - serper:   apiKey
 * - sarvam:   apiKey, baseUrl, model
 * - slack:    webhookUrl
 * - webhook:  url, signingSecret?
 * - meta:     appId, appSecret, verifyToken?
 */
export const PROVIDER_SPECS: Record<IntegrationProvider, ProviderSpec> = {
  resend: {
    provider: "resend",
    name: "Resend",
    description: "Sends campaign emails and receives delivery, open, click and bounce events.",
    category: "messaging",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, env: "RESEND_API_KEY", placeholder: "re_..." },
      {
        key: "fromEmail",
        label: "From email",
        secret: false,
        required: true,
        env: "RESEND_FROM_EMAIL",
        placeholder: "hello@yourdomain.com",
        help: "Must be on a domain verified in Resend.",
      },
      { key: "fromName", label: "From name", secret: false, required: false, env: "RESEND_FROM_NAME" },
      {
        key: "webhookSecret",
        label: "Webhook signing secret",
        secret: true,
        required: false,
        env: "RESEND_WEBHOOK_SECRET",
        placeholder: "whsec_...",
        help: "From the Resend webhook pointing at /api/webhooks/resend.",
      },
    ],
  },
  whatsapp: {
    provider: "whatsapp",
    name: "WhatsApp Cloud API",
    description: "Sends approved WhatsApp templates and receives delivery statuses and replies.",
    category: "messaging",
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", secret: false, required: true, env: "WHATSAPP_PHONE_NUMBER_ID" },
      { key: "accessToken", label: "Access token", secret: true, required: true, env: "WHATSAPP_ACCESS_TOKEN" },
      {
        key: "businessAccountId",
        label: "Business account ID",
        secret: false,
        required: false,
        env: "WHATSAPP_BUSINESS_ACCOUNT_ID",
      },
      {
        key: "verifyToken",
        label: "Webhook verify token",
        secret: true,
        required: false,
        env: "WHATSAPP_VERIFY_TOKEN",
        help: "Any string; enter the same value in the Meta webhook setup for /api/webhooks/whatsapp.",
      },
      {
        key: "appSecret",
        label: "App secret",
        secret: true,
        required: false,
        env: "WHATSAPP_APP_SECRET",
        help: "Used to verify webhook signatures.",
      },
    ],
  },
  serper: {
    provider: "serper",
    name: "Serper",
    description: "Google web and places search used by the AI discovery agent.",
    category: "data",
    fields: [{ key: "apiKey", label: "API key", secret: true, required: true, env: "SERPER_API_KEY" }],
  },
  sarvam: {
    provider: "sarvam",
    name: "Sarvam AI",
    description: "LLM used to classify, score and enrich discovered leads.",
    category: "ai",
    fields: [
      { key: "apiKey", label: "API subscription key", secret: true, required: true, env: "SARVAM_API_KEY" },
      {
        key: "baseUrl",
        label: "API base URL",
        secret: false,
        required: false,
        env: "SARVAM_API_BASE_URL",
        defaultValue: "https://api.sarvam.ai",
      },
      {
        key: "model",
        label: "Model",
        secret: false,
        required: false,
        env: "SARVAM_MODEL",
        defaultValue: "sarvam-105b-conversations",
      },
    ],
  },
  slack: {
    provider: "slack",
    name: "Slack",
    description: "Posts workflow alerts to a Slack channel through an incoming webhook.",
    category: "notifications",
    fields: [
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        secret: true,
        required: true,
        env: "SLACK_WEBHOOK_URL",
        placeholder: "https://hooks.slack.com/services/...",
      },
    ],
  },
  webhook: {
    provider: "webhook",
    name: "Outbound webhook",
    description: "POSTs JSON events to your own endpoint from workflow actions.",
    category: "notifications",
    fields: [
      { key: "url", label: "Endpoint URL", secret: true, required: true, env: "OUTBOUND_WEBHOOK_URL", placeholder: "https://..." },
      {
        key: "signingSecret",
        label: "Signing secret",
        secret: true,
        required: false,
        env: "OUTBOUND_WEBHOOK_SECRET",
        help: "When set, requests carry X-Signature: sha256=<HMAC of the body>.",
      },
    ],
  },
  meta: {
    provider: "meta",
    name: "Meta Lead Ads",
    description: "Facebook Login app used to connect pages and receive leadgen webhooks.",
    category: "lead_source",
    fields: [
      { key: "appId", label: "App ID", secret: false, required: true, env: "META_APP_ID" },
      { key: "appSecret", label: "App secret", secret: true, required: true, env: "META_APP_SECRET" },
      { key: "verifyToken", label: "Webhook verify token", secret: true, required: false, env: "META_VERIFY_TOKEN" },
    ],
  },
};

export const INTEGRATION_PROVIDERS = Object.keys(PROVIDER_SPECS) as IntegrationProvider[];

export function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return typeof value === "string" && value in PROVIDER_SPECS;
}

export type CredentialSource = "vault" | "env";

export interface ResolvedCredentials {
  values: Record<string, string>;
  source: CredentialSource;
}

const CACHE_MS = 30_000;
const cache = new Map<string, { value: ResolvedCredentials | null; expiresAt: number }>();

/** Call after saving or deleting an org's credentials. */
export function invalidateProviderCredentials(orgId?: string, provider?: IntegrationProvider): void {
  if (!orgId) return cache.clear();
  for (const key of cache.keys()) {
    if (key.startsWith(`${orgId}:`) && (!provider || key === `${orgId}:${provider}`)) cache.delete(key);
  }
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Fills defaults and returns null when a required field is missing. */
export function completeCredentials(provider: IntegrationProvider, raw: Record<string, unknown>): Record<string, string> | null {
  const values: Record<string, string> = {};
  for (const field of PROVIDER_SPECS[provider].fields) {
    const value = clean(raw[field.key]) ?? field.defaultValue;
    if (value !== undefined) values[field.key] = value;
    else if (field.required) return null;
  }
  return values;
}

/** Workspaces must bring their own Slack and webhook targets: env values would receive another workspace's lead data. */
const NEVER_PLATFORM_MANAGED: ReadonlySet<IntegrationProvider> = new Set(["slack", "webhook"]);

function envList(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether the server's env credentials may stand in for a workspace that has not saved its own.
 * Off unless PLATFORM_MANAGED_PROVIDERS lists the provider (or "*"); PLATFORM_MANAGED_ORG_IDS, when
 * set, limits it to those workspaces. Never for Slack or outbound webhooks.
 */
export function isPlatformManaged(orgId: string, provider: IntegrationProvider): boolean {
  if (NEVER_PLATFORM_MANAGED.has(provider)) return false;
  const providers = envList("PLATFORM_MANAGED_PROVIDERS");
  if (!providers.includes("*") && !providers.includes(provider)) return false;
  const orgs = envList("PLATFORM_MANAGED_ORG_IDS");
  return orgs.length === 0 || orgs.includes("*") || orgs.includes(orgId.toLowerCase());
}

export function envCredentials(provider: IntegrationProvider): Record<string, string> | null {
  const raw: Record<string, unknown> = {};
  for (const field of PROVIDER_SPECS[provider].fields) raw[field.key] = process.env[field.env];
  return completeCredentials(provider, raw);
}

async function vaultCredentials(orgId: string, provider: IntegrationProvider): Promise<Record<string, string> | null> {
  const row = await integrationsDb.get(orgId, provider);
  if (!row?.has_secret) return null;
  const secretJson = await integrationsDb.getSecret(orgId, provider);
  let secrets: Record<string, unknown> = {};
  if (secretJson) {
    try {
      secrets = JSON.parse(secretJson);
    } catch {
      log.error("Stored secret is not valid JSON", { orgId, provider });
      return null;
    }
  }
  return completeCredentials(provider, { ...(row.config || {}), ...secrets });
}

/**
 * Credentials for a provider and where they came from: the workspace's Vault-stored credentials
 * when saved, otherwise the server env vars if the provider is platform-managed for this workspace
 * (see isPlatformManaged). Null when nothing usable is configured.
 */
export async function resolveProviderCredentials(
  orgId: string,
  provider: IntegrationProvider
): Promise<ResolvedCredentials | null> {
  const key = `${orgId}:${provider}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let resolved: ResolvedCredentials | null = null;
  if (orgId && isDbConfigured) {
    try {
      const values = await vaultCredentials(orgId, provider);
      if (values) resolved = { values, source: "vault" };
    } catch (err: any) {
      log.error("Reading credentials failed", { orgId, provider, err });
    }
  }
  if (!resolved && isPlatformManaged(orgId, provider)) {
    const values = envCredentials(provider);
    if (values) resolved = { values, source: "env" };
  }

  if (cache.size > 2_000) cache.clear();
  cache.set(key, { value: resolved, expiresAt: Date.now() + CACHE_MS });
  return resolved;
}

/** Workspace credentials from Vault (or platform-managed env vars); null when the provider is not configured. */
export async function getProviderCredentials(
  orgId: string,
  provider: IntegrationProvider
): Promise<Record<string, string> | null> {
  return (await resolveProviderCredentials(orgId, provider))?.values ?? null;
}
