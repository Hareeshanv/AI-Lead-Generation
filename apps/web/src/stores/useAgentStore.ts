import { create } from "zustand";
import { AgentStatus } from "@/types";
import { mockAgents } from "@/lib/mockData";
import { agentApi } from "@/services/apiClient";
import { useLeadStore } from "@/stores/useLeadStore";

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
    
    // Update local state immediately for UI responsiveness
    set((state) => {
      const updatedAgents = state.agents.map((agt) =>
        agt.id === id
          ? {
              ...agt,
              status: "running" as const,
              runningJobs: agt.runningJobs + 1,
              logs: [
                {
                  timestamp,
                  level: "info" as const,
                  message: `[Live Run Triggered]: Pipeline started for query "${query}"`,
                },
                ...agt.logs,
              ],
            }
          : agt
      );
      const updatedSelected = updatedAgents.find((a) => a.id === state.selectedAgent?.id) || state.selectedAgent;
      return {
        agents: updatedAgents,
        selectedAgent: updatedSelected,
        activeAgentLogs: [
          {
            timestamp,
            level: "info" as const,
            message: `[Live Run Triggered]: Pipeline started for query "${query}"`,
          },
          ...state.activeAgentLogs,
        ],
      };
    });

    // Trigger backend API and handle response
    try {
      const result = await agentApi.triggerAgent(id, query);
      const doneTimestamp = new Date().toLocaleTimeString();

      const resultLogs: { timestamp: string; level: "info" | "warn" | "error"; message: string }[] = [
        {
          timestamp: doneTimestamp,
          level: "info",
          message: `[Pipeline Complete] ✅ ${result.totalLeadsFound || 0} leads found, ${result.verifiedLeads || 0} verified, ${result.highScoreLeads || 0} high-score`,
        },
        {
          timestamp: doneTimestamp,
          level: "info",
          message: `[Pipeline Stats] 📧 ${result.emailsGenerated || 0} emails generated | ⏱ ${result.durationMs || 0}ms | CRM synced: ${result.crmSynced || 0}`,
        },
      ];

      // Add individual lead summaries (up to 5)
      if (result.leads && result.leads.length > 0) {
        result.leads.slice(0, 5).forEach((lead: any, i: number) => {
          resultLogs.push({
            timestamp: doneTimestamp,
            level: "info",
            message: `[Lead ${i + 1}] ${lead.name} — ${lead.title} @ ${lead.company} (Score: ${lead.score}, ${lead.status})`,
          });
        });
      }

      set((state) => {
        const updatedAgents = state.agents.map((agt) =>
          agt.id === id
            ? {
                ...agt,
                status: "active" as const,
                runningJobs: Math.max(0, agt.runningJobs - 1),
                totalExecutions: agt.totalExecutions + 1,
                logs: [...resultLogs, ...agt.logs],
              }
            : agt
        );
        const updatedSelected = updatedAgents.find((a) => a.id === state.selectedAgent?.id) || state.selectedAgent;
        return {
          agents: updatedAgents,
          selectedAgent: updatedSelected,
          activeAgentLogs: [...resultLogs, ...state.activeAgentLogs],
        };
      });

      // Auto-refresh the leads table so new leads appear immediately with the AI Answer Banner
      try {
        const answer = result.specificAnswer || result.searchSummary || null;
        if (Array.isArray(result.leads) && result.leads.length > 0) {
          useLeadStore.setState({ leads: result.leads, specificAnswer: answer });
        } else {
          await useLeadStore.getState().fetchLeads();
          if (answer) {
            useLeadStore.setState({ specificAnswer: answer });
          }
        }
      } catch { /* leads refresh is best-effort */ }
    } catch (err: any) {
      const errorTimestamp = new Date().toLocaleTimeString();
      set((state) => {
        const updatedAgents = state.agents.map((agt) =>
          agt.id === id
            ? {
                ...agt,
                status: "error" as const,
                runningJobs: Math.max(0, agt.runningJobs - 1),
                logs: [
                  {
                    timestamp: errorTimestamp,
                    level: "error" as const,
                    message: `[Pipeline Error] ❌ ${err?.message || "Unknown error occurred"}`,
                  },
                  ...agt.logs,
                ],
              }
            : agt
        );
        const updatedSelected = updatedAgents.find((a) => a.id === state.selectedAgent?.id) || state.selectedAgent;
        return {
          agents: updatedAgents,
          selectedAgent: updatedSelected,
          activeAgentLogs: [
            {
              timestamp: errorTimestamp,
              level: "error" as const,
              message: `[Pipeline Error] ❌ ${err?.message || "Unknown error occurred"}`,
            },
            ...state.activeAgentLogs,
          ],
        };
      });
    }
  },

  triggerSingleAgent: async (id, input) => {
    const timestamp = new Date().toLocaleTimeString();
    
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
                  message: `[Sarvam AI] Agent triggered with input: ${JSON.stringify(input).substring(0, 100)}`,
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
          message: `[Sarvam AI] Agent ${id} triggered individually`,
        },
        ...get().activeAgentLogs,
      ],
    }));

    const result = await agentApi.triggerSingleAgent(id, input);

    // Update with result
    set((state) => ({
      agents: state.agents.map((agt) =>
        agt.id === id
          ? {
              ...agt,
              status: result.success ? "active" : "error",
              runningJobs: Math.max(0, agt.runningJobs - 1),
              totalExecutions: agt.totalExecutions + 1,
              logs: [
                {
                  timestamp: new Date().toLocaleTimeString(),
                  level: result.success ? "info" : "error",
                  message: result.success
                    ? `[Sarvam AI] Completed in ${result.duration_ms || 0}ms (${result.tokens_used || 0} tokens)`
                    : `[Sarvam AI] Error: ${result.error || "Unknown error"}`,
                },
                ...agt.logs,
              ],
            }
          : agt
      ),
    }));
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

    // Add log entries for pipeline start
    set((state) => ({
      activeAgentLogs: [
        {
          timestamp,
          level: "info",
          message: `[Pipeline] Starting full lead generation pipeline: "${params.query}" (${params.category || "B2B"})`,
        },
        ...state.activeAgentLogs,
      ],
    }));

    try {
      const result = await agentApi.triggerAgent("agt-orchestrator", params.query);

      set((state) => ({
        isPipelineRunning: false,
        activeAgentLogs: [
          {
            timestamp: new Date().toLocaleTimeString(),
            level: "info",
            message: `[Pipeline] Completed! ${result.totalLeadsFound || result.processedCount || 0} leads processed in ${result.durationMs || 0}ms`,
          },
          ...state.activeAgentLogs,
        ],
      }));

      // Auto-refresh the leads table so new leads appear immediately with AI Answer Banner
      try {
        const answer = result.specificAnswer || result.searchSummary || null;
        if (Array.isArray(result.leads) && result.leads.length > 0) {
          useLeadStore.setState({ leads: result.leads, specificAnswer: answer });
        } else {
          await useLeadStore.getState().fetchLeads();
          if (answer) {
            useLeadStore.setState({ specificAnswer: answer });
          }
        }
      } catch { /* leads refresh is best-effort */ }

      // Refresh pipeline runs list
      get().fetchPipelineRuns();
    } catch (err: any) {
      set((state) => ({
        isPipelineRunning: false,
        activeAgentLogs: [
          {
            timestamp: new Date().toLocaleTimeString(),
            level: "error",
            message: `[Pipeline] Failed: ${err?.message || "Unknown error"}`,
          },
          ...state.activeAgentLogs,
        ],
      }));
    }
  },
}));
