import { create } from "zustand";
import { Deal } from "@/types";
import { mockDeals } from "@/lib/mockData";

interface CRMState {
  deals: Deal[];
  updateDealStage: (id: string, stage: Deal["stage"]) => void;
  addDeal: (deal: Deal) => void;
}

export const useCRMStore = create<CRMState>((set) => ({
  deals: mockDeals,
  updateDealStage: (id, stage) =>
    set((state) => ({
      deals: state.deals.map((d) => (d.id === id ? { ...d, stage } : d)),
    })),
  addDeal: (deal) => set((state) => ({ deals: [deal, ...state.deals] })),
}));
