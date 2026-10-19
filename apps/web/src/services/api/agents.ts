import { enc, getData, getPage, postData } from "./http";
import { mapLeadRow, mapSignalRow } from "./leads";
import {
  isOneOf,
  type AgentLogRow,
  type AgentRow,
  type AgentRunDetailRow,
  type AgentRunRow,
  type AgentStatsRow,
  type ConvertSignalsRow,
} from "./rows";
import type {
  Agent,
  AgentLogEntry,
  AgentRun,
  AgentRunDetail,
  AgentRunStats,
  ConvertSignalsResult,
  ConvertedSignal,
  DiscoverySource,
  Paginated,
  StartAgentRunInput,
} from "@/types";

export const DISCOVERY_AGENT_ID = "agt-discovery";

const SOURCES: DiscoverySource[] = ["web", "places"];
const RUN_STATUSES: AgentRun["status"][] = ["queued", "running", "completed", "completed_with_errors", "failed"];

const num = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const sources = (v: unknown): DiscoverySource[] =>
  Array.isArray(v) ? (v.filter((s) => SOURCES.includes(s)) as DiscoverySource[]) : [];

const mapStats = (s: AgentStatsRow | null | undefined): AgentRunStats => ({
  runs: Number(s?.runs) || 0,
  active: Number(s?.active) || 0,
  succeeded: Number(s?.succeeded) || 0,
  failed: Number(s?.failed) || 0,
  successRate: num(s?.successRate),
  avgDurationMs: num(s?.avgDurationMs),
  leadsFound: Number(s?.leadsFound) || 0,
  signalsFound: Number(s?.signalsFound) || 0,
  lastRunAt: s?.lastRunAt ?? null,
  days: num(s?.days),
});

const mapAgent = (a: AgentRow): Agent => ({
  id: a.id,
  name: a.name ?? a.id,
  type: a.type ?? "",
  description: a.description ?? "",
  status: a.status === "running" || a.status === "not_configured" ? a.status : "active",
  activeRuns: Number(a.activeRuns) || 0,
  sources: sources(a.sources),
  maxResultsLimit: Number(a.maxResultsLimit) || 100,
  defaultMaxResults: Number(a.defaultMaxResults) || 30,
  serperConfigured: a.serperConfigured === true,
  sarvamConfigured: a.sarvamConfigured === true,
  stats: a.stats ? mapStats(a.stats) : null,
});

export const mapAgentRun = (r: AgentRunRow): AgentRun => ({
  id: String(r.id),
  agentId: r.agentId ?? DISCOVERY_AGENT_ID,
  query: r.query ?? "",
  location: r.location ?? null,
  sources: sources(r.sources),
  maxResults: num(r.maxResults),
  status: isOneOf(RUN_STATUSES, r.status) ? r.status : "failed",
  resultsFound: Number(r.resultsFound) || 0,
  highScore: Number(r.highScore) || 0,
  leadsCreated: num(r.leadsCreated),
  signalsSaved: num(r.signalsSaved),
  duplicates: num(r.duplicates),
  errorCount: num(r.errorCount),
  durationMs: num(r.durationMs),
  startedAt: r.startedAt ?? null,
  completedAt: r.completedAt ?? null,
  createdAt: r.createdAt ?? new Date().toISOString(),
});

export const isActiveRun = (run: Pick<AgentRun, "status">) => run.status === "queued" || run.status === "running";

/** Owned by the Agents module. */
export const agentApi = {
  list: async (): Promise<Agent[]> => {
    const rows = await getData<AgentRow[]>("/agents");
    return Array.isArray(rows) ? rows.map(mapAgent) : [];
  },

  get: async (id: string): Promise<Agent> => mapAgent(await getData<AgentRow>(`/agents/${enc(id)}`)),

  stats: async (id: string, days?: number): Promise<AgentRunStats> =>
    mapStats(await getData<AgentStatsRow>(`/agents/${enc(id)}/stats`, { params: days ? { days } : undefined })),

  logs: async (id: string, params: { limit?: number; runId?: string } = {}): Promise<AgentLogEntry[]> => {
    const rows = await getData<AgentLogRow[]>(`/agents/${enc(id)}/logs`, { params });
    return Array.isArray(rows)
      ? rows.map((l) => ({
          id: String(l.id),
          level: l.level === "warn" || l.level === "error" ? l.level : "info",
          message: String(l.message ?? ""),
          createdAt: l.createdAt ?? "",
        }))
      : [];
  },

  /** Queues a run and returns immediately; poll `run(id)` for progress. */
  startRun: async (id: string, input: StartAgentRunInput): Promise<AgentRun> =>
    mapAgentRun(await postData<AgentRunRow>(`/agents/${enc(id)}/runs`, input)),

  runs: async (id: string, params: { page?: number; pageSize?: number; status?: string } = {}): Promise<Paginated<AgentRun>> => {
    const page = await getPage<AgentRunRow>(`/agents/${enc(id)}/runs`, params);
    return { data: (page.data || []).map(mapAgentRun), meta: page.meta };
  },

  run: async (id: string, runId: string): Promise<AgentRunDetail> => {
    const d = await getData<AgentRunDetailRow | null>(`/agents/${enc(id)}/runs/${enc(runId)}`);
    return {
      run: mapAgentRun(d?.run ?? {}),
      steps: Array.isArray(d?.steps)
        ? d.steps.map((s) => ({
            id: String(s.id),
            step: String(s.step ?? ""),
            name: String(s.name ?? s.step ?? ""),
            status: String(s.status ?? ""),
            input: s.input ?? null,
            output: s.output ?? null,
            error: s.error ?? null,
            durationMs: num(s.durationMs),
            tokensUsed: num(s.tokensUsed),
            startedAt: s.startedAt ?? null,
            completedAt: s.completedAt ?? null,
          }))
        : [],
      errors: Array.isArray(d?.errors) ? d.errors.map(String) : [],
      leads: Array.isArray(d?.leads) ? d.leads.map(mapLeadRow) : [],
      signals: Array.isArray(d?.signals) ? d.signals.map(mapSignalRow) : [],
    };
  },

  /** "Convert to lead" for many intent signals; existing leads with the same post/contact are linked. */
  convertSignals: async (signalIds: string[]): Promise<ConvertSignalsResult> => {
    const d = await postData<ConvertSignalsRow | null>("/signals/convert", { signalIds });
    return {
      results: Array.isArray(d?.results) ? (d.results as ConvertedSignal[]) : [],
      created: Number(d?.created) || 0,
      existing: Number(d?.existing) || 0,
      missing: Array.isArray(d?.missing) ? d.missing.map(String) : [],
    };
  },

  convertSignal: async (signalId: string): Promise<ConvertedSignal> =>
    postData<ConvertedSignal>(`/signals/${enc(signalId)}/convert`),
};
