import { create } from "zustand";
import { AgentStatus } from "@/types";
import { mockAgents } from "@/lib/mockData";

interface AgentState {
  agents: AgentStatus[];
  activeAgentLogs: { timestamp: string; level: "info" | "warn" | "error"; message: string }[];
  selectedAgent: AgentStatus | null;
  setSelectedAgent: (agent: AgentStatus | null) => void;
  triggerAgent: (id: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: mockAgents,
  activeAgentLogs: mockAgents[0]?.logs || [],
  selectedAgent: mockAgents[0] || null,
  setSelectedAgent: (agent) =>
    set({
      selectedAgent: agent,
      activeAgentLogs: agent ? agent.logs : [],
    }),
  triggerAgent: (id) =>
    set((state) => ({
      agents: state.agents.map((agt) =>
        agt.id === id
          ? {
              ...agt,
              status: "running",
              runningJobs: agt.runningJobs + 1,
              logs: [
                {
                  timestamp: new Date().toLocaleTimeString(),
                  level: "info",
                  message: `Triggered execution run for ${agt.name}`,
                },
                ...agt.logs,
              ],
            }
          : agt
      ),
    })),
}));
