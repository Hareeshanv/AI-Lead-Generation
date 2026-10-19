import { dbClient } from "../client";
import { dbError, type PageResult, type PageSpec } from "../helpers";

export type LeadRow = Record<string, any> & { id: string; org_id: string };

export interface LeadListFilters {
  /** Free text matched against name, company, email, phone, title and location. */
  q?: string;
  status?: string[];
  source?: string[];
  sourcePlatform?: string;
  /** A user id, or null for unassigned leads. */
  ownerId?: string | null;
  minScore?: number;
  maxScore?: number;
  createdFrom?: string;
  createdTo?: string;
  /** Lead matches when it has any of these tags. */
  tags?: string[];
  campaignName?: string;
  courseInterest?: string;
  examYear?: string;
}

export interface LeadFacets {
  sources: string[];
  sourcePlatforms: string[];
  campaigns: string[];
  courses: string[];
  examYears: string[];
  tags: string[];
}

/** Characters with meaning in PostgREST filter strings; removed from user search text. */
const POSTGREST_SPECIAL = /[,()*%"\\:]/g;

export function sanitizeSearchText(text: string): string {
  return text.replace(POSTGREST_SPECIAL, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

const SEARCH_COLUMNS = ["name", "company", "email", "phone", "title", "location"];
/** Rows per batched update RPC call. */
const BATCH_SIZE = 500;

function applyFilters<Q extends { [k: string]: any }>(query: Q, f: LeadListFilters): Q {
  let q: any = query;
  if (f.q) {
    const words = sanitizeSearchText(f.q).split(" ").filter(Boolean).slice(0, 5);
    for (const word of words) q = q.or(SEARCH_COLUMNS.map((c) => `${c}.ilike."%${word}%"`).join(","));
  }
  if (f.status?.length) q = q.in("status", f.status);
  if (f.source?.length) q = q.in("source", f.source);
  if (f.sourcePlatform) q = f.sourcePlatform === "none" ? q.is("source_platform", null) : q.eq("source_platform", f.sourcePlatform);
  if (f.ownerId === null) q = q.is("owner_id", null);
  else if (f.ownerId) q = q.eq("owner_id", f.ownerId);
  if (f.minScore != null) q = q.gte("score", f.minScore);
  if (f.maxScore != null) q = q.lte("score", f.maxScore);
  if (f.createdFrom) q = q.gte("created_at", f.createdFrom);
  if (f.createdTo) q = q.lte("created_at", f.createdTo);
  if (f.tags?.length) q = q.overlaps("tags", f.tags);
  if (f.campaignName) q = q.eq("campaign_name", f.campaignName);
  if (f.courseInterest) q = q.eq("course_interest", f.courseInterest);
  if (f.examYear) q = q.eq("exam_year", f.examYear);
  return q as Q;
}

const uniqSorted = (values: unknown[]) =>
  Array.from(new Set(values.filter((v): v is string => typeof v === "string" && v.trim() !== ""))).sort((a, b) =>
    a.localeCompare(b)
  );

/** Owned by the Leads module; every function takes orgId first. */
export const leadsDb = {
  async list(orgId: string, filters: LeadListFilters, page: PageSpec): Promise<PageResult<LeadRow>> {
    let query = applyFilters(dbClient.from("leads").select("*", { count: "exact" }).eq("org_id", orgId), filters);
    if (page.sort) query = query.order(page.sort.column, { ascending: page.sort.ascending, nullsFirst: false });
    if (page.sort?.column !== "created_at") query = query.order("created_at", { ascending: false });
    const { data, error, count } = await query.order("id", { ascending: true }).range(page.from, page.to);
    if (error) throw dbError("list leads", error);
    return { rows: (data || []) as LeadRow[], total: count ?? 0 };
  },

  async get(orgId: string, leadId: string): Promise<LeadRow | null> {
    const { data, error } = await dbClient.from("leads").select("*").eq("org_id", orgId).eq("id", leadId).maybeSingle();
    if (error) throw dbError("get lead", error);
    return data as LeadRow | null;
  },

  async getMany(orgId: string, leadIds: string[]): Promise<LeadRow[]> {
    if (leadIds.length === 0) return [];
    const { data, error } = await dbClient.from("leads").select("*").eq("org_id", orgId).in("id", leadIds);
    if (error) throw dbError("get leads", error);
    return (data || []) as LeadRow[];
  },

  async create(orgId: string, row: Record<string, unknown>): Promise<LeadRow> {
    const { data, error } = await dbClient
      .from("leads")
      .insert({ ...row, org_id: orgId })
      .select()
      .single();
    if (error) throw dbError("create lead", error);
    return data as LeadRow;
  },

  /** Returns null when the org has no such lead. */
  async update(orgId: string, leadId: string, patch: Record<string, unknown>): Promise<LeadRow | null> {
    const { data, error } = await dbClient
      .from("leads")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", leadId)
      .select()
      .maybeSingle();
    if (error) throw dbError("update lead", error);
    return data as LeadRow | null;
  },

  /** Same patch for many leads; returns the updated rows. */
  async updateMany(orgId: string, leadIds: string[], patch: Record<string, unknown>): Promise<LeadRow[]> {
    if (leadIds.length === 0) return [];
    const { data, error } = await dbClient.from("leads").update(patch).eq("org_id", orgId).in("id", leadIds).select();
    if (error) throw dbError("update leads", error);
    return (data || []) as LeadRow[];
  },

  async removeMany(orgId: string, leadIds: string[]): Promise<string[]> {
    if (leadIds.length === 0) return [];
    const { data, error } = await dbClient.from("leads").delete().eq("org_id", orgId).in("id", leadIds).select("id");
    if (error) throw dbError("delete leads", error);
    return (data || []).map((r: any) => r.id as string);
  },

  /** Distinct values for filter dropdowns (scans at most 5,000 recent leads). */
  async facets(orgId: string): Promise<LeadFacets> {
    const { data, error } = await dbClient
      .from("leads")
      .select("source, source_platform, campaign_name, course_interest, exam_year, tags")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw dbError("lead facets", error);
    const rows = data || [];
    return {
      sources: uniqSorted(rows.map((r: any) => r.source)),
      sourcePlatforms: uniqSorted(rows.map((r: any) => r.source_platform)),
      campaigns: uniqSorted(rows.map((r: any) => r.campaign_name)),
      courses: uniqSorted(rows.map((r: any) => r.course_interest)),
      examYears: uniqSorted(rows.map((r: any) => (r.exam_year == null ? null : String(r.exam_year)))),
      tags: uniqSorted(rows.flatMap((r: any) => (Array.isArray(r.tags) ? r.tags : []))),
    };
  },

  /** Different score/status per lead in one statement per 500 rows; returns the updated rows. */
  async updateScores(orgId: string, rows: LeadScoreUpdate[]): Promise<LeadRow[]> {
    const updated: LeadRow[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const { data, error } = await dbClient.rpc("update_lead_scores", {
        p_org_id: orgId,
        p_rows: rows.slice(i, i + BATCH_SIZE),
      });
      if (error) throw dbError("update lead scores", error);
      updated.push(...((data || []) as LeadRow[]));
    }
    return updated;
  },

  /** Adds and/or removes tags on many leads (order kept, no duplicates); returns only the rows that changed. */
  async updateTags(orgId: string, leadIds: string[], change: { add?: string[]; remove?: string[] }): Promise<LeadRow[]> {
    const updated: LeadRow[] = [];
    for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
      const { data, error } = await dbClient.rpc("update_lead_tags", {
        p_org_id: orgId,
        p_lead_ids: leadIds.slice(i, i + BATCH_SIZE),
        p_add: change.add ?? [],
        p_remove: change.remove ?? [],
      });
      if (error) throw dbError("update lead tags", error);
      updated.push(...((data || []) as LeadRow[]));
    }
    return updated;
  },

  /** Ad leads (source_platform set) that have not been scored yet, oldest first. */
  async listUnscoredAdLeads(orgId: string, limit = 50): Promise<LeadRow[]> {
    const { data, error } = await dbClient
      .from("leads")
      .select("*")
      .eq("org_id", orgId)
      .is("scored_at", null)
      .not("source_platform", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw dbError("list unscored ad leads", error);
    return (data || []) as LeadRow[];
  },

  /**
   * System-wide lookup for the background scorer: org ids that have unscored ad leads. Returns ids
   * only; every read and write after it is scoped to one org.
   */
  async listOrgIdsWithUnscoredAdLeads(limit = 500): Promise<string[]> {
    const { data, error } = await dbClient
      .from("leads")
      .select("org_id")
      .is("scored_at", null)
      .not("source_platform", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw dbError("list orgs with unscored ad leads", error);
    return Array.from(new Set((data || []).map((r: any) => String(r.org_id))));
  },
};

export interface LeadScoreUpdate {
  id: string;
  score: number;
  status?: string | null;
  /** Defaults to now(). */
  scored_at?: string | null;
}
