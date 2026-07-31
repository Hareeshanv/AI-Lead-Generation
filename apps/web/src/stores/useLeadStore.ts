import { create } from "zustand";
import { Lead } from "@/types";
import { mockLeads } from "@/lib/mockData";

interface LeadState {
  leads: Lead[];
  searchQuery: string;
  selectedStatus: string;
  selectedLead: Lead | null;
  setSearchQuery: (query: string) => void;
  setSelectedStatus: (status: string) => void;
  setSelectedLead: (lead: Lead | null) => void;
  addLead: (lead: Lead) => void;
  updateLeadScore: (id: string, newScore: number) => void;
  deleteLead: (id: string) => void;
}

export const useLeadStore = create<LeadState>((set) => ({
  leads: mockLeads,
  searchQuery: "",
  selectedStatus: "All",
  selectedLead: null,
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedStatus: (status) => set({ selectedStatus: status }),
  setSelectedLead: (lead) => set({ selectedLead: lead }),
  addLead: (newLead) => set((state) => ({ leads: [newLead, ...state.leads] })),
  updateLeadScore: (id, newScore) =>
    set((state) => ({
      leads: state.leads.map((l) => (l.id === id ? { ...l, score: newScore } : l)),
    })),
  deleteLead: (id) =>
    set((state) => ({
      leads: state.leads.filter((l) => l.id !== id),
    })),
}));
