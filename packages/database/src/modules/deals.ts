import { dbClient } from "../client";
import { dbError, type PageResult, type PageSpec } from "../helpers";

export type DealRow = Record<string, any> & {
  id: string;
  org_id: string;
  stage: string;
  lead_id: string | null;
  owner_id: string | null;
  lead?: { id: string; name: string; company: string | null; email: string | null; phone: string | null; status: string | null; score: number | null } | null;
};

export interface DealListFilters {
  stage?: string[];
  /** A user id, or null for unassigned deals. */
  ownerId?: string | null;
  leadId?: string;
  q?: string;
}

export interface DealStageTotals {
  count: number;
  value: number;
  /** Sum of value × probability / 100. */
  weighted: number;
}

const WITH_LEAD = "*, lead:leads(id, name, company, email, phone, status, score)";
/** PostgREST caps responses at 1,000 rows by default, so aggregates read in chunks of this size. */
const CHUNK = 1000;
const MAX_AGGREGATE_ROWS = 50_000;

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const normalize = (row: any): DealRow => ({ ...row, lead: one(row.lead) });

/** Generic over the builder so callers keep their select()'s row type. */
function applyDealFilters<Q>(query: Q, filters: DealListFilters): Q {
  let q = query as any;
  if (filters.stage?.length) q = q.in("stage", filters.stage);
  if (filters.ownerId === null) q = q.is("owner_id", null);
  else if (filters.ownerId) q = q.eq("owner_id", filters.ownerId);
  if (filters.leadId) q = q.eq("lead_id", filters.leadId);
  if (filters.q) {
    const text = filters.q.replace(/[,()*%"\\:]/g, " ").trim().slice(0, 100);
    if (text) q = q.or(["title", "company", "contact"].map((c) => `${c}.ilike."%${text}%"`).join(","));
  }
  return q;
}

/** Owned by the CRM module; every function takes orgId first. */
export const dealsDb = {
  /** The whole board (at most 2,000 deals), ordered by position within each stage. */
  async list(orgId: string, filters: DealListFilters = {}): Promise<DealRow[]> {
    const { data, error } = await applyDealFilters(dbClient.from("deals").select(WITH_LEAD).eq("org_id", orgId), filters)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw dbError("list deals", error);
    return (data || []).map(normalize);
  },

  /** One page in board order (position within stage), with the total matching count. */
  async listPage(orgId: string, filters: DealListFilters, page: Pick<PageSpec, "from" | "to">): Promise<PageResult<DealRow>> {
    const { data, error, count } = await applyDealFilters(
      dbClient.from("deals").select(WITH_LEAD, { count: "exact" }).eq("org_id", orgId),
      filters
    )
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page.from, page.to);
    if (error) throw dbError("list deals", error);
    return { rows: (data || []).map(normalize), total: count ?? 0 };
  },

  /** Count, value and weighted value per stage for every matching deal (not just a page). */
  async stageTotals(orgId: string, filters: DealListFilters = {}): Promise<Record<string, DealStageTotals>> {
    const totals: Record<string, DealStageTotals> = {};
    for (let from = 0; from < MAX_AGGREGATE_ROWS; from += CHUNK) {
      const { data, error } = await applyDealFilters(
        dbClient.from("deals").select("stage, value, probability").eq("org_id", orgId),
        filters
      )
        .order("id", { ascending: true })
        .range(from, from + CHUNK - 1);
      if (error) throw dbError("total deals", error);
      for (const row of data || []) {
        const t = (totals[row.stage] ??= { count: 0, value: 0, weighted: 0 });
        const value = Number(row.value) || 0;
        t.count++;
        t.value += value;
        t.weighted += (value * (Number(row.probability) || 0)) / 100;
      }
      if (!data || data.length < CHUNK) break;
    }
    return totals;
  },

  async createMany(orgId: string, rows: Record<string, unknown>[]): Promise<DealRow[]> {
    if (rows.length === 0) return [];
    const { data, error } = await dbClient
      .from("deals")
      .insert(rows.map((row) => ({ ...row, org_id: orgId })))
      .select(WITH_LEAD);
    if (error) throw dbError("create deals", error);
    return (data || []).map(normalize);
  },

  async get(orgId: string, dealId: string): Promise<DealRow | null> {
    const { data, error } = await dbClient.from("deals").select(WITH_LEAD).eq("org_id", orgId).eq("id", dealId).maybeSingle();
    if (error) throw dbError("get deal", error);
    return data ? normalize(data) : null;
  },

  async create(orgId: string, row: Record<string, unknown>): Promise<DealRow> {
    const { data, error } = await dbClient
      .from("deals")
      .insert({ ...row, org_id: orgId })
      .select(WITH_LEAD)
      .single();
    if (error) throw dbError("create deal", error);
    return normalize(data);
  },

  /** Returns null when the org has no such deal. */
  async update(orgId: string, dealId: string, patch: Record<string, unknown>): Promise<DealRow | null> {
    const { data, error } = await dbClient
      .from("deals")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", dealId)
      .select(WITH_LEAD)
      .maybeSingle();
    if (error) throw dbError("update deal", error);
    return data ? normalize(data) : null;
  },

  /** Returns null when the org has no such deal. */
  async updateStage(orgId: string, dealId: string, stage: string) {
    return dealsDb.update(orgId, dealId, { stage });
  },

  async remove(orgId: string, dealId: string): Promise<boolean> {
    const { data, error } = await dbClient.from("deals").delete().eq("org_id", orgId).eq("id", dealId).select("id");
    if (error) throw dbError("delete deal", error);
    return (data || []).length > 0;
  },

  /** Lowest position in a stage (new and moved cards go on top); 0 for an empty stage. */
  async minPosition(orgId: string, stage: string): Promise<number> {
    const { data, error } = await dbClient
      .from("deals")
      .select("position")
      .eq("org_id", orgId)
      .eq("stage", stage)
      .order("position", { ascending: true })
      .limit(1);
    if (error) throw dbError("get deal position", error);
    return Number(data?.[0]?.position ?? 0) || 0;
  },
};
