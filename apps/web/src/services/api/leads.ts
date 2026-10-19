import { http, deleteWithData, enc, getData, patchData, postData } from "./http";
import type {
  Activity,
  ActivityInput,
  ConsentChannel,
  IntentSignal,
  IntentSignalStatus,
  Lead,
  LeadBulkAction,
  LeadFacets,
  LeadImportResult,
  LeadInput,
  LeadListParams,
  LeadSearchFilters,
  LeadSearchResult,
  LocationMatch,
  Paginated,
  SignalImportResult,
  Task,
  TaskInput,
} from "@/types";
import { isOneOf, one, type ActivityRow, type LeadRow, type SearchFiltersRow, type SearchResultRow, type SignalRow, type TaskRow } from "./rows";

const CONSENT_CHANNELS: ConsentChannel[] = ["email", "whatsapp", "sms", "call"];

export const mapActivityRow = (d: ActivityRow): Activity => ({
  id: d.id,
  type: d.type,
  leadId: d.lead_id ?? null,
  dealId: d.deal_id ?? null,
  title: d.title ?? null,
  body: d.body ?? null,
  metadata: d.metadata && typeof d.metadata === "object" ? d.metadata : {},
  actorId: d.actor_id ?? null,
  occurredAt: d.occurred_at ?? d.created_at,
});

export const mapTaskRow = (d: TaskRow): Task => ({
  id: d.id,
  title: d.title ?? "",
  description: d.description ?? null,
  leadId: d.lead_id ?? null,
  dealId: d.deal_id ?? null,
  dueAt: d.due_at ?? null,
  assigneeId: d.assignee_id ?? null,
  status: d.status ?? "open",
  priority: d.priority ?? "normal",
  completedAt: d.completed_at ?? null,
  createdBy: d.created_by ?? null,
  createdAt: d.created_at,
  lead: one(d.lead),
  deal: one(d.deal),
});

/** Arrays are sent comma-separated; empty values are dropped. */
export function toQueryParams(params: object): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value.join(",");
    } else out[key] = value as string | number;
  }
  return out;
}

export const mapLeadRow = (d: LeadRow): Lead => ({
  id: d.id,
  name: d.name ?? "Unknown",
  title: d.title ?? "",
  company: d.company ?? "",
  email: d.email ?? "Not available",
  phone: d.phone ?? d.phone_number ?? "Not available",
  location: d.location ?? "",
  score: Number(d.score ?? 0),
  status: d.status ?? "New",
  source: d.source ?? "AI Search Discovery",
  owner: d.owner ?? "",
  avatar: d.avatar ?? "",
  industry: d.industry ?? "",
  companySize: d.company_size ?? "",
  annualRevenue: d.annual_revenue ?? "",
  techStack: Array.isArray(d.tech_stack) ? d.tech_stack : [],
  createdAt: d.created_at ?? new Date().toISOString(),
  updatedAt: d.updated_at ?? d.created_at ?? new Date().toISOString(),
  tags: Array.isArray(d.tags) ? d.tags : [],
  notesCount: d.notes_count ?? 0,
  activityCount: d.activity_count ?? 0,
  profileUrl: d.profile_url ?? d.profileUrl ?? undefined,
  academyId: d.academy_id ?? null,
  sourcePlatform: d.source_platform === "meta" || d.source_platform === "google" ? d.source_platform : null,
  externalLeadId: d.external_lead_id ?? null,
  formId: d.form_id ?? null,
  campaignName: d.campaign_name ?? null,
  adName: d.ad_name ?? null,
  courseInterest: d.course_interest ?? null,
  examYear: d.exam_year != null ? String(d.exam_year) : null,
  isGuardian: typeof d.is_guardian === "boolean" ? d.is_guardian : null,
  consentAt: d.consent_at ?? null,
  rawAnswers: d.raw_answers && typeof d.raw_answers === "object" ? d.raw_answers : null,
  needsGuardianConsent: Boolean(d.needs_guardian_consent),
  scoredAt: d.scored_at ?? null,
  ownerId: d.owner_id ?? null,
  stage: d.stage ?? null,
  lastContactedAt: d.last_contacted_at ?? null,
  doNotContact: Boolean(d.do_not_contact),
  consentChannel: Array.isArray(d.consent_channel) ? d.consent_channel.filter((c) => isOneOf(CONSENT_CHANNELS, c)) : [],
});

const SIGNAL_STATUSES: IntentSignalStatus[] = ["new", "replied", "routed", "dismissed"];
const LOCATION_MATCHES: LocationMatch[] = ["exact", "nearby", "state"];

/** Contact-requested signals first, then highest intent. */
export const compareSignals = (a: IntentSignal, b: IntentSignal): number =>
  Number(b.contactRequested) - Number(a.contactRequested) || (b.intentScore ?? 0) - (a.intentScore ?? 0);

const textOrNull = (value: unknown): string | null =>
  value == null || String(value).trim() === "" ? null : String(value);

export const mapSignalRow = (d: SignalRow): IntentSignal => ({
  id: d.id,
  postUrl: d.post_url ?? "",
  sourceChannel: d.source_channel ?? "Unknown",
  postExcerpt: d.post_excerpt ?? "",
  postDate: textOrNull(d.post_date),
  city: textOrNull(d.city),
  courseInterest: textOrNull(d.course_interest),
  urgency: textOrNull(d.urgency),
  budget: textOrNull(d.budget),
  intentScore: d.intent_score != null && !Number.isNaN(Number(d.intent_score)) ? Number(d.intent_score) : null,
  leadRoutingCategory: textOrNull(d.lead_routing_category),
  suggestedPublicReply: textOrNull(d.suggested_public_reply),
  status: isOneOf(SIGNAL_STATUSES, d.status) ? d.status : "new",
  authorHandle: textOrNull(d.author_handle),
  platform: textOrNull(d.platform),
  contactRequested: d.contact_requested === true && textOrNull(d.published_contact) !== null,
  publishedContact: d.contact_requested === true ? textOrNull(d.published_contact) : null,
  contactRequestQuote: d.contact_requested === true ? textOrNull(d.contact_request_quote) : null,
  locationMatch: isOneOf(LOCATION_MATCHES, d.location_match) ? d.location_match : null,
  searchQuery: textOrNull(d.search_query),
  searchCity: textOrNull(d.search_city),
  discoveredAt: textOrNull(d.discovered_at),
  createdAt: d.created_at ?? new Date().toISOString(),
});

const mapSearchFilters = (f: SearchFiltersRow | null | undefined): LeadSearchFilters => ({
  course_interest: textOrNull(f?.course_interest),
  city: textOrNull(f?.city),
  exam_year: textOrNull(f?.exam_year),
  source_platform: textOrNull(f?.source_platform),
  status: textOrNull(f?.status),
  min_score: f?.min_score != null && !Number.isNaN(Number(f.min_score)) ? Number(f.min_score) : null,
  keywords: Array.isArray(f?.keywords) ? f.keywords.map(String).filter((k: string) => k.trim()) : [],
});

const mapSearchResult = (query: string, data: SearchResultRow | null | undefined): LeadSearchResult => ({
  query,
  filters: mapSearchFilters(data?.filters),
  parsedBy: data?.parsedBy === "sarvam" ? "sarvam" : "keywords",
  leads: Array.isArray(data?.leads) ? data.leads.map(mapLeadRow) : [],
  signals: Array.isArray(data?.signals) ? data.signals.map(mapSignalRow) : [],
});

/** Owned by the Leads module. */
export const leadApi = {
  /** Parses the query into filters server-side and returns matching leads plus intent signals. */
  search: async (query: string): Promise<LeadSearchResult> =>
    mapSearchResult(query, await postData<SearchResultRow>("/leads/search", { query }, { timeout: 120_000 })),

  /** Re-runs a search with structured filters from an earlier search; no natural-language parsing. */
  searchByFilters: async (query: string, filters: LeadSearchFilters): Promise<LeadSearchResult> =>
    mapSearchResult(query, await postData<SearchResultRow>("/leads/search", { filters })),

  /** Server-side paginated, filtered and sorted list. */
  list: async (params: LeadListParams = {}): Promise<Paginated<Lead>> => {
    const { data } = await http.get<Paginated<LeadRow>>("/leads", { params: toQueryParams(params) });
    return { data: (data.data ?? []).map(mapLeadRow), meta: data.meta };
  },

  /** CSV (without BOM) of every lead matching the list filters and sort, built server-side up to the API's export cap. */
  exportCsv: async ({ page: _page, pageSize: _pageSize, ...params }: LeadListParams = {}): Promise<string> => {
    const res = await http.post<string>("/exports/leads", { params: toQueryParams(params) }, { responseType: "text", timeout: 120_000 });
    return String(res.data ?? "").replace(/^\uFEFF/, "");
  },

  get: async (id: string): Promise<Lead> => mapLeadRow(await getData<LeadRow>(`/leads/${enc(id)}`)),

  facets: (): Promise<LeadFacets> => getData<LeadFacets>("/leads/facets"),

  create: async (input: LeadInput): Promise<Lead> => mapLeadRow(await postData<LeadRow>("/leads", input)),

  update: async (id: string, patch: LeadInput): Promise<Lead> => mapLeadRow(await patchData<LeadRow>(`/leads/${enc(id)}`, patch)),

  deleteLead: async (id: string): Promise<{ id: string; deleted: boolean }> =>
    deleteWithData<{ id: string; deleted: boolean }>(`/leads/${enc(id)}`),

  /** Data deletion request: removes the lead and its raw answers server-side. */
  eraseLead: async (id: string): Promise<{ id: string; deleted: boolean }> =>
    deleteWithData<{ id: string; deleted: boolean }>(`/leads/${enc(id)}/erase`),

  bulk: (action: LeadBulkAction): Promise<{ affected: number }> => postData<{ affected: number }>("/leads/bulk", action),

  /** Rows are already mapped to lead field names. */
  import: (rows: Record<string, string>[], options: { source?: string; tags?: string[] } = {}): Promise<LeadImportResult> =>
    postData<LeadImportResult>("/leads/import", { rows, ...options }, { timeout: 120_000 }),

  rescore: async (id: string): Promise<Lead> => mapLeadRow(await postData<LeadRow>(`/leads/${enc(id)}/rescore`)),

  activities: async (id: string): Promise<Activity[]> =>
    (await getData<ActivityRow[]>(`/leads/${enc(id)}/activities`)).map(mapActivityRow),

  addActivity: async (id: string, input: ActivityInput): Promise<Activity> =>
    mapActivityRow(await postData<ActivityRow>(`/leads/${enc(id)}/activities`, input)),

  tasks: async (id: string): Promise<Task[]> => (await getData<TaskRow[]>(`/leads/${enc(id)}/tasks`)).map(mapTaskRow),

  addTask: async (id: string, input: TaskInput): Promise<Task> => mapTaskRow(await postData<TaskRow>(`/leads/${enc(id)}/tasks`, input)),
};

export const signalApi = {
  /** Sends the Sarvam agent's JSON file content as-is; the API scrubs and upserts it. */
  import: async (payload: unknown): Promise<SignalImportResult> => {
    const { data } = await http.post<{ imported?: unknown; skipped?: unknown; reasons?: unknown[] } | null>("/signals/import", payload);
    return {
      imported: Number(data?.imported) || 0,
      skipped: Number(data?.skipped) || 0,
      reasons: Array.isArray(data?.reasons) ? data.reasons.map(String) : [],
    };
  },

  list: async (filters: { course?: string | null; city?: string | null; status?: string | null } = {}): Promise<IntentSignal[]> => {
    const params: Record<string, string> = {};
    if (filters.course) params.course = filters.course;
    if (filters.city) params.city = filters.city;
    if (filters.status) params.status = filters.status;
    const { data } = await http.get<{ signals?: SignalRow[] } | null>("/signals", { params });
    return Array.isArray(data?.signals) ? data.signals.map(mapSignalRow) : [];
  },

  updateStatus: async (id: string, status: IntentSignalStatus): Promise<IntentSignal> => {
    const { data } = await http.patch<{ signal: SignalRow }>(`/signals/${enc(id)}`, { status });
    return mapSignalRow(data.signal);
  },

  /** Opt-out / erasure request: hard-deletes the signal, including any published contact. */
  delete: async (id: string): Promise<void> => {
    await http.delete(`/signals/${enc(id)}`);
  },
};
