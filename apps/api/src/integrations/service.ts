import crypto from "crypto";
import { integrationsDb, type IntegrationCredentialRow, type IntegrationStatus } from "@ai-lead-gen/database";
import { events } from "../events";
import { enqueueJob, registerJobHandler } from "../jobs/registry";
import {
  INTEGRATION_PROVIDERS,
  PROVIDER_SPECS,
  invalidateProviderCredentials,
  resolveProviderCredentials,
  type CredentialSource,
  type IntegrationProvider,
} from "./credentials";
import { checkProvider, type ProviderCheckResult } from "./providers";
import { logger } from "../logger";

const log = logger.child({ module: "integrations" });

export interface IntegrationFieldDto {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder: string | null;
  help: string | null;
  /** Plain value for non-secret fields, a masked hint for secrets, null when unset. */
  value: string | null;
}

export interface IntegrationDto {
  provider: IntegrationProvider;
  name: string;
  description: string;
  category: string;
  status: IntegrationStatus;
  /** "vault" = saved for this workspace, "env" = platform-managed server credentials (values are never returned). */
  source: CredentialSource | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
  fields: IntegrationFieldDto[];
}

export function maskSecret(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}/••••${value.slice(-4)}`;
    } catch {
      /* fall through */
    }
  }
  return value.length >= 10 ? `••••${value.slice(-4)}` : "••••";
}

function toDto(
  provider: IntegrationProvider,
  row: IntegrationCredentialRow | undefined,
  resolved: { values: Record<string, string>; source: CredentialSource } | null
): IntegrationDto {
  const spec = PROVIDER_SPECS[provider];
  // A stored check result only describes the credentials it was run against: ignore it when nothing resolves.
  const checked = resolved && row?.last_checked_at ? row : undefined;
  return {
    provider,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    status: resolved ? (checked?.status === "error" ? "error" : "connected") : "not_configured",
    source: resolved?.source ?? null,
    lastCheckedAt: checked?.last_checked_at ?? null,
    lastError: checked?.status === "error" ? checked.last_error : null,
    updatedAt: row?.updated_at ?? null,
    fields: spec.fields.map((f) => {
      // Platform-managed (env) values belong to the server operator, not the workspace.
      const value = resolved?.source === "vault" ? resolved.values[f.key] : undefined;
      return {
        key: f.key,
        label: f.label,
        secret: f.secret,
        required: f.required,
        placeholder: f.placeholder ?? f.defaultValue ?? null,
        help: f.help ?? null,
        value: value === undefined ? null : f.secret ? maskSecret(value) : value,
      };
    }),
  };
}

export async function listIntegrations(orgId: string): Promise<IntegrationDto[]> {
  const rows = await integrationsDb.list(orgId);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return Promise.all(
    INTEGRATION_PROVIDERS.map(async (p) => toDto(p, byProvider.get(p), await resolveProviderCredentials(orgId, p)))
  );
}

export async function getIntegration(orgId: string, provider: IntegrationProvider): Promise<IntegrationDto> {
  const [row, resolved] = await Promise.all([integrationsDb.get(orgId, provider), resolveProviderCredentials(orgId, provider)]);
  return toDto(provider, row ?? undefined, resolved);
}

/** Saves a check result and emits integration.status_changed when the status flips. */
export async function recordCheck(
  orgId: string,
  provider: IntegrationProvider,
  result: ProviderCheckResult,
  actorId: string | null = null
): Promise<void> {
  const status: IntegrationStatus = result.ok ? "connected" : "error";
  const previous = await integrationsDb.recordCheck(orgId, provider, status, result.ok ? null : result.message);
  if (previous !== status) {
    events.emit("integration.status_changed", {
      orgId,
      actorId,
      provider,
      status,
      error: result.ok ? null : result.message,
    });
  }
}

/** Splits values into Vault secret JSON and plain config, then runs a live check. */
export async function saveIntegration(
  orgId: string,
  userId: string,
  provider: IntegrationProvider,
  values: Record<string, string>
): Promise<{ integration: IntegrationDto; check: ProviderCheckResult }> {
  const secrets: Record<string, string> = {};
  const config: Record<string, string> = {};
  for (const field of PROVIDER_SPECS[provider].fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    (field.secret ? secrets : config)[field.key] = value;
  }
  await integrationsDb.save(orgId, provider, { secret: JSON.stringify(secrets), config, userId });
  invalidateProviderCredentials(orgId, provider);

  const check = (await checkProvider(provider, values)) ?? { ok: true, message: "Saved." };
  await recordCheck(orgId, provider, check, userId);
  return { integration: await getIntegration(orgId, provider), check };
}

export async function testIntegration(
  orgId: string,
  userId: string | null,
  provider: IntegrationProvider
): Promise<{ integration: IntegrationDto; check: ProviderCheckResult } | null> {
  invalidateProviderCredentials(orgId, provider);
  const resolved = await resolveProviderCredentials(orgId, provider);
  if (!resolved) return null;
  const check = (await checkProvider(provider, resolved.values)) ?? { ok: true, message: "Nothing to check." };
  await recordCheck(orgId, provider, check, userId);
  return { integration: await getIntegration(orgId, provider), check };
}

export async function deleteIntegration(orgId: string, userId: string, provider: IntegrationProvider): Promise<IntegrationDto> {
  await integrationsDb.remove(orgId, provider);
  invalidateProviderCredentials(orgId, provider);
  events.emit("integration.status_changed", { orgId, actorId: userId, provider, status: "not_configured", error: null });
  return getIntegration(orgId, provider);
}

// ---------------------------------------------------------------------------------------------
// Periodic health checks (job "integration.health_check")
// ---------------------------------------------------------------------------------------------

const HEALTH_CHECK_DEDUPE_KEY = "integration.health_check";

function fingerprint(provider: string, values: Record<string, string>): string {
  return crypto.createHash("sha256").update(`${provider}:${JSON.stringify(values)}`).digest("hex");
}

/** Checks every configured provider for one org (or all orgs); identical env credentials are checked once. */
export async function runHealthChecks(options: { orgId?: string | null; provider?: IntegrationProvider } = {}): Promise<number> {
  const orgIds = options.orgId ? [options.orgId] : await integrationsDb.listOrgIds();
  const providers = options.provider ? [options.provider] : INTEGRATION_PROVIDERS;
  const results = new Map<string, Promise<ProviderCheckResult | null>>();
  let checked = 0;

  for (const orgId of orgIds) {
    for (const provider of providers) {
      try {
        invalidateProviderCredentials(orgId, provider);
        const resolved = await resolveProviderCredentials(orgId, provider);
        if (!resolved) continue;
        const key = fingerprint(provider, resolved.values);
        if (!results.has(key)) results.set(key, checkProvider(provider, resolved.values, "health"));
        const result = await results.get(key)!;
        if (!result) continue;
        await recordCheck(orgId, provider, result);
        checked++;
      } catch (err: any) {
        log.error("Health check failed", { orgId, provider, err });
      }
    }
  }
  return checked;
}

registerJobHandler(
  "integration.health_check",
  async (payload, ctx) => {
    const provider = payload.provider && payload.provider in PROVIDER_SPECS ? (payload.provider as IntegrationProvider) : undefined;
    const checked = await runHealthChecks({ orgId: ctx.orgId, provider });
    if (checked > 0) log.info("Health check finished", { checked });
  },
  { backoffMs: () => 5 * 60 * 1000 }
);

let healthTimer: NodeJS.Timeout | null = null;

/** Enqueues a global health check now and every INTEGRATION_HEALTH_CHECK_MINUTES (default 60). */
export function scheduleIntegrationHealthChecks(): void {
  if (healthTimer) return;
  const minutes = Math.max(5, Number(process.env.INTEGRATION_HEALTH_CHECK_MINUTES) || 60);
  const enqueue = () =>
    enqueueJob("integration.health_check", {}, { dedupeKey: HEALTH_CHECK_DEDUPE_KEY, maxAttempts: 2 }).catch((err) =>
      log.error("Could not schedule health check", { err })
    );
  setTimeout(() => void enqueue(), 30_000).unref();
  healthTimer = setInterval(() => void enqueue(), minutes * 60 * 1000);
  healthTimer.unref();
}
