import { create } from "zustand";
import { Campaign } from "@/types";
import { mockCampaigns } from "@/lib/mockData";

interface CampaignState {
  campaigns: Campaign[];
  addCampaign: (campaign: Campaign) => void;
  toggleCampaignStatus: (id: string) => void;
}

export const useCampaignStore = create<CampaignState>((set) => ({
  campaigns: mockCampaigns,
  addCampaign: (campaign) => set((state) => ({ campaigns: [campaign, ...state.campaigns] })),
  toggleCampaignStatus: (id) =>
    set((state) => ({
      campaigns: state.campaigns.map((c) =>
        c.id === id ? { ...c, status: c.status === "Active" ? "Paused" : "Active" } : c
      ),
    })),
}));
