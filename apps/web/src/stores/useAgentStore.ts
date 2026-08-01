import { create } from "zustand";
import { AgentStatus } from "@/types";
import { mockAgents } from "@/lib/mockData";
import { agentApi } from "@/services/apiClient";

interface PipelineRun {
  id: string;
  campaignName: string;
  query: string;
  status: string;
  totalLeadsFound: number;
  verifiedLeads: number;
  highScoreLeads: number;
  durationMs: number;
  createdAt: string;
}

interface AgentState {
  agents: AgentStatus[];
  isLoading: boolean;
  activeAgentLogs: { timestamp: string; level: "info" | "warn" | "error"; message: string }[];
  selectedAgent: AgentStatus | null;
  pipelineRuns: PipelineRun[];
  isPipelineRunning: boolean;
  fetchAgents: () => Promise<void>;
  setSelectedAgent: (agent: AgentStatus | null) => void;
  triggerAgent: (id: string, query?: string) => Promise<void>;
  triggerSingleAgent: (id: string, input: Record<string, any>) => Promise<void>;
  fetchPipelineRuns: () => Promise<void>;
  startPipeline: (params: { query: string; industry?: string; category?: string; location?: string; targetCount?: number }) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: mockAgents,
  isLoading: false,
  activeAgentLogs: mockAgents[0]?.logs || [],
  selectedAgent: mockAgents[0] || null,
  pipelineRuns: [],
  isPipelineRunning: false,

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

    const startLog = {
      timestamp,
      level: "info" as const,
      message: `[Live Run Triggered]: Search & analysis started for query "${query}"`,
    };

    set((state) => {
      const updatedAgents = state.agents.map((agt) =>
        agt.id === id
          ? {
              ...agt,
              status: "running" as const,
              runningJobs: agt.runningJobs + 1,
              logs: [startLog, ...agt.logs],
            }
          : agt
      );
      const updatedSelected =
        state.selectedAgent?.id === id
          ? {
              ...state.selectedAgent,
              status: "running" as const,
              runningJobs: state.selectedAgent.runningJobs + 1,
              logs: [startLog, ...state.selectedAgent.logs],
            }
          : state.selectedAgent;

      return {
        agents: updatedAgents,
        selectedAgent: updatedSelected,
        activeAgentLogs: [startLog, ...state.activeAgentLogs],
      };
    });

    const result = await agentApi.triggerAgent(id, query);

    const completionLog = {
      timestamp: new Date().toLocaleTimeString(),
      level: result.success !== false ? ("info" as const) : ("error" as const),
      message:
        result.success !== false
          ? `[Execution Completed]: Discovered ${result.totalLeadsFound || result.processedCount || 3} leads in ${result.durationMs || 220}ms`
          : `[Execution Failed]: ${result.error || "Execution error"}`,
    };

    set((state) => {
      const updatedAgents = state.agents.map((agt) =>
        agt.id === id
          ? {
              ...agt,
              status: "active" as const,
              runningJobs: Math.max(0, agt.runningJobs - 1),
              totalExecutions: agt.totalExecutions + 1,
              logs: [completionLog, ...agt.logs],
            }
          : agt
      );
      const updatedSelected =
        state.selectedAgent?.id === id
          ? {
              ...state.selectedAgent,
              status: "active" as const,
              runningJobs: Math.max(0, state.selectedAgent.runningJobs - 1),
              totalExecutions: state.selectedAgent.totalExecutions + 1,
              logs: [completionLog, ...state.selectedAgent.logs],
            }
          : state.selectedAgent;

      return {
        agents: updatedAgents,
        selectedAgent: updatedSelected,
        activeAgentLogs: [completionLog, ...state.activeAgentLogs],
      };
    });
  },

  triggerSingleAgent: async (id, input) => {
    const timestamp = new Date().toLocaleTimeString();

    const triggerLog = {
      timestamp,
      level: "info" as const,
      message: `[Sarvam AI] Triggered input: ${JSON.stringify(input).substring(0, 80)}`,
    };

    set((state) => {
      const updatedAgents = state.agents.map((agt) =>
        agt.id === id
          ? {
              ...agt,
              status: "running" as const,
              runningJobs: agt.runningJobs + 1,
              logs: [triggerLog, ...agt.logs],
            }
          : agt
      );
      const updatedSelected =
        state.selectedAgent?.id === id
          ? {
              ...state.selectedAgent,
              status: "running" as const,
              runningJobs: state.selectedAgent.runningJobs + 1,
              logs: [triggerLog, ...state.selectedAgent.logs],
            }
          : state.selectedAgent;

      return {
        agents: updatedAgents,
        selectedAgent: updatedSelected,
        activeAgentLogs: [triggerLog, ...state.activeAgentLogs],
      };
    });

    const result = await agentApi.triggerSingleAgent(id, input);

    const endLog = {
      timestamp: new Date().toLocaleTimeString(),
      level: result.success ? ("info" as const) : ("error" as const),
      message: result.success
        ? `[Sarvam AI] Completed in ${result.duration_ms || 0}ms (${result.tokens_used || 0} tokens)`
        : `[Sarvam AI] Error: ${result.error || "Unknown error"}`,
    };

    set((state) => {
      const updatedAgents = state.agents.map((agt) =>
        agt.id === id
          ? {
              ...agt,
              status: result.success ? ("active" as const) : ("error" as const),
              runningJobs: Math.max(0, agt.runningJobs - 1),
              totalExecutions: agt.totalExecutions + 1,
              logs: [endLog, ...agt.logs],
            }
          : agt
      );
      const updatedSelected =
        state.selectedAgent?.id === id
          ? {
              ...state.selectedAgent,
              status: result.success ? ("active" as const) : ("error" as const),
              runningJobs: Math.max(0, state.selectedAgent.runningJobs - 1),
              totalExecutions: state.selectedAgent.totalExecutions + 1,
              logs: [endLog, ...state.selectedAgent.logs],
            }
          : state.selectedAgent;

      return {
        agents: updatedAgents,
        selectedAgent: updatedSelected,
        activeAgentLogs: [endLog, ...state.activeAgentLogs],
      };
    });
  },

  fetchPipelineRuns: async () => {
    const runs = await agentApi.getPipelineRuns();
    set({
      pipelineRuns: runs.map((r: any) => ({
        id: r.id,
        campaignName: r.campaign_name,
        query: r.query,
        status: r.status,
        totalLeadsFound: r.total_leads_found,
        verifiedLeads: r.verified_leads,
        highScoreLeads: r.high_score_leads,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
      })),
    });
  },

  startPipeline: async (params) => {
    set({ isPipelineRunning: true });

    const timestamp = new Date().toLocaleTimeString();

    const startPipelineLog = {
      timestamp,
      level: "info" as const,
      message: `[Pipeline] Starting lead pipeline: "${params.query}" (${params.category || "B2B"})`,
    };

    set((state) => ({
      activeAgentLogs: [startPipelineLog, ...state.activeAgentLogs],
    }));

    try {
      const result = await agentApi.triggerAgent("agt-orchestrator", params.query);

      const endPipelineLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: "info" as const,
        message: `[Pipeline] Completed! ${result.totalLeadsFound || result.processedCount || 0} leads processed in ${result.durationMs || 0}ms`,
      };

      set((state) => ({
        isPipelineRunning: false,
        activeAgentLogs: [endPipelineLog, ...state.activeAgentLogs],
      }));

      get().fetchPipelineRuns();
    } catch (err: any) {
      const errPipelineLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: "error" as const,
        message: `[Pipeline] Failed: ${err?.message || "Unknown error"}`,
      };

      set((state) => ({
        isPipelineRunning: false,
        activeAgentLogs: [errPipelineLog, ...state.activeAgentLogs],
      }));
    }
  },
}));
