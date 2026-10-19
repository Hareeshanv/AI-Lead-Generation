import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { campaignApi, type CampaignListParams, type RecipientListParams } from "@/services/api";
import type {
  AddLeadsToCampaignResult,
  CampaignAudienceFilter,
  CampaignChannel,
  CampaignDetail,
  CampaignInput,
  LaunchCampaignResult,
} from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

const RUNNING_REFETCH_MS = 15_000;

export function useCampaigns(params: CampaignListParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.campaigns.list(params),
    queryFn: () => campaignApi.list(params),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Polls while the campaign is sending so stats and recipient states stay current. */
export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.campaigns.detail(id ?? ""),
    queryFn: () => campaignApi.get(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "active" || status === "scheduled" ? RUNNING_REFETCH_MS : false;
    },
  });
}

export function useCampaignRecipients(id: string | undefined, params: RecipientListParams, live = false) {
  return useQuery({
    queryKey: queryKeys.campaigns.recipients(id ?? "", params),
    queryFn: () => campaignApi.recipients(id!, params),
    enabled: !!id,
    placeholderData: keepPreviousData,
    refetchInterval: live ? RUNNING_REFETCH_MS : false,
  });
}

export function useAudiencePreview(
  channel: CampaignChannel,
  audienceFilter: CampaignAudienceFilter,
  campaignId?: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.campaigns.preview({ channel, audienceFilter, campaignId: campaignId ?? null }),
    queryFn: () => campaignApi.previewAudience(channel, audienceFilter, campaignId),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCreateCampaign() {
  return useApiMutation<CampaignDetail, CampaignInput>({
    mutationFn: campaignApi.create,
    invalidate: [queryKeys.campaigns.all],
    successMessage: (c) => `Campaign "${c.name}" saved as a draft`,
  });
}

export function useUpdateCampaign() {
  return useApiMutation<CampaignDetail, { id: string; patch: Partial<CampaignInput> }>({
    mutationFn: ({ id, patch }) => campaignApi.update(id, patch),
    invalidate: [queryKeys.campaigns.all],
    successMessage: "Campaign saved",
  });
}

export function useDeleteCampaign() {
  return useApiMutation<void, string>({
    mutationFn: campaignApi.remove,
    invalidate: [queryKeys.campaigns.all],
    successMessage: "Campaign deleted",
  });
}

export function useLaunchCampaign() {
  return useApiMutation<LaunchCampaignResult, string>({
    mutationFn: campaignApi.launch,
    invalidate: [queryKeys.campaigns.all],
    successMessage: (r) =>
      `${r.campaign.status === "scheduled" ? "Scheduled" : "Launched"} to ${r.recipients} recipient${r.recipients === 1 ? "" : "s"}` +
      (r.skipped > 0 ? ` (${r.skipped} skipped)` : ""),
  });
}

export function usePauseCampaign() {
  return useApiMutation<CampaignDetail, string>({
    mutationFn: campaignApi.pause,
    invalidate: [queryKeys.campaigns.all],
    successMessage: "Campaign paused",
  });
}

export function useResumeCampaign() {
  return useApiMutation<CampaignDetail, string>({
    mutationFn: campaignApi.resume,
    invalidate: [queryKeys.campaigns.all],
    successMessage: "Campaign resumed",
  });
}

export function useAddLeadsToCampaign() {
  return useApiMutation<AddLeadsToCampaignResult, { id: string; leadIds: string[] }>({
    mutationFn: ({ id, leadIds }) => campaignApi.addLeads(id, leadIds),
    invalidate: [queryKeys.campaigns.all],
    successMessage: (r) => {
      const parts = [`Added ${r.added} lead${r.added === 1 ? "" : "s"}`];
      if (r.alreadyInCampaign) parts.push(`${r.alreadyInCampaign} already in the campaign`);
      if (r.skipped) parts.push(`${r.skipped} not eligible`);
      return parts.join(", ");
    },
  });
}

export function useRemoveRecipient() {
  return useApiMutation<void, { id: string; recipientId: string }>({
    mutationFn: ({ id, recipientId }) => campaignApi.removeRecipient(id, recipientId),
    invalidate: [queryKeys.campaigns.all],
    successMessage: "Recipient removed",
  });
}

export function useMarkRecipientReplied() {
  return useApiMutation<{ ok: true }, { id: string; recipientId: string }>({
    mutationFn: ({ id, recipientId }) => campaignApi.markReplied(id, recipientId),
    invalidate: [queryKeys.campaigns.all],
    successMessage: "Marked as replied; the sequence stopped for this lead",
  });
}
