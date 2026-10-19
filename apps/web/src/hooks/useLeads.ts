import { useCallback, useEffect, useRef, useState } from "react";
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
      timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all }), REALTIME_REFRESH_DEBOUNCE_MS);
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

const CITY_ALIASES: string[][] = [
  ["bengaluru", "bangalore"],
  ["mysuru", "mysore"],
  ["mumbai", "bombay"],
  ["chennai", "madras"],
  ["gurugram", "gurgaon"],
];

const cityVariants = (city: string): string[] => {
  const c = city.trim().toLowerCase();
  return CITY_ALIASES.find((group) => group.includes(c)) ?? [c];
};

const includesText = (field: string | null | undefined, needle: string) =>
  Boolean(field && field.toLowerCase().includes(needle.toLowerCase()));

/** Client-side mirror of the server's lead filters, used after a filter chip is removed. */
const matchesSearchFilters = (lead: Lead, f: LeadSearchFilters): boolean => {
  if (f.course_interest && !includesText(lead.courseInterest, f.course_interest) && !lead.tags.some((t) => includesText(t, f.course_interest!)))
    return false;
  if (f.city && !cityVariants(f.city).some((c) => includesText(lead.location, c))) return false;
  if (f.exam_year && lead.examYear !== f.exam_year) return false;
  if (f.source_platform && lead.sourcePlatform !== f.source_platform) return false;
  if (f.status && lead.status.toLowerCase() !== f.status.toLowerCase()) return false;
  if (f.min_score != null && lead.score < f.min_score) return false;
  if (f.keywords.length > 0) {
    const fields = [lead.name, lead.title, lead.company, lead.industry, lead.location, lead.courseInterest, lead.campaignName, ...lead.tags];
    if (!f.keywords.every((k) => fields.some((field) => includesText(field, k)))) return false;
  }
  return true;
};

/**
 * Natural-language lead search (POST /leads/search) plus its intent signals. Removing a filter chip
 * re-runs the search's lead list through the remaining filters and reloads matching signals.
 */
export function useLeadAiSearch() {
  const queryClient = useQueryClient();
  const [searchResult, setSearchResult] = useState<LeadSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const latest = useRef<LeadSearchResult | null>(null);
  latest.current = searchResult;

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      toast.error("Enter a search query before running AI Search.");
      return;
    }
    setIsSearching(true);
    try {
      const result = await leadApi.search(query.trim());
      setSearchResult(result);
      const leadCount = result.leads.length;
      const signalCount = result.signals.length;
      toast.success(
        `Found ${leadCount} lead${leadCount === 1 ? "" : "s"} and ${signalCount} intent signal${signalCount === 1 ? "" : "s"}.`
      );
    } catch (err) {
      toast.error(`AI Search failed: ${errorMessage(err)}`);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const removeSearchFilter = useCallback(async (key: SearchFilterKey, keyword?: string) => {
    const current = latest.current;
    if (!current) return;
    const filters: LeadSearchFilters = { ...current.filters, keywords: [...current.filters.keywords] };
    if (key === "keywords") filters.keywords = keyword === undefined ? [] : filters.keywords.filter((k) => k !== keyword);
    else if (key === "min_score") filters.min_score = null;
    else filters[key] = null;

    const leads = current.leads.filter((lead) => matchesSearchFilters(lead, filters));
    const next = { ...current, filters, leads };
    setSearchResult(next);

    let signals: IntentSignal[];
    try {
      signals = await signalApi.list({ course: filters.course_interest, city: filters.city });
    } catch {
      signals = current.signals;
    }
    // Ignore the response if a newer search or removal replaced the result meanwhile.
    setSearchResult((prev) => (prev && prev.filters === filters ? { ...prev, signals } : prev));
  }, []);

  const clearSearch = useCallback(() => setSearchResult(null), []);

  const updateSignalStatus = useCallback(async (id: string, status: IntentSignalStatus) => {
    try {
      const updated = await signalApi.updateStatus(id, status);
      setSearchResult((prev) => (prev ? { ...prev, signals: prev.signals.map((s) => (s.id === id ? updated : s)) } : prev));
    } catch (err) {
      toast.error(`Could not update the signal: ${errorMessage(err)}`);
    }
  }, []);

  const deleteSignal = useCallback(async (id: string) => {
    try {
      await signalApi.delete(id);
      setSearchResult((prev) => (prev ? { ...prev, signals: prev.signals.filter((s) => s.id !== id) } : prev));
    } catch (err) {
      toast.error(`Could not delete the signal: ${errorMessage(err)}`);
    }
  }, []);

  const importSignals = useCallback(
    async (payload: unknown): Promise<SignalImportResult> => {
      const result = await signalApi.import(payload);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
      const current = latest.current;
      if (current) {
        try {
          const signals = await signalApi.list({ course: current.filters.course_interest, city: current.filters.city });
          setSearchResult((prev) => (prev === current ? { ...current, signals } : prev));
        } catch {
          // Keep the existing signals; the import itself succeeded.
        }
      }
      return result;
    },
    [queryClient]
  );

  return { searchResult, isSearching, runSearch, removeSearchFilter, clearSearch, updateSignalStatus, deleteSignal, importSignals };
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