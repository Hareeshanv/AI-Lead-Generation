import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { workflowApi } from "@/services/api";
import type { Workflow, WorkflowInput, WorkflowRun, WorkflowRunListParams, WorkflowTestInput } from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

const workflowKeys = {
  list: [...queryKeys.workflows.all, "list"] as const,
  detail: (id: string) => [...queryKeys.workflows.all, "detail", id] as const,
  runs: (id: string | null, params: WorkflowRunListParams) => [...queryKeys.workflows.all, "runs", id ?? "all", params] as const,
  run: (runId: string) => [...queryKeys.workflows.all, "run", runId] as const,
  subjects: (kind: "lead" | "deal", q: string) => [...queryKeys.workflows.all, "subjects", kind, q] as const,
};

export function useWorkflows() {
  return useQuery({ queryKey: workflowKeys.list, queryFn: workflowApi.list });
}

/** Runs for one workflow, or for all workflows when workflowId is null. Polls while any run is in flight. */
export function useWorkflowRuns(workflowId: string | null, params: WorkflowRunListParams = {}) {
  return useQuery({
    queryKey: workflowKeys.runs(workflowId, params),
    queryFn: () => (workflowId ? workflowApi.runs(workflowId, params) : workflowApi.allRuns(params)),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.data.some((r) => r.status === "running" || r.status === "waiting") ? 10_000 : false,
  });
}

export function useWorkflowRun(runId: string | null) {
  return useQuery({
    queryKey: workflowKeys.run(runId ?? ""),
    queryFn: () => workflowApi.run(runId!),
    enabled: !!runId,
  });
}

export function useWorkflowSubjects(kind: "lead" | "deal", q: string, enabled: boolean) {
  return useQuery({
    queryKey: workflowKeys.subjects(kind, q),
    queryFn: () => (kind === "lead" ? workflowApi.searchLeads(q) : workflowApi.searchDeals(q)),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateWorkflow() {
  return useApiMutation<Workflow, WorkflowInput>({
    mutationFn: workflowApi.create,
    invalidate: [queryKeys.workflows.all],
    successMessage: (wf) => `Workflow "${wf.name}" created`,
  });
}

export function useUpdateWorkflow() {
  return useApiMutation<Workflow, { id: string; patch: Partial<WorkflowInput> }>({
    mutationFn: ({ id, patch }) => workflowApi.update(id, patch),
    invalidate: [queryKeys.workflows.all],
    successMessage: "Workflow saved",
  });
}

export function useDeleteWorkflow() {
  return useApiMutation<void, string>({
    mutationFn: workflowApi.remove,
    invalidate: [queryKeys.workflows.all],
    successMessage: "Workflow deleted",
  });
}

export function useSetWorkflowEnabled() {
  return useApiMutation<Workflow, { id: string; enabled: boolean }>({
    mutationFn: ({ id, enabled }) => workflowApi.setEnabled(id, enabled),
    invalidate: [queryKeys.workflows.all],
    successMessage: (wf) => (wf.enabled ? `"${wf.name}" is on` : `"${wf.name}" is paused`),
  });
}

export function useTestWorkflow() {
  return useApiMutation<WorkflowRun, { id: string; input: WorkflowTestInput }>({
    mutationFn: ({ id, input }) => workflowApi.test(id, input),
    invalidate: [queryKeys.workflows.all],
    errorMessage: false,
  });
}
