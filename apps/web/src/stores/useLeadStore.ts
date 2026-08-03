import { create } from "zustand";
import { Lead } from "@/types";
import { leadApi, agentApi } from "@/services/apiClient";

interface LeadState {
  leads: Lead[];
  isLoading: boolean;
  searchQuery: string;
  selectedStatus: string;
  selectedLead: Lead | null;
  specificAnswer: string | null;
  lastQuery: string | null;
  fetchLeads: () => Promise<void>;
  runPipeline: (query: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedStatus: (status: string) => void;
  setSelectedLead: (lead: Lead | null) => void;
  addLead: (lead: Partial<Lead>) => Promise<void>;
  updateLeadScore: (id: string, newScore: number) => void;
  deleteLead: (id: string) => Promise<void>;
}

export const useLeadStore = create<LeadState>((set) => ({
  leads: [],
  isLoading: false,
  searchQuery: "",
  selectedStatus: "All",
  selectedLead: null,
  specificAnswer: null,
  lastQuery: null,
  fetchLeads: async () => {
    set({ isLoading: true });
    const fetchedLeads = await leadApi.getLeads();
    set({ leads: fetchedLeads, isLoading: false });
  },
  // Trigger the agents pipeline for a given query and wait for persistence
  runPipeline: async (query: string) => {
    set({ isLoading: true, lastQuery: query, specificAnswer: null });
    try {
      const resp = await agentApi.triggerAgent(undefined as any, query);
      if (!resp || resp.success === false) {
        console.warn("Pipeline trigger failed or returned simulated response", resp?.error || resp);
        set({ isLoading: false });
        return;
      }

      const answer = resp.specificAnswer || resp.searchSummary || null;

      // If pipeline returned leads directly, use them
      if (Array.isArray(resp.leads) && resp.leads.length > 0) {
        set({ leads: resp.leads, specificAnswer: answer, isLoading: false });
        return;
      }

      // If pipeline provided a run id, poll for completion
      const runId = resp.pipelineRunId || resp.runId || resp.id;
      if (runId) {
        const pollInterval = 2000;
        const timeoutMs = 30000; // 30s
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          // eslint-disable-next-line no-await-in-loop
          const detail = await agentApi.getPipelineRunDetail(runId);
          if (detail && detail.run && detail.run.status === "completed") {
            const fetchedLeads = await leadApi.getLeads();
            set({ leads: fetchedLeads, specificAnswer: answer, isLoading: false });
            return;
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, pollInterval));
        }

        const fetchedLeads = await leadApi.getLeads();
        set({ leads: fetchedLeads, specificAnswer: answer, isLoading: false });
        return;
      }

      const fetchedLeads = await leadApi.getLeads();
      set({ leads: fetchedLeads, specificAnswer: answer, isLoading: false });
    } catch (err) {
      console.warn("runPipeline error:", err);
      set({ isLoading: false });
    }
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
