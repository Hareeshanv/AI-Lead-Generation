import type { LeadSourcePlatform } from "./leads";

export interface LeadSourceIntegration {
  id: string;
  platform: LeadSourcePlatform;
  pageName: string | null;
  externalPageId: string | null;
  formIds: string[];
  status: string;
  lastLeadAt: string | null;
  createdAt: string;
  webhookUrl?: string;
}

export type IntegrationProvider = "resend" | "whatsapp" | "serper" | "sarvam" | "slack" | "webhook" | "meta";
export type IntegrationStatus = "connected" | "not_configured" | "error";
export type IntegrationCategory = "messaging" | "data" | "ai" | "notifications" | "lead_source";

export interface IntegrationField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder: string | null;
  help: string | null;
  /** Plain value for non-secret fields; a masked hint (e.g. "••••abcd") for secrets; null when unset. */
  value: string | null;
}

export interface ProviderIntegration {
  provider: IntegrationProvider;
  name: string;
  description: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  /** "vault" = saved for this workspace; "env" = server environment fallback. */
  source: "vault" | "env" | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
  fields: IntegrationField[];
}

export interface IntegrationsOverview {
  providers: ProviderIntegration[];
  sources: LeadSourceIntegration[];
  metaConfigured: boolean;
}

export interface IntegrationCheck {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface IntegrationCheckResult {
  integration: ProviderIntegration;
  check: IntegrationCheck;
}

export interface GoogleSourceCreated {
  source: LeadSourceIntegration;
  webhookUrl: string;
  webhookKey: string;
}
