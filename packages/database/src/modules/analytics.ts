import { dbClient } from "../client";
import { dbError } from "../helpers";

export type AnalyticsBucket = "day" | "week" | "month";

/** Raw counts from analytics_kpis() for [from, to). */
export interface AnalyticsKpisRow {
  leads: number;
  hotLeads: number;
  avgScore: number | null;
  agentLeads: number;
  contactedLeads: number;
  leadsWithDeal: number;
  leadsWon: number;
  dealsCreated: number;
  dealsCreatedValue: number;
  dealsWon: number;
  dealsLost: number;
  wonValue: number;
  avgDealCycleDays: number | null;
  messagesSent: number;
  messagesDelivered: number;
  messagesOpened: number;
  messagesClicked: number;
  messagesReplied: number;
  messagesBounced: number;
  messagesFailed: number;
  agentRuns: number;
  agentRunsSucceeded: number;
  agentRunsFailed: number;
  agentLeadsFound: number;
  agentAvgDurationMs: number | null;
  agentTokensUsed: number;
}

export interface AnalyticsPipelineRow {
  openDeals: number;
  openValue: number;
  weightedValue: number;
  byStage: { stage: string; count: number; value: number; weightedValue: number; closed: boolean }[];
}

export interface AnalyticsTimeseriesPoint {
  bucket: string;
  leads: number;
  deals: number;
  won: number;
  wonValue: number;
  messagesSent: number;
  replies: number;
}

export interface AnalyticsBreakdownsRow {
  bySource: { source: string; leads: number; avgScore: number | null; deals: number; won: number }[];
  byStatus: { status: string; leads: number }[];
  scoreDistribution: { range: string; min: number; max: number; leads: number }[];
  funnel: { leads: number; contacted: number; deals: number; won: number };
  campaigns: {
    id: string;
    name: string;
    channel: string;
    status: string;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
  }[];
  agentRuns: {
    id: string;
    query: string;
    location: string | null;
    status: string;
    leads_found: number;
    duration_ms: number | null;
    started_at: string;
    tokens_used: number;
  }[];
}

export interface RecentLeadRow {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  title: string | null;
  score: number | null;
  status: string | null;
  source: string | null;
  created_at: string;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await dbClient.rpc(fn, args);
  if (error) throw dbError(fn, error);
  return data as T;
}

/** Owned by the Analytics module; aggregates run in SQL (migration 20260801000014_analytics.sql). */
export const analyticsDb = {
  kpis(orgId: string, from: Date, to: Date): Promise<AnalyticsKpisRow> {
    return rpc("analytics_kpis", { p_org_id: orgId, p_from: from.toISOString(), p_to: to.toISOString() });
  },

  pipeline(orgId: string): Promise<AnalyticsPipelineRow> {
    return rpc("analytics_pipeline", { p_org_id: orgId });
  },

  timeseries(orgId: string, from: Date, to: Date, bucket: AnalyticsBucket, timezone: string): Promise<AnalyticsTimeseriesPoint[]> {
    return rpc("analytics_timeseries", {
      p_org_id: orgId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_bucket: bucket,
      p_tz: timezone,
    });
  },

  breakdowns(orgId: string, from: Date, to: Date): Promise<AnalyticsBreakdownsRow> {
    return rpc("analytics_breakdowns", { p_org_id: orgId, p_from: from.toISOString(), p_to: to.toISOString() });
  },

  async recentLeads(orgId: string, limit = 6): Promise<RecentLeadRow[]> {
    const { data, error } = await dbClient
      .from("leads")
      .select("id, name, email, company, title, score, status, source, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError("recent leads", error);
    return (data || []) as RecentLeadRow[];
  },
};
