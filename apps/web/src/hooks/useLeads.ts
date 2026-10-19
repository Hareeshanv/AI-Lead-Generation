import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { leadApi, signalApi } from "@/services/api";
import { getSupabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/toast";
import type {
  Activity,
  ActivityInput,
  IntentSignal,
  IntentSignalStatus,
  Lead,
  LeadBulkAction,
  LeadImportResult,
  LeadInput,
  LeadListParams,
  LeadSearchFilters,
  LeadSearchParser,
  LeadSearchResult,
  SignalImportResult,
  Task,
  TaskInput,
} from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

const REALTIME_REFRESH_DEBOUNCE_MS = 500;

/** A lead change can move deals (status sync) and tasks, so all three are refreshed. */
const LEAD_RELATED = [queryKeys.leads.all, queryKeys.deals.all, queryKeys.tasks.all];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function useLeads(params: LeadListParams) {
  return useQuery({
    queryKey: queryKeys.leads.list(params),
    queryFn: () => leadApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** Total leads in the workspace, read from the paginated list meta. */
export function useLeadCount() {
  return useQuery({
    queryKey: queryKeys.leads.list({ page: 1, pageSize: 1 }),
    queryFn: () => leadApi.list({ page: 1, pageSize: 1 }),
    select: (page) => page.meta.total,
    staleTime: 30_000,
  });
}

/**
 * Refreshes lead queries when leads change in this workspace (webhooks, agents, teammates).
 * Rows are never read from the table directly; the API stays the source of truth.
 */
export function useLeadsRealtime(orgId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!orgId) return;
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      // AI search results are left alone: re-running them on every teammate/webhook change would hit the search rate limit.
      timer = setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all, predicate: (q) => q.queryKey[1] !== "search" }),
        REALTIME_REFRESH_DEBOUNCE_MS
      );
    };
    const channel = supabase
      .channel(`leads:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `org_id=eq.${orgId}` }, refresh)
      .subscribe();

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);
}

export type SearchFilterKey = keyof LeadSearchFilters;

const SEARCH_KEY_PREFIX = ["leads", "search"] as const;

interface ActiveSearch {
  query: string;
  filters: LeadSearchFilters;
  parsedBy: LeadSearchParser;
}

/**
 * Natural-language lead search (POST /leads/search) plus its intent signals. The query is parsed once;
 * the result is cached under its structured filters, so removing a filter chip re-queries the server with
 * the remaining filters and lead mutations (which invalidate `leads`) refresh the results.
 */
export function useLeadAiSearch() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<ActiveSearch | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const runId = useRef(0);

  const resultQuery = useQuery({
    queryKey: queryKeys.leads.search(active?.filters ?? {}),
    queryFn: () => leadApi.searchByFilters(active!.query, active!.filters),
    enabled: active !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  // Filters come from `active` so a removed chip disappears before the re-query returns.
  const resultData = resultQuery.data;
  const searchResult = useMemo<LeadSearchResult | null>(
    () =>
      active
        ? {
            query: active.query,
            filters: active.filters,
            parsedBy: active.parsedBy,
            leads: resultData?.leads ?? [],
            signals: resultData?.signals ?? [],
          }
        : null,
    [active, resultData]
  );

  const runSearch = useCallback(
    async (query: string) => {
      const text = query.trim();
      if (!text) {
        toast.error("Enter a search query before running AI Search.");
        return;
      }
      const id = ++runId.current;
      setIsParsing(true);
      try {
        const result = await leadApi.search(text);
        if (id !== runId.current) return;
        queryClient.setQueryData(queryKeys.leads.search(result.filters), result);
        setActive({ query: text, filters: result.filters, parsedBy: result.parsedBy });
        toast.success(`Found ${plural(result.leads.length, "lead")} and ${plural(result.signals.length, "intent signal")}.`);
      } catch (err) {
        if (id === runId.current) toast.error(`AI Search failed: ${errorMessage(err)}`);
      } finally {
        if (id === runId.current) setIsParsing(false);
      }
    },
    [queryClient]
  );

  const removeSearchFilter = useCallback((key: SearchFilterKey, keyword?: string) => {
    setActive((prev) => {
      if (!prev) return prev;
      const filters: LeadSearchFilters = { ...prev.filters, keywords: [...prev.filters.keywords] };
      if (key === "keywords") filters.keywords = keyword === undefined ? [] : filters.keywords.filter((k) => k !== keyword);
      else if (key === "min_score") filters.min_score = null;
      else filters[key] = null;
      return { ...prev, filters };
    });
  }, []);

  const clearSearch = useCallback(() => {
    runId.current++;
    setIsParsing(false);
    setActive(null);
  }, []);

  const patchSignals = useCallback(
    (update: (signals: IntentSignal[]) => IntentSignal[]) =>
      queryClient.setQueriesData<LeadSearchResult>({ queryKey: SEARCH_KEY_PREFIX }, (prev) =>
        prev ? { ...prev, signals: update(prev.signals) } : prev
      ),
    [queryClient]
  );

  const updateSignalStatus = useCallback(
    async (id: string, status: IntentSignalStatus) => {
      try {
        const updated = await signalApi.updateStatus(id, status);
        patchSignals((signals) => signals.map((s) => (s.id === id ? updated : s)));
      } catch (err) {
        toast.error(`Could not update the signal: ${errorMessage(err)}`);
      }
    },
    [patchSignals]
  );

  const deleteSignal = useCallback(
    async (id: string) => {
      try {
        await signalApi.delete(id);
        patchSignals((signals) => signals.filter((s) => s.id !== id));
      } catch (err) {
        toast.error(`Could not delete the signal: ${errorMessage(err)}`);
      }
    },
    [patchSignals]
  );

  const importSignals = useCallback(
    async (payload: unknown): Promise<SignalImportResult> => {
      const result = await signalApi.import(payload);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
      void queryClient.invalidateQueries({ queryKey: SEARCH_KEY_PREFIX });
      return result;
    },
    [queryClient]
  );

  return {
    searchResult,
    isSearching: isParsing,
    /** Re-querying after a filter change or a lead mutation. */
    isRefreshing: active !== null && resultQuery.isFetching,
    searchError: active !== null && resultQuery.isError && !resultQuery.data ? resultQuery.error : null,
    retrySearch: () => void resultQuery.refetch(),
    runSearch,
    removeSearchFilter,
    clearSearch,
    updateSignalStatus,
    deleteSignal,
    importSignals,
  };
}

export function useLead(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.leads.detail(id ?? ""), queryFn: () => leadApi.get(id!), enabled: Boolean(id) });
}

export function useLeadFacets() {
  return useQuery({ queryKey: queryKeys.leads.facets, queryFn: leadApi.facets, staleTime: 60_000 });
}

export function useLeadActivities(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.leads.activities(id ?? ""), queryFn: () => leadApi.activities(id!), enabled: Boolean(id) });
}

export function useLeadTasks(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.leads.tasks(id ?? ""), queryFn: () => leadApi.tasks(id!), enabled: Boolean(id) });
}

export function useCreateLead() {
  return useApiMutation<Lead, LeadInput>({
    mutationFn: leadApi.create,
    invalidate: [queryKeys.leads.all],
    successMessage: (lead) => `Lead "${lead.name}" created`,
  });
}

export function useUpdateLead(successMessage: string | null = "Lead saved") {
  return useApiMutation<Lead, { id: string; patch: LeadInput }>({
    mutationFn: ({ id, patch }) => leadApi.update(id, patch),
    invalidate: LEAD_RELATED,
    successMessage: successMessage ?? undefined,
  });
}

export function useDeleteLead() {
  return useApiMutation<{ id: string; deleted: boolean }, string>({
    mutationFn: leadApi.deleteLead,
    invalidate: LEAD_RELATED,
    successMessage: "Lead deleted",
  });
}

export function useEraseLead() {
  return useApiMutation<{ id: string; deleted: boolean }, string>({
    mutationFn: leadApi.eraseLead,
    invalidate: LEAD_RELATED,
    successMessage: "Lead and its form answers were permanently erased",
  });
}

const BULK_DONE: Record<LeadBulkAction["action"], string> = {
  assign: "Assigned",
  status: "Updated status of",
  tag: "Tagged",
  untag: "Removed tags from",
  delete: "Deleted",
  rescore: "Rescored",
};

export function useBulkLeadAction() {
  return useApiMutation<{ affected: number }, LeadBulkAction>({
    mutationFn: leadApi.bulk,
    invalidate: LEAD_RELATED,
    successMessage: (result, vars) => `${BULK_DONE[vars.action]} ${plural(result.affected, "lead")}`,
  });
}

export function useImportLeads() {
  return useApiMutation<LeadImportResult, { rows: Record<string, string>[]; source?: string; tags?: string[] }>({
    mutationFn: ({ rows, ...options }) => leadApi.import(rows, options),
    invalidate: [queryKeys.leads.all],
    successMessage: (r) =>
      `Imported ${plural(r.imported, "lead")}` +
      (r.duplicates ? `, skipped ${plural(r.duplicates, "duplicate")}` : "") +
      (r.invalid ? `, ${r.invalid} invalid` : ""),
  });
}

export function useRescoreLead() {
  return useApiMutation<Lead, string>({
    mutationFn: leadApi.rescore,
    invalidate: [queryKeys.leads.all],
    successMessage: (lead) => `Score updated to ${lead.score}`,
  });
}

export function useAddLeadActivity(leadId: string) {
  return useApiMutation<Activity, ActivityInput>({
    mutationFn: (input) => leadApi.addActivity(leadId, input),
    invalidate: [queryKeys.leads.all],
    successMessage: (a) => (a.type === "note" ? "Note added" : `${a.type === "whatsapp" ? "WhatsApp" : a.type} logged`),
  });
}

export function useAddLeadTask(leadId: string) {
  return useApiMutation<Task, TaskInput>({
    mutationFn: (input) => leadApi.addTask(leadId, input),
    invalidate: [queryKeys.leads.tasks(leadId), queryKeys.tasks.all, queryKeys.deals.all],
    successMessage: "Follow-up added",
  });
}