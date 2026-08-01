import { create } from "zustand";
import { Campaign } from "@/types";
import { mockCampaigns } from "@/lib/mockData";
import { campaignApi } from "@/services/apiClient";

interface CampaignState {
  campaigns: Campaign[];
  isLoading: boolean;
  fetchCampaigns: () => Promise<void>;
  addCampaign: (campaign: Campaign) => void;
  toggleCampaignStatus: (id: string) => void;
}

export const useCampaignStore = create<CampaignState>((set) => ({
  campaigns: mockCampaigns,
  isLoading: false,
  fetchCampaigns: async () => {
    set({ isLoading: true });
    const fetched = await campaignApi.getCampaigns();
    set({ campaigns: fetched, isLoading: false });
  },
  addCampaign: (campaign) => set((state) => ({ campaigns: [campaign, ...state.campaigns] })),
  toggleCampaignStatus: (id) =>
    set((state) => ({
      campaigns: state.campaigns.map((c) =>
        c.id === id ? { ...c, status: c.status === "Active" ? "Paused" : "Active" } : c
      ),
    })),
}));
