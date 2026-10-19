import { dbClient } from "./client";
import { dbError, NOT_FOUND, UNIQUE_VIOLATION } from "./helpers";

const EMAIL_NOT_AVAILABLE = "Not available";

function leadKey(lead: Record<string, any>): string {
  const email = String(lead.email || "").trim().toLowerCase();
  if (email && email !== EMAIL_NOT_AVAILABLE.toLowerCase()) return `email:${email}`;
  return `name:${String(lead.name || "").trim().toLowerCase()}|${String(lead.company || "").trim().toLowerCase()}`;
}

export interface InsertNewLeadsResult {
  inserted: any[];
  duplicates: number;
}

/**
 * Lead search criteria with aliases already resolved. Pattern values are ilike fragments
 * without surrounding % and must already be stripped of PostgREST syntax characters.
 */
export interface LeadSearchCriteria {
  /** Course fragments matched against course_interest, industry and title. */
  coursePatterns?: string[];
  /** Exact tag values; a lead matches when tags overlaps any of them. */
  courseTags?: string[];
  /** City spellings matched against location. */
  cityAliases?: string[];
  exam_year?: string | null;
  source_platform?: string | null;
  status?: string | null;
  min_score?: number | null;
  /** Free-text fragments; each must match one of name/title/company/industry/course_interest/location. */
  keywords?: string[];
  limit?: number;
}

export interface SignalSearchCriteria {
  coursePatterns?: string[];
  cityAliases?: string[];
  status?: string | null;
  /** Hide dismissed signals unless a status is requested explicitly. */
  excludeDismissed?: boolean;
  /** "score" (default): highest intent first. "newest": most recently discovered first. */
  orderBy?: "score" | "newest";
  limit?: number;
}

const ilikeAny = (columns: string[], fragments: string[]) =>
  columns.flatMap((col) => fragments.map((f) => `${col}.ilike."%${f}%"`));

const pgArray = (values: string[]) => `{${values.map((v) => `"${v}"`).join(",")}}`;

const withOrg = <T extends Record<string, any>>(orgId: string, row: T) => ({ ...row, org_id: orgId });

/** Every query on org-owned data takes orgId first; system-wide jobs are marked as such. */
export const dbQueries = {
  // Leads
  async insertLead(orgId: string, leadData: Record<string, any>) {
    const { data, error } = await dbClient.from("leads").insert([withOrg(orgId, leadData)]).select();
    if (error) throw dbError("insert lead", error);
    return data?.[0];
  },

  /** Insert many leads in one request and return the inserted rows (with ids). */
  async insertLeads(orgId: string, leads: Record<string, any>[]) {
    if (leads.length === 0) return [];
    const { data, error } = await dbClient
      .from("leads")
      .insert(leads.map((l) => withOrg(orgId, l)))
      .select();
    if (error) throw dbError("insert leads", error);
    return data || [];
  },

  /**
   * Insert leads that are not already stored in the org. Duplicates are matched on lower(email),
   * or on name + company for leads without an email. Returns the inserted rows.
   */
  async insertNewLeads(orgId: string, leads: Record<string, any>[]): Promise<InsertNewLeadsResult> {
    const seen = new Set<string>();
    const unique: Record<string, any>[] = [];
    for (const lead of leads) {
      const key = leadKey(lead);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(withOrg(orgId, lead));
    }

    const existingKeys = new Set<string>();
    const emails = unique.map((l) => String(l.email || "")).filter((e) => e && e !== EMAIL_NOT_AVAILABLE);
    if (emails.length > 0) {
      const { data, error } = await dbClient.from("leads").select("email").eq("org_id", orgId).in("email", emails);
      if (error) throw dbError("check existing lead emails", error);
      for (const row of data || []) existingKeys.add(leadKey(row));
    }
    const namesWithoutEmail = unique.filter((l) => !l.email || l.email === EMAIL_NOT_AVAILABLE).map((l) => l.name);
    if (namesWithoutEmail.length > 0) {
      const { data, error } = await dbClient
        .from("leads")
        .select("name, company, email")
        .eq("org_id", orgId)
        .eq("email", EMAIL_NOT_AVAILABLE)
        .in("name", namesWithoutEmail);
      if (error) throw dbError("check existing lead names", error);
      for (const row of data || []) existingKeys.add(leadKey(row));
    }

    const toInsert = unique.filter((l) => !existingKeys.has(leadKey(l)));
    let duplicates = leads.length - toInsert.length;
    if (toInsert.length === 0) return { inserted: [], duplicates };

    const { data, error } = await dbClient.from("leads").insert(toInsert).select();
    if (!error) return { inserted: data || [], duplicates };
    if (error.code !== UNIQUE_VIOLATION) throw dbError("insert leads", error);

    // A stored email differs only by case: insert row by row and skip the conflicting ones.
    const inserted: any[] = [];
    for (const lead of toInsert) {
      const res = await dbClient.from("leads").insert([lead]).select();
      if (res.error) {
        if (res.error.code === UNIQUE_VIOLATION) {
          duplicates++;
          continue;
        }
        throw dbError("insert lead", res.error);
      }
      if (res.data?.[0]) inserted.push(res.data[0]);
    }
    return { inserted, duplicates };
  },

  /** Filtered lead search. Every provided criterion must match (AND); alternatives inside one criterion are OR. */
  async searchLeads(orgId: string, criteria: LeadSearchCriteria) {
    let query = dbClient.from("leads").select("*").eq("org_id", orgId);

    const course = criteria.coursePatterns || [];
    const tags = criteria.courseTags || [];
    if (course.length > 0 || tags.length > 0) {
      const parts = ilikeAny(["course_interest", "industry", "title"], course);
      if (tags.length > 0) parts.push(`tags.ov.${pgArray(tags)}`);
      query = query.or(parts.join(","));
    }

    const cities = criteria.cityAliases || [];
    if (cities.length > 0) query = query.or(ilikeAny(["location"], cities).join(","));

    if (criteria.exam_year) query = query.eq("exam_year", criteria.exam_year);
    if (criteria.source_platform) query = query.eq("source_platform", criteria.source_platform);
    if (criteria.status) query = query.ilike("status", criteria.status);
    if (typeof criteria.min_score === "number") query = query.gte("score", criteria.min_score);

    for (const keyword of criteria.keywords || []) {
      query = query.or(
        ilikeAny(["name", "title", "company", "industry", "course_interest", "location"], [keyword]).join(",")
      );
    }

    const { data, error } = await query
      .order("score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(criteria.limit ?? 200);
    if (error) throw dbError("search leads", error);
    return data || [];
  },

  // Intent signals (public posts showing course intent). Free text is redacted; published_contact is
  // set only for verified contact requests. Contact-requested signals sort first.
  async searchIntentSignals(orgId: string, criteria: SignalSearchCriteria) {
    let query = dbClient.from("intent_signals").select("*").eq("org_id", orgId);

    const course = criteria.coursePatterns || [];
    if (course.length > 0) {
      query = query.or(ilikeAny(["course_interest", "post_excerpt", "search_query"], course).join(","));
    }

    const cities = criteria.cityAliases || [];
    if (cities.length > 0) query = query.or(ilikeAny(["city", "search_city"], cities).join(","));

    if (criteria.status) query = query.eq("status", criteria.status);
    else if (criteria.excludeDismissed) query = query.neq("status", "dismissed");

    query = query.order("contact_requested", { ascending: false });
    query =
      criteria.orderBy === "newest"
        ? query.order("discovered_at", { ascending: false, nullsFirst: false })
        : query.order("intent_score", { ascending: false, nullsFirst: false });

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(criteria.limit ?? 100);
    if (error) throw dbError("search intent signals", error);
    return data || [];
  },

  /**
   * Upserts on (org_id, post_url). Rows must already be scrubbed of contact details, except a verified
   * published_contact (contact_requested = true; the table's CHECK constraint enforces the pairing).
   * Rows without a status are sent separately so a re-import never resets a triaged status.
   */
  async upsertIntentSignals(orgId: string, rows: Record<string, any>[]) {
    const scoped = rows.map((r) => withOrg(orgId, r));
    const withStatus = scoped.filter((r) => r.status !== undefined);
    const withoutStatus = scoped.filter((r) => r.status === undefined);
    const saved: any[] = [];
    for (const batch of [withStatus, withoutStatus]) {
      if (batch.length === 0) continue;
      const { data, error } = await dbClient
        .from("intent_signals")
        .upsert(batch, { onConflict: "org_id,post_url" })
        .select();
      if (error) throw dbError("import intent signals", error);
      saved.push(...(data || []));
    }
    return saved;
  },

  /** Returns null when the org has no signal with this id. */
  async updateIntentSignalStatus(orgId: string, signalId: string, status: string) {
    const { data, error } = await dbClient
      .from("intent_signals")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", signalId)
      .select();
    if (error) throw dbError("update intent signal", error);
    return data?.[0] ?? null;
  },

  /** Hard-deletes one signal (opt-out requests). Returns false when no row matched. */
  async deleteIntentSignal(orgId: string, signalId: string): Promise<boolean> {
    const { data, error } = await dbClient
      .from("intent_signals")
      .delete()
      .eq("org_id", orgId)
      .eq("id", signalId)
      .select("id");
    if (error) throw dbError("delete intent signal", error);
    return (data || []).length > 0;
  },

  /** Hard-deletes one lead, including its raw form answers. Returns false when no row matched. */
  async deleteLead(orgId: string, leadId: string): Promise<boolean> {
    const { data, error } = await dbClient.from("leads").delete().eq("org_id", orgId).eq("id", leadId).select("id");
    if (error) throw dbError("erase lead", error);
    return (data || []).length > 0;
  },

  // Lead sources (ad platform integrations)
  async getLeadSources(orgId: string) {
    const { data, error } = await dbClient
      .from("lead_sources")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throw dbError("get lead sources", error);
    return data || [];
  },

  async getLeadSource(orgId: string, sourceId: string) {
    const { data, error } = await dbClient
      .from("lead_sources")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", sourceId)
      .maybeSingle();
    if (error) throw dbError("get lead source", error);
    return data;
  },

  async insertLeadSource(orgId: string, source: Record<string, any>) {
    const { data, error } = await dbClient.from("lead_sources").insert([withOrg(orgId, source)]).select();
    if (error) throw dbError("insert lead source", error);
    return data?.[0];
  },

  /** Creates or updates the org's lead source for one platform page (matched on platform + external_page_id). */
  async upsertLeadSourceByPage(orgId: string, platform: string, externalPageId: string, values: Record<string, any>) {
    const existing = await dbClient
      .from("lead_sources")
      .select("id, org_id")
      .eq("platform", platform)
      .eq("external_page_id", externalPageId)
      .limit(1);
    if (existing.error) throw dbError("find lead source", existing.error);

    const found = existing.data?.[0];
    if (found && found.org_id !== orgId) {
      throw new Error("This page is already connected to another workspace.");
    }
    const query = found
      ? dbClient.from("lead_sources").update(values).eq("id", found.id).select()
      : dbClient
          .from("lead_sources")
          .insert([withOrg(orgId, { ...values, platform, external_page_id: externalPageId })])
          .select();
    const { data, error } = await query;
    if (error) throw dbError("save lead source", error);
    return data?.[0];
  },

  async deleteLeadSource(orgId: string, sourceId: string): Promise<boolean> {
    const { data, error } = await dbClient
      .from("lead_sources")
      .delete()
      .eq("org_id", orgId)
      .eq("id", sourceId)
      .select("id");
    if (error) throw dbError("delete lead source", error);
    return (data || []).length > 0;
  },

  /** Stores a platform access token in Supabase Vault via a service-role-only RPC. Check org ownership first. */
  async storeLeadSourceToken(sourceId: string, token: string): Promise<string> {
    const { data, error } = await dbClient.rpc("store_lead_source_token", {
      p_source_id: sourceId,
      p_token: token,
    });
    if (error) throw dbError("store lead source token", error);
    return data as string;
  },

  /** Removes the source's Vault secret (if any) via a service-role-only RPC. Check org ownership first. */
  async deleteLeadSourceToken(sourceId: string): Promise<void> {
    const { error } = await dbClient.rpc("delete_lead_source_token", { p_source_id: sourceId });
    if (error) throw dbError("delete lead source token", error);
  },

  // Agents (global catalog)
  async getAgentStatus(agentId: string) {
    const { data, error } = await dbClient.from("agents").select("*").eq("id", agentId).single();
    if (error) {
      if (error.code === NOT_FOUND) return null;
      throw dbError("get agent", error);
    }
    return data;
  },

  async getAllAgentStatuses() {
    const { data, error } = await dbClient.from("agents").select("*");
    if (error) throw dbError("get agents", error);
    return data || [];
  },

  /** Telemetry must never break the pipeline: failures are logged, not thrown. */
  async logAgentTelemetry(agentId: string, level: "info" | "warn" | "error", message: string, orgId?: string | null) {
    try {
      const { error } = await dbClient
        .from("agent_logs")
        .insert([{ agent_id: agentId, level, message, org_id: orgId ?? null }]);
      if (error) console.warn(`[DB] Agent telemetry insert failed: ${error.message}`);
    } catch (err: any) {
      console.warn(`[DB] Agent telemetry insert failed: ${err?.message}`);
    }
  },

  async getAgentLogs(orgId: string, agentId: string, limit = 50) {
    const { data, error } = await dbClient
      .from("agent_logs")
      .select("*")
      .eq("org_id", orgId)
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError("get agent logs", error);
    return data || [];
  },

  // Pipeline runs
  async createPipelineRun(orgId: string, runData: Record<string, any>) {
    const { data, error } = await dbClient.from("pipeline_runs").insert([withOrg(orgId, runData)]).select();
    if (error) throw dbError("create pipeline run", error);
    return data?.[0];
  },

  async getPipelineRuns(orgId: string, limit: number = 20) {
    const { data, error } = await dbClient
      .from("pipeline_runs")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError("get pipeline runs", error);
    return data || [];
  },

  async countPipelineRuns(orgId: string, campaignName: string): Promise<number> {
    const { count, error } = await dbClient
      .from("pipeline_runs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("campaign_name", campaignName);
    if (error) throw dbError("count pipeline runs", error);
    return count ?? 0;
  },

  async getPipelineRunById(orgId: string, runId: string) {
    const { data, error } = await dbClient
      .from("pipeline_runs")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", runId)
      .maybeSingle();
    if (error) throw dbError("get pipeline run", error);
    return data;
  },

  // Agent executions (per-step tracking); org_id is filled from the pipeline run by a trigger.
  async logAgentExecution(execData: Record<string, any>) {
    const { data, error } = await dbClient.from("agent_executions").insert([execData]).select();
    if (error) throw dbError("log agent execution", error);
    return data?.[0];
  },

  async getAgentExecutions(orgId: string, pipelineRunId: string) {
    const { data, error } = await dbClient
      .from("agent_executions")
      .select("*")
      .eq("org_id", orgId)
      .eq("pipeline_run_id", pipelineRunId)
      .order("created_at", { ascending: true });
    if (error) throw dbError("get agent executions", error);
    return data || [];
  },
};
