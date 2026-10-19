import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { agentApi, isActiveRun } from "@/services/api";
import type { AgentRun, ConvertSignalsResult, Lead, StartAgentRunInput } from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

const RUN_POLL_MS = 3_000;
const IDLE_POLL_MS = 15_000;

export const agentKeys = {
  all: queryKeys.agents.all,
  list: () => [...queryKeys.agents.all, "list"] as const,
  detail: (id: string) => [...queryKeys.agents.all, "detail", id] as const,
  runs: (id: string, page: number, pageSize: number) => [...queryKeys.agents.all, "runs", id, page, pageSize] as const,
  run: (id: string, runId: string) => [...queryKeys.agents.all, "run", id, runId] as const,
  logs: (id: string, runId?: string | null) => [...queryKeys.agents.all, "logs", id, runId ?? "all"] as const,
};

export function useAgent(id: string) {
  return useQuery({
    queryKey: agentKeys.detail(id),
    queryFn: () => agentApi.get(id),
    refetchInterval: (query) => (query.state.data?.status === "running" ? RUN_POLL_MS : false),
  });
}

/** Run history; polls while any run on the page is queued or running. */
export function useAgentRuns(id: string, page: number, pageSize = 10) {
  return useQuery({
    queryKey: agentKeys.runs(id, page, pageSize),
    queryFn: () => agentApi.runs(id, { page, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.data.some(isActiveRun) ? RUN_POLL_MS : false),
  });
}

/** One run with steps and results; polls until it finishes. */
export function useAgentRun(id: string, runId: string | null) {
  return useQuery({
    queryKey: agentKeys.run(id, runId ?? ""),
    queryFn: () => agentApi.run(id, runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => (query.state.data && isActiveRun(query.state.data.run) ? RUN_POLL_MS : false),
  });
}

export function useAgentLogs(id: string, runId: string | null, live: boolean) {
  return useQuery({
    queryKey: agentKeys.logs(id, runId),
    queryFn: () => agentApi.logs(id, { limit: 200, runId: runId ?? undefined }),
    refetchInterval: live ? RUN_POLL_MS : IDLE_POLL_MS,
  });
}

export function useStartAgentRun(id: string, onStarted?: (run: AgentRun) => void) {
  return useApiMutation<AgentRun, StartAgentRunInput>({
    mutationFn: (input) => agentApi.startRun(id, input),
    invalidate: [queryKeys.agents.all],
    successMessage: "Discovery run started. Results appear here as soon as it finishes.",
    onSuccess: (run) => onStarted?.(run),
  });
}

export function useConvertSignals() {
  return useApiMutation<ConvertSignalsResult, string[]>({
    mutationFn: agentApi.convertSignals,
    invalidate: [queryKeys.agents.all, queryKeys.leads.all],
    successMessage: (r) =>
      r.created + r.existing === 0
        ? "No signals were converted"
        : `${r.created} lead${r.created === 1 ? "" : "s"} created${r.existing ? `, ${r.existing} already existed` : ""}`,
  });
}

/** One POST /api/deals per lead; partial failures are reported in the success toast. */
export function useCreateDealsForLeads() {
  return useApiMutation<{ created: number; failed: number }, Pick<Lead, "id" | "name" | "company">[]>({
    mutationFn: async (leads) => {
      const results = await Promise.allSettled(leads.map((l) => agentApi.createDealForLead(l)));
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      if (failed.length === leads.length) throw failed[0].reason;
      return { created: leads.length - failed.length, failed: failed.length };
    },
    invalidate: [queryKeys.deals.all],
    successMessage: (r) =>
      `${r.created} deal${r.created === 1 ? "" : "s"} created${r.failed ? ` (${r.failed} failed)` : ""}`,
  });
}
