import { create } from "zustand";
import { Deal } from "@/types";
import { mockDeals } from "@/lib/mockData";
import { crmApi } from "@/services/apiClient";

interface CRMState {
  deals: Deal[];
  isLoading: boolean;
  fetchDeals: () => Promise<void>;
  updateDealStage: (id: string, stage: Deal["stage"]) => Promise<void>;
  addDeal: (deal: Deal) => void;
}

export const useCRMStore = create<CRMState>((set) => ({
  deals: mockDeals,
  isLoading: false,
  fetchDeals: async () => {
    set({ isLoading: true });
    const fetchedDeals = await crmApi.getDeals();
    set({ deals: fetchedDeals, isLoading: false });
  },
  updateDealStage: async (id, stage) => {
    set((state) => ({
      deals: state.deals.map((d) => (d.id === id ? { ...d, stage } : d)),
    }));
    await crmApi.updateStage(id, stage);
  },
  addDeal: (deal) => set((state) => ({ deals: [deal, ...state.deals] })),
}));
