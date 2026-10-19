import { useQuery } from "@tanstack/react-query";
import { integrationApi } from "@/services/api";
import { notifyError, notifySuccess } from "@/lib/toast";
import type { GoogleSourceCreated, IntegrationCheckResult, IntegrationProvider } from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

const overviewKey = [...queryKeys.integrations.all, "overview"] as const;

export function useIntegrations() {
  return useQuery({ queryKey: overviewKey, queryFn: integrationApi.list });
}

function reportCheck(result: IntegrationCheckResult, savedPrefix?: string) {
  const name = result.integration.name;
  if (result.check.ok) notifySuccess(`${savedPrefix ?? ""}${name} is connected`, result.check.message);
  else notifyError(new Error(`${savedPrefix ?? ""}${name} check failed: ${result.check.message}`));
}

export function useSaveIntegration() {
  return useApiMutation<IntegrationCheckResult, { provider: IntegrationProvider; credentials: Record<string, string> }>({
    mutationFn: ({ provider, credentials }) => integrationApi.save(provider, credentials),
    invalidate: [queryKeys.integrations.all],
    onSuccess: (result) => reportCheck(result, "Saved. "),
  });
}

export function useTestIntegration() {
  return useApiMutation<IntegrationCheckResult, IntegrationProvider>({
    mutationFn: integrationApi.test,
    invalidate: [queryKeys.integrations.all],
    onSuccess: (result) => reportCheck(result),
  });
}

export function useDisconnectIntegration() {
  return useApiMutation<void, IntegrationProvider>({
    mutationFn: integrationApi.disconnect,
    invalidate: [queryKeys.integrations.all],
    successMessage: "Saved credentials removed",
  });
}

export function useRemoveLeadSource() {
  return useApiMutation<void, string>({
    mutationFn: integrationApi.removeSource,
    invalidate: [queryKeys.integrations.all],
    successMessage: "Lead source disconnected",
  });
}

export function useCreateGoogleSource() {
  return useApiMutation<GoogleSourceCreated, string | undefined>({
    mutationFn: integrationApi.createGoogle,
    invalidate: [queryKeys.integrations.all],
    successMessage: "Google Ads webhook created",
  });
}
