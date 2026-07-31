import { create } from "zustand";
import { AgentStatus } from "@/types";
import { mockAgents } from "@/lib/mockData";
import { agentApi } from "@/services/apiClient";

interface AgentState {
  agents: AgentStatus[];
  isLoading: boolean;
  activeAgentLogs: { timestamp: string; level: "info" | "warn" | "error"; message: string }[];
  selectedAgent: AgentStatus | null;
  fetchAgents: () => Promise<void>;
  setSelectedAgent: (agent: AgentStatus | null) => void;
  triggerAgent: (id: string, query?: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: mockAgents,
  isLoading: false,
  activeAgentLogs: mockAgents[0]?.logs || [],
  selectedAgent: mockAgents[0] || null,
  fetchAgents: async () => {
    set({ isLoading: true });
    const fetchedAgents = await agentApi.getAgents();
    set({
      agents: fetchedAgents,
      selectedAgent: get().selectedAgent || fetchedAgents[0] || null,
      activeAgentLogs: fetchedAgents[0]?.logs || [],
      isLoading: false,
    });
  },
  setSelectedAgent: (agent) =>
    set({
      selectedAgent: agent,
      activeAgentLogs: agent ? agent.logs : [],
    }),
  triggerAgent: async (id, query = "Enterprise AI prospects") => {
    const timestamp = new Date().toLocaleTimeString();
    
    // Update local state immediately for UI responsiveness
    set((state) => ({
      agents: state.agents.map((agt) =>
        agt.id === id
          ? {
              ...agt,
              status: "running",
              runningJobs: agt.runningJobs + 1,
              logs: [
                {
                  timestamp,
                  level: "info",
                  message: `[Live Run Triggered]: Executive search and enrichment started for query "${query}"`,
                },
                ...agt.logs,
              ],
            }
          : agt
      ),
      activeAgentLogs: [
        {
          timestamp,
          level: "info",
          message: `[Live Run Triggered]: Executive search and enrichment started for query "${query}"`,
        },
        ...get().activeAgentLogs,
      ],
    }));

    // Trigger backend API
    await agentApi.triggerAgent(id, query);
  },
}));
