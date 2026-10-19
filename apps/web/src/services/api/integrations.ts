import { deleteData, enc, getData, postData, putData } from "./http";
import type {
  GoogleSourceCreated,
  IntegrationCheckResult,
  IntegrationProvider,
  IntegrationsOverview,
  LeadSourceIntegration,
  ProviderIntegration,
} from "@/types";
import type { LeadSourceRow } from "./rows";

const mapLeadSource = (s: LeadSourceRow): LeadSourceIntegration => ({
  id: s.id,
  platform: s.platform,
  pageName: s.pageName ?? null,
  externalPageId: s.externalPageId ?? null,
  formIds: Array.isArray(s.formIds) ? s.formIds : [],
  status: s.status ?? "unknown",
  lastLeadAt: s.lastLeadAt ?? null,
  createdAt: s.createdAt ?? new Date().toISOString(),
  webhookUrl: s.webhookUrl ?? undefined,
});

/** Owned by the Integrations module. */
export const integrationApi = {
  list: async (): Promise<IntegrationsOverview> => {
    const data = await getData<Omit<IntegrationsOverview, "sources"> & { sources?: LeadSourceRow[] }>("/integrations");
    return {
      providers: data.providers ?? [],
      sources: (data.sources ?? []).map(mapLeadSource),
      metaConfigured: Boolean(data.metaConfigured),
      metaWebhookUrl: data.metaWebhookUrl ?? null,
    };
  },

  /** Saves credentials (blank secret fields keep the stored value) and validates them live. Admin only. */
  save: (provider: IntegrationProvider, credentials: Record<string, string>) =>
    putData<IntegrationCheckResult>(`/integrations/${enc(provider)}`, { credentials }),

  test: (provider: IntegrationProvider) => postData<IntegrationCheckResult>(`/integrations/${enc(provider)}/test`),

  disconnect: (provider: IntegrationProvider) => deleteData(`/integrations/${enc(provider)}`),

  get: (provider: IntegrationProvider) => getData<ProviderIntegration>(`/integrations/${enc(provider)}`),

  /** Signed, short-lived Facebook Login URL bound to the current user and workspace (admin only). */
  getMetaConnectUrl: async (): Promise<string> => (await postData<{ url: string }>("/integrations/meta/connect-url")).url,

  createGoogle: async (name?: string): Promise<GoogleSourceCreated> => {
    const data = await postData<Omit<GoogleSourceCreated, "source"> & { source: LeadSourceRow }>("/integrations/google", name ? { name } : {});
    return { ...data, source: mapLeadSource(data.source) };
  },

  removeSource: (id: string) => deleteData(`/integrations/${enc(id)}`),
};
