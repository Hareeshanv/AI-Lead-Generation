import type {
  ActivityType,
  ConvertedSignal,
  DealStage,
  LeadSearchFilters,
  LeadSourcePlatform,
  LeadStatus,
  TaskPriority,
  TaskStatus,
} from "@/types";

/**
 * Raw API payloads before mapping. Leads, CRM and signals are snake_case DB rows; agents and
 * integrations are camelCase DTOs. Fields the mappers validate at runtime are typed loosely.
 */

/** PostgREST embeds come back as an object or a one-element array. */
export type Embedded<T> = T | T[] | null | undefined;

export function one<T>(value: Embedded<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return (value as T | null | undefined) ?? null;
}

export const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value);

type Opt<T> = T | null | undefined;

export interface ActivityRow {
  id: string;
  type: ActivityType;
  lead_id?: Opt<string>;
  deal_id?: Opt<string>;
  title?: Opt<string>;
  body?: Opt<string>;
  metadata?: Opt<Record<string, unknown>>;
  actor_id?: Opt<string>;
  occurred_at?: Opt<string>;
  created_at: string;
}

export interface TaskRow {
  id: string;
  title?: Opt<string>;
  description?: Opt<string>;
  lead_id?: Opt<string>;
  deal_id?: Opt<string>;
  due_at?: Opt<string>;
  assignee_id?: Opt<string>;
  status?: Opt<TaskStatus>;
  priority?: Opt<TaskPriority>;
  completed_at?: Opt<string>;
  created_by?: Opt<string>;
  created_at: string;
  lead?: Embedded<{ id: string; name: string; company: string | null }>;
  deal?: Embedded<{ id: string; title: string; stage: string }>;
}

export interface LeadRow {
  id: string;
  name?: Opt<string>;
  title?: Opt<string>;
  company?: Opt<string>;
  email?: Opt<string>;
  phone?: Opt<string>;
  phone_number?: Opt<string>;
  location?: Opt<string>;
  score?: Opt<number | string>;
  status?: Opt<LeadStatus>;
  source?: Opt<string>;
  owner?: Opt<string>;
  avatar?: Opt<string>;
  industry?: Opt<string>;
  company_size?: Opt<string>;
  annual_revenue?: Opt<string>;
  tech_stack?: Opt<string[]>;
  created_at?: Opt<string>;
  updated_at?: Opt<string>;
  tags?: Opt<string[]>;
  notes_count?: Opt<number>;
  activity_count?: Opt<number>;
  profile_url?: Opt<string>;
  profileUrl?: Opt<string>;
  academy_id?: Opt<string>;
  source_platform?: Opt<string>;
  external_lead_id?: Opt<string>;
  form_id?: Opt<string>;
  campaign_name?: Opt<string>;
  ad_name?: Opt<string>;
  course_interest?: Opt<string>;
  exam_year?: Opt<string | number>;
  is_guardian?: unknown;
  consent_at?: Opt<string>;
  raw_answers?: Opt<Record<string, unknown>>;
  needs_guardian_consent?: Opt<boolean>;
  scored_at?: Opt<string>;
  owner_id?: Opt<string>;
  stage?: Opt<string>;
  last_contacted_at?: Opt<string>;
  do_not_contact?: Opt<boolean>;
  consent_channel?: Opt<string[]>;
}

export interface SignalRow {
  id: string;
  post_url?: Opt<string>;
  source_channel?: Opt<string>;
  post_excerpt?: Opt<string>;
  post_date?: unknown;
  city?: unknown;
  course_interest?: unknown;
  urgency?: unknown;
  budget?: unknown;
  intent_score?: Opt<number | string>;
  lead_routing_category?: unknown;
  suggested_public_reply?: unknown;
  status?: unknown;
  author_handle?: unknown;
  platform?: unknown;
  contact_requested?: unknown;
  published_contact?: unknown;
  contact_request_quote?: unknown;
  location_match?: unknown;
  search_query?: unknown;
  search_city?: unknown;
  discovered_at?: unknown;
  created_at?: Opt<string>;
}

export type SearchFiltersRow = Partial<Record<keyof LeadSearchFilters, unknown>>;

export interface SearchResultRow {
  filters?: Opt<SearchFiltersRow>;
  parsedBy?: unknown;
  leads?: Opt<LeadRow[]>;
  signals?: Opt<SignalRow[]>;
}

export interface DealLeadRow {
  id: string;
  name?: Opt<string>;
  company?: Opt<string>;
  email?: Opt<string>;
  phone?: Opt<string>;
  status?: Opt<string>;
  score?: Opt<number>;
}

export interface DealRow {
  id: string;
  title?: Opt<string>;
  company?: Opt<string>;
  contact?: Opt<string>;
  value?: Opt<number | string>;
  stage?: Opt<DealStage>;
  probability?: Opt<number | string>;
  expected_close?: Opt<string>;
  owner?: Opt<string>;
  owner_id?: Opt<string>;
  lead_id?: Opt<string>;
  lead?: Embedded<DealLeadRow>;
  next_follow_up_at?: Opt<string>;
  lost_reason?: Opt<string>;
  position?: Opt<number | string>;
  closed_at?: Opt<string>;
  created_at?: string;
  updated_at?: Opt<string>;
}

export interface DealBoardColumnRow {
  stage: DealStage;
  deals?: Opt<DealRow[]>;
  count?: Opt<number | string>;
  value?: Opt<number | string>;
  weighted?: Opt<number | string>;
}

export interface AgentStatsRow {
  runs?: unknown;
  active?: unknown;
  succeeded?: unknown;
  failed?: unknown;
  successRate?: unknown;
  avgDurationMs?: unknown;
  leadsFound?: unknown;
  signalsFound?: unknown;
  lastRunAt?: Opt<string>;
  days?: unknown;
}

export interface AgentRow {
  id: string;
  name?: Opt<string>;
  type?: Opt<string>;
  description?: Opt<string>;
  status?: Opt<string>;
  activeRuns?: unknown;
  sources?: unknown;
  maxResultsLimit?: unknown;
  defaultMaxResults?: unknown;
  serperConfigured?: unknown;
  sarvamConfigured?: unknown;
  stats?: Opt<AgentStatsRow>;
}

export interface AgentRunRow {
  id?: string | number;
  agentId?: Opt<string>;
  query?: Opt<string>;
  location?: Opt<string>;
  sources?: unknown;
  maxResults?: unknown;
  status?: unknown;
  resultsFound?: unknown;
  highScore?: unknown;
  leadsCreated?: unknown;
  signalsSaved?: unknown;
  duplicates?: unknown;
  errorCount?: unknown;
  durationMs?: unknown;
  startedAt?: Opt<string>;
  completedAt?: Opt<string>;
  createdAt?: Opt<string>;
}

export interface AgentLogRow {
  id: string | number;
  level?: unknown;
  message?: unknown;
  createdAt?: Opt<string>;
}

export interface AgentRunStepRow {
  id: string | number;
  step?: Opt<string>;
  name?: Opt<string>;
  status?: Opt<string>;
  input?: Opt<Record<string, unknown>>;
  output?: Opt<Record<string, unknown>>;
  error?: Opt<string>;
  durationMs?: unknown;
  tokensUsed?: unknown;
  startedAt?: Opt<string>;
  completedAt?: Opt<string>;
}

export interface AgentRunDetailRow {
  run?: Opt<AgentRunRow>;
  steps?: Opt<AgentRunStepRow[]>;
  errors?: Opt<unknown[]>;
  leads?: Opt<LeadRow[]>;
  signals?: Opt<SignalRow[]>;
}

export interface ConvertSignalsRow {
  results?: Opt<ConvertedSignal[]>;
  created?: unknown;
  existing?: unknown;
  missing?: Opt<unknown[]>;
}

export interface LeadSourceRow {
  id: string;
  platform: LeadSourcePlatform;
  pageName?: Opt<string>;
  externalPageId?: Opt<string>;
  formIds?: Opt<string[]>;
  status?: Opt<string>;
  lastLeadAt?: Opt<string>;
  createdAt?: Opt<string>;
  webhookUrl?: Opt<string>;
}
