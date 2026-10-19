import type { IntentSignal, Lead } from "./leads";

/** "web": public posts from people asking for the product/service; "places": Google Maps business listings. */
export type DiscoverySource = "web" | "places";

export type AgentRunStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed";

export interface AgentRunStats {
  runs: number;
  active: number;
  succeeded: number;
  failed: number;
  /** Percent of finished runs that did not fail; null before the first finished run. */
  successRate: number | null;
  avgDurationMs: number | null;
  leadsFound: number;
  signalsFound: number;
  lastRunAt: string | null;
  days: number | null;
}

export interface Agent {
  id: string;
  name: string;
  type: string;
  description: string;
  status: "active" | "running" | "not_configured";
  activeRuns: number;
  sources: DiscoverySource[];
  maxResultsLimit: number;
  defaultMaxResults: number;
  serperConfigured: boolean;
  sarvamConfigured: boolean;
  stats: AgentRunStats | null;
}

export interface AgentRun {
  id: string;
  agentId: string;
  query: string;
  location: string | null;
  sources: DiscoverySource[];
  maxResults: number | null;
  status: AgentRunStatus;
  /** New leads + saved signals. */
  resultsFound: number;
  highScore: number;
  /** Null until the run has saved its results (or for runs recorded before this was tracked). */
  leadsCreated: number | null;
  signalsSaved: number | null;
  duplicates: number | null;
  errorCount: number | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AgentRunStep {
  id: string;
  step: string;
  name: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  durationMs: number | null;
  tokensUsed: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentRunDetail {
  run: AgentRun;
  steps: AgentRunStep[];
  errors: string[];
  leads: Lead[];
  signals: IntentSignal[];
}

export interface AgentLogEntry {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface StartAgentRunInput {
  query: string;
  location: string;
  sources: DiscoverySource[];
  maxResults: number;
}

export interface ConvertedSignal {
  signalId: string;
  leadId: string;
  created: boolean;
}

export interface ConvertSignalsResult {
  results: ConvertedSignal[];
  created: number;
  existing: number;
  missing: string[];
}