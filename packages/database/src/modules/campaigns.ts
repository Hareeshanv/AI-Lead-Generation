import { dbClient } from "../client";
import { dbError, UNIQUE_VIOLATION, type PageResult, type PageSpec } from "../helpers";

export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed";
export type CampaignChannel = "email" | "whatsapp";
export type RecipientStatus =
  | "pending"
  | "active"
  | "completed"
  | "replied"
  | "bounced"
  | "unsubscribed"
  | "failed"
  | "skipped";
export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "failed"
  | "received";

export interface CampaignRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  channel: CampaignChannel;
  audience_filter: Record<string, any>;
  send_window: Record<string, any>;
  throttle_per_hour: number;
  from_identity: Record<string, any>;
  scheduled_at: string | null;
  launched_at: string | null;
  completed_at: string | null;
  total_leads: number | null;
  sent_count: number | null;
  delivered_count: number;
  bounced_count: number;
  open_rate: number | string | null;
  click_rate: number | string | null;
  reply_rate: number | string | null;
  schedule: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignStepRow {
  id: string;
  org_id: string;
  campaign_id: string;
  position: number;
  delay_minutes: number;
  subject: string | null;
  body: string | null;
  whatsapp_template: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipientRow {
  id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  status: RecipientStatus;
  current_step: number;
  next_run_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  org_id: string;
  campaign_id: string | null;
  step_id: string | null;
  recipient_id: string | null;
  lead_id: string | null;
  channel: CampaignChannel;
  direction: "outbound" | "inbound";
  provider: "resend" | "whatsapp";
  provider_message_id: string | null;
  to_address: string | null;
  from_address: string | null;
  subject: string | null;
  body: string | null;
  status: MessageStatus;
  status_history: { status: string; at: string; detail?: string | null }[];
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Lead columns campaigns need for audience resolution and sending. */
export interface CampaignLeadRow {
  id: string;
  name: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  status: string | null;
  source: string | null;
  score: number | null;
  tags: string[] | null;
  course_interest: string | null;
  owner_id: string | null;
  do_not_contact: boolean | null;
  consent_channel: string[] | null;
  consent_at: string | null;
  created_at: string | null;
}

export const CAMPAIGN_LEAD_COLUMNS =
  "id, name, title, company, email, phone, location, status, source, score, tags, course_interest, owner_id, " +
  "do_not_contact, consent_channel, consent_at, created_at";

/** DB-level lead criteria (eligibility checks happen in the API). */
export interface LeadCriteria {
  statuses?: string[];
  sources?: string[];
  tags?: string[];
  minScore?: number;
  maxScore?: number;
  ownerId?: string | null;
  createdAfter?: string;
  createdBefore?: string;
  courseInterest?: string;
  location?: string;
  q?: string;
}

export interface CampaignInsert {
  name: string;
  description?: string | null;
  channel: CampaignChannel;
  audience_filter?: Record<string, any>;
  send_window?: Record<string, any>;
  throttle_per_hour?: number;
  from_identity?: Record<string, any>;
  scheduled_at?: string | null;
  created_by?: string | null;
}

export type CampaignPatch = Partial<
  Pick<
    CampaignRow,
    | "name"
    | "description"
    | "channel"
    | "status"
    | "audience_filter"
    | "send_window"
    | "throttle_per_hour"
    | "from_identity"
    | "scheduled_at"
    | "launched_at"
    | "completed_at"
    | "total_leads"
    | "sent_count"
    | "delivered_count"
    | "bounced_count"
    | "open_rate"
    | "click_rate"
    | "reply_rate"
  >
>;

export interface StepInput {
  delay_minutes: number;
  subject?: string | null;
  body?: string | null;
  whatsapp_template?: Record<string, any> | null;
}

export interface RecipientInsert {
  lead_id: string;
  status: RecipientStatus;
  current_step?: number;
  next_run_at?: string | null;
  last_error?: string | null;
}

export interface RecipientCounts {
  total: number;
  byStatus: Record<RecipientStatus, number>;
}

export interface MessageCounts {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  failed: number;
}

export interface NewJobRow {
  type: string;
  payload: Record<string, any>;
  runAt: string;
  dedupeKey: string;
}

const RECIPIENT_STATUSES: RecipientStatus[] = [
  "pending",
  "active",
  "completed",
  "replied",
  "bounced",
  "unsubscribed",
  "failed",
  "skipped",
];

const PAGE = 1000;
const IN_CHUNK = 200;

/** Strips characters that would break a PostgREST or()/ilike filter. */
function safeLike(value: string): string {
  return value.replace(/[,()*%\\]/g, " ").trim();
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function applyLeadCriteria<Q extends { [k: string]: any }>(query: Q, c: LeadCriteria): Q {
  let q: any = query;
  if (c.statuses?.length) q = q.in("status", c.statuses);
  if (c.sources?.length) q = q.in("source", c.sources);
  if (c.tags?.length) q = q.overlaps("tags", c.tags);
  if (c.minScore != null) q = q.gte("score", c.minScore);
  if (c.maxScore != null) q = q.lte("score", c.maxScore);
  if (c.ownerId === null) q = q.is("owner_id", null);
  else if (c.ownerId) q = q.eq("owner_id", c.ownerId);
  if (c.createdAfter) q = q.gte("created_at", c.createdAfter);
  if (c.createdBefore) q = q.lte("created_at", c.createdBefore);
  const course = c.courseInterest ? safeLike(c.courseInterest) : "";
  if (course) q = q.ilike("course_interest", `%${course}%`);
  const location = c.location ? safeLike(c.location) : "";
  if (location) q = q.ilike("location", `%${location}%`);
  const text = c.q ? safeLike(c.q) : "";
  if (text) q = q.or(`name.ilike.%${text}%,company.ilike.%${text}%,email.ilike.%${text}%,phone.ilike.%${text}%`);
  return q as Q;
}

/** Owned by the Campaigns module. Every function takes orgId first. */
export const campaignsDb = {
  async list(
    orgId: string,
    page: PageSpec,
    filter: { status?: CampaignStatus; channel?: CampaignChannel; q?: string } = {}
  ): Promise<PageResult<CampaignRow>> {
    let query = dbClient.from("campaigns").select("*", { count: "exact" }).eq("org_id", orgId);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.channel) query = query.eq("channel", filter.channel);
    const text = filter.q ? safeLike(filter.q) : "";
    if (text) query = query.ilike("name", `%${text}%`);
    const sort = page.sort ?? { column: "created_at", ascending: false };
    const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).range(page.from, page.to);
    if (error) throw dbError("list campaigns", error);
    return { rows: (data || []) as CampaignRow[], total: count ?? 0 };
  },

  async get(orgId: string, campaignId: string): Promise<CampaignRow | null> {
    const { data, error } = await dbClient
      .from("campaigns")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", campaignId)
      .maybeSingle();
    if (error) throw dbError("get campaign", error);
    return data as CampaignRow | null;
  },

  async create(orgId: string, input: CampaignInsert): Promise<CampaignRow> {
    const { data, error } = await dbClient
      .from("campaigns")
      .insert({
        org_id: orgId,
        name: input.name,
        description: input.description ?? null,
        channel: input.channel,
        status: "draft",
        audience_filter: input.audience_filter ?? {},
        send_window: input.send_window ?? {},
        throttle_per_hour: input.throttle_per_hour ?? 100,
        from_identity: input.from_identity ?? {},
        scheduled_at: input.scheduled_at ?? null,
        created_by: input.created_by ?? null,
      })
      .select()
      .single();
    if (error) throw dbError("create campaign", error);
    return data as CampaignRow;
  },

  async update(orgId: string, campaignId: string, patch: CampaignPatch): Promise<CampaignRow | null> {
    const { data, error } = await dbClient
      .from("campaigns")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", campaignId)
      .select()
      .maybeSingle();
    if (error) throw dbError("update campaign", error);
    return data as CampaignRow | null;
  },

  /** Conditional status transition; returns null when the campaign is not in one of `from`. */
  async transition(
    orgId: string,
    campaignId: string,
    from: CampaignStatus[],
    patch: CampaignPatch & { status: CampaignStatus }
  ): Promise<CampaignRow | null> {
    const { data, error } = await dbClient
      .from("campaigns")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", campaignId)
      .in("status", from)
      .select()
      .maybeSingle();
    if (error) throw dbError("update campaign status", error);
    return data as CampaignRow | null;
  },

  async remove(orgId: string, campaignId: string): Promise<boolean> {
    const { data, error } = await dbClient.from("campaigns").delete().eq("org_id", orgId).eq("id", campaignId).select("id");
    if (error) throw dbError("delete campaign", error);
    return (data || []).length > 0;
  },

  // ---- Steps ----

  async listSteps(orgId: string, campaignId: string): Promise<CampaignStepRow[]> {
    const { data, error } = await dbClient
      .from("campaign_steps")
      .select("*")
      .eq("org_id", orgId)
      .eq("campaign_id", campaignId)
      .order("position", { ascending: true });
    if (error) throw dbError("list campaign steps", error);
    return (data || []) as CampaignStepRow[];
  },

  async stepCounts(orgId: string, campaignIds: string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    if (campaignIds.length === 0) return counts;
    const { data, error } = await dbClient
      .from("campaign_steps")
      .select("campaign_id")
      .eq("org_id", orgId)
      .in("campaign_id", campaignIds);
    if (error) throw dbError("count campaign steps", error);
    for (const row of data || []) counts[row.campaign_id] = (counts[row.campaign_id] || 0) + 1;
    return counts;
  },

  /**
   * Makes the steps match `steps` by position: existing positions are updated in place (so
   * messages keep their step_id), new ones inserted, extra ones deleted.
   */
  async replaceSteps(orgId: string, campaignId: string, steps: StepInput[]): Promise<CampaignStepRow[]> {
    const existing = await campaignsDb.listSteps(orgId, campaignId);
    const byPosition = new Map(existing.map((s) => [s.position, s]));

    for (let position = 0; position < steps.length; position++) {
      const step = steps[position];
      const row = {
        delay_minutes: step.delay_minutes,
        subject: step.subject ?? null,
        body: step.body ?? null,
        whatsapp_template: step.whatsapp_template ?? null,
      };
      const current = byPosition.get(position);
      if (current) {
        const { error } = await dbClient.from("campaign_steps").update(row).eq("org_id", orgId).eq("id", current.id);
        if (error) throw dbError("update campaign step", error);
      } else {
        const { error } = await dbClient
          .from("campaign_steps")
          .insert({ ...row, org_id: orgId, campaign_id: campaignId, position });
        if (error) throw dbError("insert campaign step", error);
      }
    }

    const extra = existing.filter((s) => s.position >= steps.length).map((s) => s.id);
    if (extra.length > 0) {
      const { error } = await dbClient.from("campaign_steps").delete().eq("org_id", orgId).in("id", extra);
      if (error) throw dbError("delete campaign steps", error);
    }
    return campaignsDb.listSteps(orgId, campaignId);
  },

  // ---- Audience ----

  /** Leads matching the criteria (up to `limit`), newest first. */
  async findLeads(orgId: string, criteria: LeadCriteria, limit = 20_000): Promise<CampaignLeadRow[]> {
    const rows: CampaignLeadRow[] = [];
    for (let from = 0; from < limit; from += PAGE) {
      const to = Math.min(from + PAGE, limit) - 1;
      const query = applyLeadCriteria(dbClient.from("leads").select(CAMPAIGN_LEAD_COLUMNS).eq("org_id", orgId), criteria);
      const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(from, to);
      if (error) throw dbError("find campaign audience", error);
      rows.push(...((data || []) as unknown as CampaignLeadRow[]));
      if (!data || data.length < to - from + 1) break;
    }
    return rows;
  },

  async countLeads(orgId: string, criteria: LeadCriteria): Promise<number> {
    const query = applyLeadCriteria(
      dbClient.from("leads").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      criteria
    );
    const { count, error } = await query;
    if (error) throw dbError("count campaign audience", error);
    return count ?? 0;
  },

  async getLeadsByIds(orgId: string, leadIds: string[]): Promise<CampaignLeadRow[]> {
    const rows: CampaignLeadRow[] = [];
    for (const ids of chunks([...new Set(leadIds)], IN_CHUNK)) {
      const { data, error } = await dbClient.from("leads").select(CAMPAIGN_LEAD_COLUMNS).eq("org_id", orgId).in("id", ids);
      if (error) throw dbError("get campaign leads", error);
      rows.push(...((data || []) as unknown as CampaignLeadRow[]));
    }
    return rows;
  },

  async getLead(orgId: string, leadId: string): Promise<CampaignLeadRow | null> {
    const { data, error } = await dbClient
      .from("leads")
      .select(CAMPAIGN_LEAD_COLUMNS)
      .eq("org_id", orgId)
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw dbError("get campaign lead", error);
    return data as unknown as CampaignLeadRow | null;
  },

  async markLeadContacted(orgId: string, leadId: string, at: string): Promise<void> {
    const { error } = await dbClient.from("leads").update({ last_contacted_at: at }).eq("org_id", orgId).eq("id", leadId);
    if (error) throw dbError("mark lead contacted", error);
  },

  // ---- Unsubscribes ----

  /** Lowercased addresses among `addresses` that are unsubscribed on the channel. */
  async unsubscribedAmong(orgId: string, channel: CampaignChannel, addresses: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    const unique = [...new Set(addresses.map((a) => a.toLowerCase()).filter(Boolean))];
    for (const batch of chunks(unique, IN_CHUNK)) {
      const { data, error } = await dbClient
        .from("unsubscribes")
        .select("address")
        .eq("org_id", orgId)
        .eq("channel", channel)
        .in("address", batch);
      if (error) throw dbError("check unsubscribes", error);
      for (const row of data || []) found.add(String(row.address).toLowerCase());
    }
    return found;
  },

  /** Idempotent: an existing unsubscribe for the address is kept. */
  async addUnsubscribe(
    orgId: string,
    input: {
      channel: CampaignChannel;
      address: string;
      leadId?: string | null;
      campaignId?: string | null;
      reason?: string | null;
      source?: string | null;
    }
  ): Promise<void> {
    const { error } = await dbClient.from("unsubscribes").insert({
      org_id: orgId,
      channel: input.channel,
      address: input.address.toLowerCase(),
      lead_id: input.leadId ?? null,
      campaign_id: input.campaignId ?? null,
      reason: input.reason ?? null,
      source: input.source ?? null,
    });
    if (error && error.code !== UNIQUE_VIOLATION) throw dbError("add unsubscribe", error);
  },

  // ---- Recipients ----

  async existingRecipientLeadIds(orgId: string, campaignId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await dbClient
        .from("campaign_recipients")
        .select("lead_id")
        .eq("org_id", orgId)
        .eq("campaign_id", campaignId)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw dbError("list campaign recipient leads", error);
      for (const row of data || []) ids.add(row.lead_id);
      if (!data || data.length < PAGE) break;
    }
    return ids;
  },

  /**
   * Inserts recipients. Leads already in the campaign are ignored, or overwritten with
   * `overwrite` (launch: pending rows become active/skipped). Returns the written rows.
   */
  async insertRecipients(
    orgId: string,
    campaignId: string,
    rows: RecipientInsert[],
    options: { overwrite?: boolean } = {}
  ): Promise<CampaignRecipientRow[]> {
    const inserted: CampaignRecipientRow[] = [];
    for (const batch of chunks(rows, 500)) {
      const { data, error } = await dbClient
        .from("campaign_recipients")
        .upsert(
          batch.map((r) => ({
            org_id: orgId,
            campaign_id: campaignId,
            lead_id: r.lead_id,
            status: r.status,
            current_step: r.current_step ?? 0,
            next_run_at: r.next_run_at ?? null,
            last_error: r.last_error ?? null,
          })),
          { onConflict: "campaign_id,lead_id", ignoreDuplicates: !options.overwrite }
        )
        .select();
      if (error) throw dbError("insert campaign recipients", error);
      inserted.push(...((data || []) as CampaignRecipientRow[]));
    }
    return inserted;
  },

  async listRecipientsByStatus(
    orgId: string,
    campaignId: string,
    statuses: RecipientStatus[]
  ): Promise<CampaignRecipientRow[]> {
    const rows: CampaignRecipientRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await dbClient
        .from("campaign_recipients")
        .select("*")
        .eq("org_id", orgId)
        .eq("campaign_id", campaignId)
        .in("status", statuses)
        .order("created_at")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw dbError("list campaign recipients", error);
      rows.push(...((data || []) as CampaignRecipientRow[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  },

  /** Recipients with their lead and latest outbound message, for the detail table. */
  async pageRecipients(
    orgId: string,
    campaignId: string,
    page: PageSpec,
    filter: { status?: RecipientStatus } = {}
  ): Promise<PageResult<CampaignRecipientRow & { lead: Partial<CampaignLeadRow> | null }>> {
    let query = dbClient
      .from("campaign_recipients")
      .select("*, lead:leads(id, name, company, email, phone, status, score)", { count: "exact" })
      .eq("org_id", orgId)
      .eq("campaign_id", campaignId);
    if (filter.status) query = query.eq("status", filter.status);
    const sort = page.sort ?? { column: "created_at", ascending: true };
    const { data, error, count } = await query
      .order(sort.column, { ascending: sort.ascending })
      .order("id")
      .range(page.from, page.to);
    if (error) throw dbError("page campaign recipients", error);
    return { rows: (data || []) as any[], total: count ?? 0 };
  },

  async getRecipient(orgId: string, recipientId: string): Promise<CampaignRecipientRow | null> {
    const { data, error } = await dbClient
      .from("campaign_recipients")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", recipientId)
      .maybeSingle();
    if (error) throw dbError("get campaign recipient", error);
    return data as CampaignRecipientRow | null;
  },

  async updateRecipient(
    orgId: string,
    recipientId: string,
    patch: Partial<Pick<CampaignRecipientRow, "status" | "current_step" | "next_run_at" | "last_error">>,
    onlyIfStatus?: RecipientStatus[]
  ): Promise<CampaignRecipientRow | null> {
    let query = dbClient.from("campaign_recipients").update(patch).eq("org_id", orgId).eq("id", recipientId);
    if (onlyIfStatus?.length) query = query.in("status", onlyIfStatus);
    const { data, error } = await query.select().maybeSingle();
    if (error) throw dbError("update campaign recipient", error);
    return data as CampaignRecipientRow | null;
  },

  /** Deletes a recipient that has not been contacted yet. */
  async removePendingRecipient(orgId: string, campaignId: string, recipientId: string): Promise<boolean> {
    const { data, error } = await dbClient
      .from("campaign_recipients")
      .delete()
      .eq("org_id", orgId)
      .eq("campaign_id", campaignId)
      .eq("id", recipientId)
      .in("status", ["pending", "skipped"])
      .select("id");
    if (error) throw dbError("remove campaign recipient", error);
    return (data || []).length > 0;
  },

  async recipientCounts(orgId: string, campaignId: string): Promise<RecipientCounts> {
    const results = await Promise.all(
      RECIPIENT_STATUSES.map(async (status) => {
        const { count, error } = await dbClient
          .from("campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("campaign_id", campaignId)
          .eq("status", status);
        if (error) throw dbError("count campaign recipients", error);
        return [status, count ?? 0] as const;
      })
    );
    const byStatus = Object.fromEntries(results) as Record<RecipientStatus, number>;
    return { total: results.reduce((sum, [, n]) => sum + n, 0), byStatus };
  },

  // ---- Messages ----

  async messageCounts(orgId: string, campaignId: string): Promise<MessageCounts> {
    const column = async (col: string) => {
      const { count, error } = await dbClient
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("campaign_id", campaignId)
        .eq("direction", "outbound")
        .not(col, "is", null);
      if (error) throw dbError("count campaign messages", error);
      return count ?? 0;
    };
    const [sent, delivered, opened, clicked, replied, bounced, failed] = await Promise.all([
      column("sent_at"),
      column("delivered_at"),
      column("opened_at"),
      column("clicked_at"),
      column("replied_at"),
      column("bounced_at"),
      column("failed_at"),
    ]);
    return { sent, delivered, opened, clicked, replied, bounced, failed };
  },

  async countSentSince(orgId: string, campaignId: string, since: string): Promise<{ count: number; oldest: string | null }> {
    const { data, count, error } = await dbClient
      .from("messages")
      .select("sent_at", { count: "exact" })
      .eq("org_id", orgId)
      .eq("campaign_id", campaignId)
      .eq("direction", "outbound")
      .gte("sent_at", since)
      .order("sent_at", { ascending: true })
      .limit(1);
    if (error) throw dbError("count recent campaign messages", error);
    return { count: count ?? 0, oldest: data?.[0]?.sent_at ?? null };
  },

  async findStepMessage(orgId: string, recipientId: string, stepId: string): Promise<MessageRow | null> {
    const { data, error } = await dbClient
      .from("messages")
      .select("*")
      .eq("org_id", orgId)
      .eq("recipient_id", recipientId)
      .eq("step_id", stepId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw dbError("find step message", error);
    return data as MessageRow | null;
  },

  async latestRecipientMessages(orgId: string, recipientIds: string[]): Promise<Map<string, MessageRow>> {
    const latest = new Map<string, MessageRow>();
    for (const ids of chunks(recipientIds, IN_CHUNK)) {
      const { data, error } = await dbClient
        .from("messages")
        .select("*")
        .eq("org_id", orgId)
        .eq("direction", "outbound")
        .in("recipient_id", ids)
        .order("created_at", { ascending: false });
      if (error) throw dbError("list recipient messages", error);
      for (const row of (data || []) as MessageRow[]) {
        if (row.recipient_id && !latest.has(row.recipient_id)) latest.set(row.recipient_id, row);
      }
    }
    return latest;
  },

  async createMessage(
    orgId: string,
    input: Partial<Omit<MessageRow, "id" | "org_id" | "created_at" | "updated_at">> &
      Pick<MessageRow, "channel" | "provider" | "direction" | "status">
  ): Promise<MessageRow> {
    const { data, error } = await dbClient
      .from("messages")
      .insert({ ...input, org_id: orgId })
      .select()
      .single();
    if (error) throw dbError("create message", error);
    return data as MessageRow;
  },

  async updateMessage(
    orgId: string,
    messageId: string,
    patch: Partial<Omit<MessageRow, "id" | "org_id" | "created_at" | "updated_at">>
  ): Promise<MessageRow | null> {
    const { data, error } = await dbClient
      .from("messages")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", messageId)
      .select()
      .maybeSingle();
    if (error) throw dbError("update message", error);
    return data as MessageRow | null;
  },

  /** Webhook lookup across orgs (the provider id is globally unique per provider). */
  async findMessageByProviderId(provider: "resend" | "whatsapp", providerMessageId: string): Promise<MessageRow | null> {
    const { data, error } = await dbClient
      .from("messages")
      .select("*")
      .eq("provider", provider)
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (error) throw dbError("find message by provider id", error);
    return data as MessageRow | null;
  },

  /** Webhook lookup for the unsubscribe link (message ids are not secret on their own; the link is signed). */
  async getMessageById(messageId: string): Promise<MessageRow | null> {
    const { data, error } = await dbClient.from("messages").select("*").eq("id", messageId).maybeSingle();
    if (error) throw dbError("get message", error);
    return data as MessageRow | null;
  },

  /** Latest outbound message to an address on a channel (inbound reply matching). */
  async latestOutboundTo(
    channel: CampaignChannel,
    toAddress: string,
    scope: { orgId?: string | null; fromAddress?: string | null } = {}
  ): Promise<MessageRow | null> {
    let query = dbClient
      .from("messages")
      .select("*")
      .eq("channel", channel)
      .eq("direction", "outbound")
      .eq("to_address", toAddress.toLowerCase());
    if (scope.orgId) query = query.eq("org_id", scope.orgId);
    if (scope.fromAddress) query = query.eq("from_address", scope.fromAddress);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw dbError("find latest outbound message", error);
    return data as MessageRow | null;
  },

  // ---- Jobs ----

  /**
   * Bulk-queues send jobs (one insert per 500 rows). Rows whose dedupe key is already active are
   * skipped by falling back to one insert per row for a batch that hits the unique index.
   */
  async enqueueJobs(orgId: string, jobs: NewJobRow[]): Promise<number> {
    let queued = 0;
    for (const batch of chunks(jobs, 500)) {
      const rows = batch.map((j) => ({
        org_id: orgId,
        type: j.type,
        payload: j.payload,
        run_at: j.runAt,
        dedupe_key: j.dedupeKey,
      }));
      const { error } = await dbClient.from("jobs").insert(rows);
      if (!error) {
        queued += rows.length;
        continue;
      }
      if (error.code !== UNIQUE_VIOLATION) throw dbError("enqueue campaign jobs", error);
      for (const row of rows) {
        const single = await dbClient.from("jobs").insert(row);
        if (!single.error) queued += 1;
        else if (single.error.code !== UNIQUE_VIOLATION) throw dbError("enqueue campaign job", single.error);
      }
    }
    return queued;
  },
};
