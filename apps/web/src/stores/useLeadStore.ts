import { create } from "zustand";
import { Lead } from "@/types";
import { mockLeads } from "@/lib/mockData";
import { leadApi } from "@/services/apiClient";

interface LeadState {
  leads: Lead[];
  isLoading: boolean;
  searchQuery: string;
  selectedStatus: string;
  selectedLead: Lead | null;
  fetchLeads: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedStatus: (status: string) => void;
  setSelectedLead: (lead: Lead | null) => void;
  addLead: (lead: Partial<Lead>) => Promise<void>;
  updateLeadScore: (id: string, newScore: number) => void;
  deleteLead: (id: string) => Promise<void>;
}

export const useLeadStore = create<LeadState>((set) => ({
  leads: mockLeads,
  isLoading: false,
  searchQuery: "",
  selectedStatus: "All",
  selectedLead: null,
  fetchLeads: async () => {
    set({ isLoading: true });
    const fetchedLeads = await leadApi.getLeads();
    set({ leads: fetchedLeads, isLoading: false });
  },
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedStatus: (status) => set({ selectedStatus: status }),
  setSelectedLead: (lead) => set({ selectedLead: lead }),
  addLead: async (newLeadData) => {
    const created = await leadApi.createLead(newLeadData);
    set((state) => ({ leads: [created, ...state.leads] }));
  },
  updateLeadScore: (id, newScore) =>
    set((state) => ({
      leads: state.leads.map((l) => (l.id === id ? { ...l, score: newScore } : l)),
    })),
  deleteLead: async (id) => {
    await leadApi.deleteLead(id);
    set((state) => ({
      leads: state.leads.filter((l) => l.id !== id),
    }));
  },
}));
