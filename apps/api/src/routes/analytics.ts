import { z } from "zod";
import { analyticsDb, settingsDb, type AnalyticsBucket, type AnalyticsKpisRow } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { send } from "../http/pagination";
import { parse } from "../http/validate";
import { getCtx } from "../middleware/auth";

/** Mounted at /api/analytics behind requireAuth(); owned by the Analytics module. */
export const analyticsRouter = createRouter();

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 2 * 366;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = z
  .string()
  .trim()
  .refine((v) => DATE_ONLY.test(v) || !Number.isNaN(Date.parse(v)), "Use an ISO date (YYYY-MM-DD) or timestamp")
  .optional();

const rangeQuery = z.object({
  /** Inclusive start. */
  from: dateParam,
  /** Inclusive end when a date (YYYY-MM-DD), exclusive when a timestamp. */
  to: dateParam,
  bucket: z.enum(["day", "week", "month"]).optional(),
});

export interface AnalyticsRange {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  bucket: AnalyticsBucket;
}

function parseRange(query: unknown): AnalyticsRange {
  const q = parse(rangeQuery, {
    from: (query as any)?.from,
    to: (query as any)?.to,
    bucket: (query as any)?.bucket,
  });
  const to = q.to ? (DATE_ONLY.test(q.to) ? new Date(Date.parse(q.to) + DAY_MS) : new Date(q.to)) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  if (from >= to) throw HttpError.badRequest("The start date must be before the end date.", { from: ["Must be before to"] });
  const span = to.getTime() - from.getTime();
  if (span > MAX_RANGE_DAYS * DAY_MS) {
    throw HttpError.badRequest(`Choose a range of at most ${MAX_RANGE_DAYS} days.`, { from: ["Range too long"] });
  }
  const days = span / DAY_MS;
  const bucket: AnalyticsBucket = q.bucket ?? (days <= 45 ? "day" : days <= 200 ? "week" : "month");
  return { from, to, previousFrom: new Date(from.getTime() - span), previousTo: from, bucket };
}

const ratio = (num: number, den: number): number | null => (den > 0 ? Number((num / den).toFixed(4)) : null);

/** Counts plus derived rates (0..1, null when the denominator is 0). */
export function deriveKpis(k: AnalyticsKpisRow) {
  const n = (v: unknown) => Number(v) || 0;
  const sent = n(k.messagesSent);
  const runs = n(k.agentRuns);
  return {
    leads: n(k.leads),
    hotLeads: n(k.hotLeads),
    avgScore: k.avgScore == null ? null : Number(k.avgScore),
    agentLeads: n(k.agentLeads),
    contactedLeads: n(k.contactedLeads),
    leadsWithDeal: n(k.leadsWithDeal),
    leadsWon: n(k.leadsWon),
    leadToDealRate: ratio(n(k.leadsWithDeal), n(k.leads)),
    dealToWinRate: ratio(n(k.leadsWon), n(k.leadsWithDeal)),
    leadToWinRate: ratio(n(k.leadsWon), n(k.leads)),

    dealsCreated: n(k.dealsCreated),
    dealsCreatedValue: n(k.dealsCreatedValue),
    dealsWon: n(k.dealsWon),
    dealsLost: n(k.dealsLost),
    wonValue: n(k.wonValue),
    winRate: ratio(n(k.dealsWon), n(k.dealsWon) + n(k.dealsLost)),
    avgDealCycleDays: k.avgDealCycleDays == null ? null : Number(k.avgDealCycleDays),

    messagesSent: sent,
    messagesDelivered: n(k.messagesDelivered),
    messagesOpened: n(k.messagesOpened),
    messagesClicked: n(k.messagesClicked),
    messagesReplied: n(k.messagesReplied),
    messagesBounced: n(k.messagesBounced),
    messagesFailed: n(k.messagesFailed),
    deliveryRate: ratio(n(k.messagesDelivered), sent),
    openRate: ratio(n(k.messagesOpened), sent),
    clickRate: ratio(n(k.messagesClicked), sent),
    replyRate: ratio(n(k.messagesReplied), sent),
    bounceRate: ratio(n(k.messagesBounced), sent),

    agentRuns: runs,
    agentRunsSucceeded: n(k.agentRunsSucceeded),
    agentRunsFailed: n(k.agentRunsFailed),
    agentSuccessRate: ratio(n(k.agentRunsSucceeded), runs),
    agentLeadsFound: n(k.agentLeadsFound),
    agentYield: runs > 0 ? Number((n(k.agentLeadsFound) / runs).toFixed(2)) : null,
    agentAvgDurationMs: k.agentAvgDurationMs == null ? null : Number(k.agentAvgDurationMs),
    agentTokensUsed: n(k.agentTokensUsed),
  };
}

async function periodData(orgId: string, range: AnalyticsRange) {
  const settings = await settingsDb.get(orgId);
  const [current, previous, pipeline, timeseries] = await Promise.all([
    analyticsDb.kpis(orgId, range.from, range.to),
    analyticsDb.kpis(orgId, range.previousFrom, range.previousTo),
    analyticsDb.pipeline(orgId),
    analyticsDb.timeseries(orgId, range.from, range.to, range.bucket, settings.timezone),
  ]);
  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      previousFrom: range.previousFrom.toISOString(),
      previousTo: range.previousTo.toISOString(),
      bucket: range.bucket,
      timezone: settings.timezone,
      currency: settings.currency,
    },
    current: deriveKpis(current),
    previous: deriveKpis(previous),
    pipeline: {
      openDeals: Number(pipeline.openDeals) || 0,
      openValue: Number(pipeline.openValue) || 0,
      weightedValue: Number(pipeline.weightedValue) || 0,
      byStage: (pipeline.byStage || []).map((s) => ({
        stage: s.stage,
        count: Number(s.count) || 0,
        value: Number(s.value) || 0,
        weightedValue: Number(s.weightedValue) || 0,
        closed: !!s.closed,
      })),
    },
    timeseries: timeseries || [],
  };
}

// GET /api/analytics/summary?from&to&bucket — dashboard KPIs vs the previous period of equal length
analyticsRouter.get("/summary", async (req, res) => {
  const { orgId } = getCtx(req);
  const range = parseRange(req.query);
  const [period, recent] = await Promise.all([periodData(orgId, range), analyticsDb.recentLeads(orgId, 6)]);
  send(res, {
    ...period,
    recentLeads: recent.map((l) => ({
      id: l.id,
      name: l.name,
      email: l.email,
      company: l.company,
      title: l.title,
      score: l.score ?? 0,
      status: l.status ?? "New",
      source: l.source,
      createdAt: l.created_at,
    })),
  });
});

// GET /api/analytics/reports?from&to&bucket — summary plus per-report breakdowns (sources, status, scores,
// funnel, campaigns, agent runs)
analyticsRouter.get("/reports", async (req, res) => {
  const { orgId } = getCtx(req);
  const range = parseRange(req.query);
  const [period, b] = await Promise.all([periodData(orgId, range), analyticsDb.breakdowns(orgId, range.from, range.to)]);
  send(res, {
    ...period,
    bySource: b.bySource || [],
    byStatus: b.byStatus || [],
    scoreDistribution: b.scoreDistribution || [],
    funnel: b.funnel || { leads: 0, contacted: 0, deals: 0, won: 0 },
    campaigns: (b.campaigns || []).map((c) => ({
      ...c,
      deliveryRate: ratio(c.delivered, c.sent),
      openRate: ratio(c.opened, c.sent),
      clickRate: ratio(c.clicked, c.sent),
      replyRate: ratio(c.replied, c.sent),
      bounceRate: ratio(c.bounced, c.sent),
    })),
    agentRuns: (b.agentRuns || []).map((r) => ({
      id: r.id,
      query: r.query,
      location: r.location,
      status: r.status,
      leadsFound: Number(r.leads_found) || 0,
      durationMs: r.duration_ms,
      startedAt: r.started_at,
      tokensUsed: Number(r.tokens_used) || 0,
    })),
  });
});
