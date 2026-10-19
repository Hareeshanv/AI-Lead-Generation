import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activityApi, dealApi, taskApi } from "@/services/api";
import { notifyError } from "@/lib/toast";
import type { Activity, ActivityInput, Deal, DealInput, DealListParams, DealStage, Task, TaskInput, TaskListParams, TaskPatch } from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

/** Deal changes sync the linked lead's status, so leads are refreshed too. */
const DEAL_RELATED = [queryKeys.deals.all, queryKeys.leads.all, queryKeys.tasks.all];

export function useDeals(params: DealListParams = {}) {
  return useQuery({ queryKey: queryKeys.deals.list(params), queryFn: () => dealApi.list(params) });
}

export function useDeal(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.deals.detail(id ?? ""), queryFn: () => dealApi.get(id!), enabled: Boolean(id) });
}

export function useDealActivities(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.deals.activities(id ?? ""), queryFn: () => dealApi.activities(id!), enabled: Boolean(id) });
}

export function useDealTasks(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.deals.tasks(id ?? ""), queryFn: () => dealApi.tasks(id!), enabled: Boolean(id) });
}

export function useCreateDeal() {
  return useApiMutation<Deal, DealInput>({
    mutationFn: dealApi.create,
    invalidate: DEAL_RELATED,
    successMessage: (deal) => `Deal "${deal.title}" created`,
  });
}

export function useUpdateDeal(successMessage: string | null = "Deal saved") {
  return useApiMutation<Deal, { id: string; patch: DealInput }>({
    mutationFn: ({ id, patch }) => dealApi.update(id, patch),
    invalidate: DEAL_RELATED,
    successMessage: successMessage ?? undefined,
  });
}

export function useDeleteDeal() {
  return useApiMutation<void, string>({
    mutationFn: dealApi.remove,
    invalidate: DEAL_RELATED,
    successMessage: "Deal deleted",
  });
}

export interface MoveDealVars {
  id: string;
  stage: DealStage;
  position?: number;
  lostReason?: string | null;
}

/**
 * Kanban move for the board loaded with `params`: the card moves immediately and snaps back
 * (with an error toast) if the API rejects the change.
 */
export function useMoveDeal(params: DealListParams = {}) {
  const queryClient = useQueryClient();
  const key = queryKeys.deals.list(params);
  return useMutation<Deal, Error, MoveDealVars, { previous?: Deal[] }>({
    mutationFn: ({ id, stage, position, lostReason }) => dealApi.updateStage(id, stage, { position, lostReason }),
    onMutate: async ({ id, stage, position, lostReason }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Deal[]>(key);
      if (previous) {
        queryClient.setQueryData<Deal[]>(
          key,
          previous.map((d) =>
            d.id === id
              ? { ...d, stage, position: position ?? d.position, lostReason: stage === "Closed Lost" ? lostReason ?? null : d.lostReason }
              : d
          )
        );
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      notifyError(err, "Couldn't move the deal");
    },
    onSuccess: (deal) => {
      queryClient.setQueryData<Deal[]>(key, (current) => current?.map((d) => (d.id === deal.id ? deal : d)));
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deals.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.leads.all }),
      ]),
  });
}

export function useAddDealActivity(dealId: string) {
  return useApiMutation<Activity, ActivityInput>({
    mutationFn: (input) => dealApi.addActivity(dealId, input),
    invalidate: [queryKeys.deals.activities(dealId), queryKeys.leads.all],
    successMessage: (a) => (a.type === "note" ? "Note added" : `${a.type === "whatsapp" ? "WhatsApp" : a.type} logged`),
  });
}

export function useAddDealTask(dealId: string) {
  return useApiMutation<Task, TaskInput>({
    mutationFn: (input) => dealApi.addTask(dealId, input),
    invalidate: DEAL_RELATED,
    successMessage: "Follow-up added",
  });
}

export function useTasks(params: TaskListParams = {}) {
  return useQuery({ queryKey: queryKeys.tasks.list(params), queryFn: () => taskApi.list(params) });
}

export function useUpdateTask() {
  return useApiMutation<Task, { id: string; patch: TaskPatch }>({
    mutationFn: ({ id, patch }) => taskApi.update(id, patch),
    invalidate: DEAL_RELATED,
    successMessage: (task, vars) => (vars.patch.status === "done" ? `Completed "${task.title}"` : "Task updated"),
  });
}

export function useDeleteTask() {
  return useApiMutation<void, string>({
    mutationFn: taskApi.remove,
    invalidate: DEAL_RELATED,
    successMessage: "Task deleted",
  });
}

export function useDeleteActivity() {
  return useApiMutation<void, string>({
    mutationFn: activityApi.remove,
    invalidate: [queryKeys.leads.all, queryKeys.deals.all],
    successMessage: "Entry deleted",
  });
}
