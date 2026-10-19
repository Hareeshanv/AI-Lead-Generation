import { dbClient } from "../client";
import { dbError } from "../helpers";

export type IntegrationStatus = "connected" | "not_configured" | "error";

export interface IntegrationCredentialRow {
  id: string;
  org_id: string;
  provider: string;
  config: Record<string, string>;
  status: IntegrationStatus;
  last_checked_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** True when a Vault secret is stored for this (org, provider). */
  has_secret: boolean;
}

const COLUMNS = "id, org_id, provider, config, status, last_checked_at, last_error, created_by, created_at, updated_at, vault_secret_id";

function toRow(raw: any): IntegrationCredentialRow {
  const { vault_secret_id, ...rest } = raw;
  return { ...rest, config: raw.config || {}, has_secret: !!vault_secret_id };
}

/** Owned by the Integrations module. Secrets are only readable through the get_integration_secret RPC. */
export const integrationsDb = {
  async list(orgId: string): Promise<IntegrationCredentialRow[]> {
    const { data, error } = await dbClient.from("integration_credentials").select(COLUMNS).eq("org_id", orgId);
    if (error) throw dbError("list integration credentials", error);
    return (data || []).map(toRow);
  },

  async get(orgId: string, provider: string): Promise<IntegrationCredentialRow | null> {
    const { data, error } = await dbClient
      .from("integration_credentials")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw dbError("get integration credentials", error);
    return data ? toRow(data) : null;
  },

  /** Decrypted secret JSON string, or null when nothing is stored. */
  async getSecret(orgId: string, provider: string): Promise<string | null> {
    const { data, error } = await dbClient.rpc("get_integration_secret", { p_org_id: orgId, p_provider: provider });
    if (error) throw dbError("read integration secret", error);
    return typeof data === "string" && data.length > 0 ? data : null;
  },

  /** Stores the secret in Vault and the non-secret config on the row. */
  async save(
    orgId: string,
    provider: string,
    input: { secret: string; config: Record<string, string>; userId: string | null }
  ): Promise<IntegrationCredentialRow> {
    const stored = await dbClient.rpc("store_integration_secret", {
      p_org_id: orgId,
      p_provider: provider,
      p_secret: input.secret,
    });
    if (stored.error) throw dbError("store integration secret", stored.error);

    const { data, error } = await dbClient
      .from("integration_credentials")
      .update({ config: input.config, created_by: input.userId, status: "connected", last_error: null })
      .eq("org_id", orgId)
      .eq("provider", provider)
      .select(COLUMNS)
      .single();
    if (error) throw dbError("save integration config", error);
    return toRow(data);
  },

  /** Deletes the Vault secret and the row. */
  async remove(orgId: string, provider: string): Promise<boolean> {
    const rpc = await dbClient.rpc("delete_integration_secret", { p_org_id: orgId, p_provider: provider });
    if (rpc.error) throw dbError("delete integration secret", rpc.error);
    const { data, error } = await dbClient
      .from("integration_credentials")
      .delete()
      .eq("org_id", orgId)
      .eq("provider", provider)
      .select("id");
    if (error) throw dbError("delete integration credentials", error);
    return (data || []).length > 0;
  },

  /** Records a check result; creates a status-only row for env-backed providers. Returns the previous status. */
  async recordCheck(
    orgId: string,
    provider: string,
    status: IntegrationStatus,
    lastError: string | null
  ): Promise<IntegrationStatus | null> {
    const previous = await integrationsDb.get(orgId, provider);
    const patch = { status, last_error: lastError, last_checked_at: new Date().toISOString() };
    const { error } = previous
      ? await dbClient.from("integration_credentials").update(patch).eq("org_id", orgId).eq("provider", provider)
      : await dbClient
          .from("integration_credentials")
          .upsert({ org_id: orgId, provider, ...patch }, { onConflict: "org_id,provider" });
    if (error) throw dbError("record integration check", error);
    return previous?.status ?? null;
  },

  /** Every org id (health checks cover env-backed providers too). */
  async listOrgIds(limit = 1000): Promise<string[]> {
    const { data, error } = await dbClient.from("organizations").select("id").limit(limit);
    if (error) throw dbError("list organizations", error);
    return (data || []).map((o: { id: string }) => o.id);
  },
};
