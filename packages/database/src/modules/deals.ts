import { dbClient } from "../client";
import { dbError } from "../helpers";

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

const WITH_LEAD = "*, lead:leads(id, name, company, email, phone, status, score)";

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const normalize = (row: any): DealRow => ({ ...row, lead: one(row.lead) });

/** Owned by the CRM module; every function takes orgId first. */
export const dealsDb = {
  /** The whole board (at most 2,000 deals), ordered by position within each stage. */
  async list(orgId: string, filters: DealListFilters = {}): Promise<DealRow[]> {
    let query = dbClient.from("deals").select(WITH_LEAD).eq("org_id", orgId);
    if (filters.stage?.length) query = query.in("stage", filters.stage);
    if (filters.ownerId === null) query = query.is("owner_id", null);
    else if (filters.ownerId) query = query.eq("owner_id", filters.ownerId);
    if (filters.leadId) query = query.eq("lead_id", filters.leadId);
    if (filters.q) {
      const text = filters.q.replace(/[,()*%"\\:]/g, " ").trim().slice(0, 100);
      if (text) query = query.or(["title", "company", "contact"].map((c) => `${c}.ilike."%${text}%"`).join(","));
    }
    const { data, error } = await query
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw dbError("list deals", error);
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
