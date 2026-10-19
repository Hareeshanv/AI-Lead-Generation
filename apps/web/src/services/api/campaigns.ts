import { deleteData, enc, getData, getPage, patchData, postData, putData } from "./http";
import type {
  AddLeadsToCampaignResult,
  AudiencePreview,
  Campaign,
  CampaignAudienceFilter,
  CampaignChannel,
  CampaignDetail,
  CampaignFunnelStage,
  CampaignInput,
  CampaignRecipient,
  CampaignStats,
  CampaignStatus,
  CampaignStep,
  CampaignStepInput,
  LaunchCampaignResult,
  PageParams,
  RecipientStatus,
} from "@/types";

export interface CampaignListParams extends PageParams {
  status?: CampaignStatus;
  channel?: CampaignChannel;
}

export interface RecipientListParams extends PageParams {
  status?: RecipientStatus;
}

/** Owned by the Campaigns module. */
export const campaignApi = {
  list: (params: CampaignListParams = {}) => getPage<Campaign>("/campaigns", { ...params }),
  get: (id: string) => getData<CampaignDetail>(`/campaigns/${enc(id)}`),
  create: (input: CampaignInput) => postData<CampaignDetail>("/campaigns", input),
  update: (id: string, patch: Partial<CampaignInput>) => patchData<CampaignDetail>(`/campaigns/${enc(id)}`, patch),
  remove: (id: string) => deleteData(`/campaigns/${enc(id)}`),
  replaceSteps: (id: string, steps: CampaignStepInput[]) => putData<CampaignStep[]>(`/campaigns/${enc(id)}/steps`, { steps }),
  previewAudience: (channel: CampaignChannel, audienceFilter: CampaignAudienceFilter, campaignId?: string | null) =>
    postData<AudiencePreview>("/campaigns/audience/preview", { channel, audienceFilter, campaignId: campaignId ?? null }),
  addLeads: (id: string, leadIds: string[]) => postData<AddLeadsToCampaignResult>(`/campaigns/${enc(id)}/leads`, { leadIds }),
  recipients: (id: string, params: RecipientListParams = {}) =>
    getPage<CampaignRecipient>(`/campaigns/${enc(id)}/recipients`, { ...params }),
  removeRecipient: (id: string, recipientId: string) => deleteData(`/campaigns/${enc(id)}/recipients/${enc(recipientId)}`),
  markReplied: (id: string, recipientId: string) =>
    postData<{ ok: true }>(`/campaigns/${enc(id)}/recipients/${enc(recipientId)}/replied`),
  stats: (id: string) => getData<{ stats: CampaignStats; funnel: CampaignFunnelStage[] }>(`/campaigns/${enc(id)}/stats`),
  launch: (id: string) => postData<LaunchCampaignResult>(`/campaigns/${enc(id)}/launch`),
  pause: (id: string) => postData<CampaignDetail>(`/campaigns/${enc(id)}/pause`),
  resume: (id: string) => postData<CampaignDetail>(`/campaigns/${enc(id)}/resume`),
};
