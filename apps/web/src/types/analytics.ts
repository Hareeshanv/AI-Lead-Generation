export type AnalyticsBucket = "day" | "week" | "month";

export interface AnalyticsRangeParams {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  bucket?: AnalyticsBucket;
}

/** Counts and derived rates for one period. Rates are ratios (0..1) or null when there is no denominator. */
export interface AnalyticsKpis {
  leads: number;
  hotLeads: number;
  avgScore: number | null;
  agentLeads: number;
  contactedLeads: number;
  leadsWithDeal: number;
  leadsWon: number;
  leadToDealRate: number | null;
  dealToWinRate: number | null;
  leadToWinRate: number | null;

  dealsCreated: number;
  dealsCreatedValue: number;
  dealsWon: number;
  dealsLost: number;
  wonValue: number;
  winRate: number | null;
  avgDealCycleDays: number | null;

  messagesSent: number;
  messagesDelivered: number;
  messagesOpened: number;
  messagesClicked: number;
  messagesReplied: number;
  messagesBounced: number;
  messagesFailed: number;
  deliveryRate: number | null;
  openRate: number | null;
  clickRate: number | null;
  replyRate: number | null;
  bounceRate: number | null;

  agentRuns: number;
  agentRunsSucceeded: number;
  agentRunsFailed: number;
  agentSuccessRate: number | null;
  agentLeadsFound: number;
  agentYield: number | null;
  agentAvgDurationMs: number | null;
  agentTokensUsed: number;
}

export interface AnalyticsRange {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  bucket: AnalyticsBucket;
  timezone: string;
  currency: string;
}

export interface PipelineStageSummary {
  stage: string;
  count: number;
  value: number;
  weightedValue: number;
  closed: boolean;
}

export interface PipelineSnapshot {
  openDeals: number;
  openValue: number;
  weightedValue: number;
  byStage: PipelineStageSummary[];
}

export interface TimeseriesPoint {
  /** Bucket start, YYYY-MM-DD in the workspace time zone. */
  bucket: string;
  leads: number;
  deals: number;
  won: number;
  wonValue: number;
  messagesSent: number;
  replies: number;
}

export interface DashboardRecentLead {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  title: string | null;
  score: number;
  status: string;
  source: string | null;
  createdAt: string;
}

export interface AnalyticsSummary {
  range: AnalyticsRange;
  current: AnalyticsKpis;
  previous: AnalyticsKpis;
  pipeline: PipelineSnapshot;
  timeseries: TimeseriesPoint[];
  recentLeads: DashboardRecentLead[];
}

export interface SourceReportRow {
  source: string;
  leads: number;
  avgScore: number | null;
  deals: number;
  won: number;
}

export interface CampaignReportRow {
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
  deliveryRate: number | null;
  openRate: number | null;
  clickRate: number | null;
  replyRate: number | null;
  bounceRate: number | null;
}

export interface AgentRunReportRow {
  id: string;
  query: string;
  location: string | null;
  status: string;
  leadsFound: number;
  durationMs: number | null;
  startedAt: string;
  tokensUsed: number;
}

export interface AnalyticsReports extends Omit<AnalyticsSummary, "recentLeads"> {
  bySource: SourceReportRow[];
  byStatus: { status: string; leads: number }[];
  scoreDistribution: { range: string; min: number; max: number; leads: number }[];
  funnel: { leads: number; contacted: number; deals: number; won: number };
  campaigns: CampaignReportRow[];
  agentRuns: AgentRunReportRow[];
}
