"use client";

import React, { useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  DollarSign,
  Download,
  Flame,
  Gauge,
  MessageSquareReply,
  Target,
  Timer,
  Trophy,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { ErrorState } from "@/components/ui/QueryState";
import { Spinner } from "@/components/ui/LoadingSkeleton";
import { DateRangePicker, defaultDateRange, type DateRangeValue } from "@/components/analytics/DateRangePicker";
import { useAnalyticsReports } from "@/hooks/useAnalytics";
import { formatCurrency } from "@/lib/utils";
import { notifySuccess } from "@/lib/toast";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  type ChartTheme,
  bucketLabel,
  compareChange,
  describeRange,
  formatDuration,
  formatNumber,
  formatRate,
  tooltipStyle,
  useChartTheme,
} from "@/lib/analytics";
import type { AnalyticsBucket, AnalyticsKpis, AnalyticsReports } from "@/types";

type Cell = string | number | null | undefined;

const ReportCard: React.FC<{
  title: string;
  description: string;
  onExport?: () => void;
  className?: string;
  children: React.ReactNode;
}> = ({ title, description, onExport, className, children }) => (
  <Card className={`p-6 ${className ?? ""}`}>
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {onExport && (
        <Button variant="ghost" size="sm" onClick={onExport} aria-label={`Export ${title} as CSV`} title="Export CSV">
          <Download className="w-4 h-4" /> CSV
        </Button>
      )}
    </div>
    {children}
  </Card>
);

const NoData: React.FC<{ text?: string }> = ({ text = "No data in this period." }) => (
  <p className="py-12 text-center text-sm text-muted-foreground">{text}</p>
);

const CountBars: React.FC<{
  data: { name: string; value: number }[];
  chart: ChartTheme;
  color: string;
  label: string;
  vertical?: boolean;
}> = ({ data, chart, color, label, vertical }) => (
  <div className="h-72 w-full">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={vertical ? "vertical" : "horizontal"} margin={vertical ? { left: 24 } : undefined}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={!!vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" stroke={chart.axis} fontSize={12} allowDecimals={false} tickLine={false} />
            <YAxis type="category" dataKey="name" stroke={chart.axis} fontSize={12} width={110} tickLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" stroke={chart.axis} fontSize={12} tickLine={false} />
            <YAxis stroke={chart.axis} fontSize={12} allowDecimals={false} tickLine={false} />
          </>
        )}
        <RechartsTooltip
          contentStyle={tooltipStyle(chart)}
          cursor={{ fill: chart.grid, opacity: 0.4 }}
          formatter={(val) => [Number(val).toLocaleString(), label]}
        />
        <Bar dataKey="value" fill={color} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

const pct = (ratio: number | null | undefined): string => (ratio == null ? "" : (ratio * 100).toFixed(1));

/** Key metrics: label, current, previous (for the summary CSV). */
function kpiRows(c: AnalyticsKpis, p: AnalyticsKpis): Cell[][] {
  const rows: [string, keyof AnalyticsKpis, "count" | "rate"][] = [
    ["New leads", "leads", "count"],
    ["Hot leads", "hotLeads", "count"],
    ["Average score", "avgScore", "count"],
    ["Lead to deal rate (%)", "leadToDealRate", "rate"],
    ["Deal to win rate (%)", "dealToWinRate", "rate"],
    ["Deals created", "dealsCreated", "count"],
    ["Deals won", "dealsWon", "count"],
    ["Deals lost", "dealsLost", "count"],
    ["Won value", "wonValue", "count"],
    ["Win rate (%)", "winRate", "rate"],
    ["Average deal cycle (days)", "avgDealCycleDays", "count"],
    ["Messages sent", "messagesSent", "count"],
    ["Delivery rate (%)", "deliveryRate", "rate"],
    ["Open rate (%)", "openRate", "rate"],
    ["Click rate (%)", "clickRate", "rate"],
    ["Reply rate (%)", "replyRate", "rate"],
    ["Bounce rate (%)", "bounceRate", "rate"],
    ["Agent runs", "agentRuns", "count"],
    ["Agent success rate (%)", "agentSuccessRate", "rate"],
    ["Agent leads found", "agentLeadsFound", "count"],
    ["Agent leads per run", "agentYield", "count"],
    ["Agent tokens used", "agentTokensUsed", "count"],
  ];
  return rows.map(([label, key, kind]) => {
    const fmt = (v: number | null) => (kind === "rate" ? pct(v) : v ?? "");
    return [label, fmt(c[key] as number | null), fmt(p[key] as number | null)];
  });
}

export default function AnalyticsPage() {
  const chart = useChartTheme();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => defaultDateRange("30d"));
  const [bucket, setBucket] = useState<AnalyticsBucket | "auto">("auto");
  const params = useMemo(
    () => ({ ...dateRange.range, ...(bucket === "auto" ? {} : { bucket }) }),
    [dateRange, bucket]
  );
  const query = useAnalyticsReports(params);
  const data = query.data;

  const exportCsv = (report: string, header: string[], rows: Cell[][]) => {
    const name = `analytics-${report}-${dateRange.range.from}_to_${dateRange.range.to}.csv`;
    downloadCsv(name, toCsv(header, rows));
    notifySuccess("CSV exported", name);
  };

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Acquisition, conversion, pipeline, campaign and AI agent performance, compared with the previous period."
        icon={BarChart3}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!data}
            onClick={() =>
              data && exportCsv("summary", ["Metric", "This period", "Previous period"], kpiRows(data.current, data.previous))
            }
          >
            <Download className="w-4 h-4" /> Export summary
          </Button>
        }
      />

      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Group by</span>
          <select
            aria-label="Group by"
            className="h-8 rounded-lg bg-card/60 border border-border px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            value={bucket}
            onChange={(e) => setBucket(e.target.value as AnalyticsBucket | "auto")}
          >
            <option value="auto">Auto</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          {data && (
            <span className="hidden md:inline">
              Compared with {describeRange(data.range.previousFrom, data.range.previousTo)}
            </span>
          )}
          {query.isFetching && data && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
        </div>
      </Card>

      {query.isError && !data ? (
        <ErrorState title="Couldn't load analytics" error={query.error} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <Card className="py-12">
          <Spinner label="Loading analytics" />
        </Card>
      ) : (
        <Reports data={data} chart={chart} exportCsv={exportCsv} />
      )}
    </>
  );
}

const Reports: React.FC<{
  data: AnalyticsReports;
  chart: ChartTheme;
  exportCsv: (report: string, header: string[], rows: Cell[][]) => void;
}> = ({ data, chart, exportCsv }) => {
  const c = data.current;
  const p = data.previous;
  const series = data.timeseries.map((t) => ({ ...t, label: bucketLabel(t.bucket, data.range.bucket) }));
  const funnelSteps = [
    { name: "New leads", value: data.funnel.leads },
    { name: "Contacted", value: data.funnel.contacted },
    { name: "Deal created", value: data.funnel.deals },
    { name: "Won", value: data.funnel.won },
  ];
  const campaignTotals = c.messagesSent;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard title="New leads" value={formatNumber(c.leads)} subtitle={`${formatNumber(c.agentLeads)} from the AI agent`} {...compareChange(c.leads, p.leads)} icon={<Users className="w-5 h-5" />} />
        <MetricCard title="Hot leads" value={formatNumber(c.hotLeads)} subtitle={`Avg score ${formatNumber(c.avgScore, 1)}`} {...compareChange(c.hotLeads, p.hotLeads)} icon={<Flame className="w-5 h-5" />} />
        <MetricCard title="Lead → deal" value={formatRate(c.leadToDealRate)} subtitle={`${formatRate(c.leadToWinRate)} of new leads won`} {...compareChange(c.leadToDealRate, p.leadToDealRate, { kind: "rate" })} icon={<Target className="w-5 h-5" />} />
        <MetricCard title="Win rate" value={formatRate(c.winRate)} subtitle={`${c.dealsWon} won · ${c.dealsLost} lost`} {...compareChange(c.winRate, p.winRate, { kind: "rate" })} icon={<Trophy className="w-5 h-5" />} />
        <MetricCard title="Won revenue" value={formatCurrency(c.wonValue)} subtitle={`${c.dealsCreated} deals created`} {...compareChange(c.wonValue, p.wonValue)} icon={<DollarSign className="w-5 h-5" />} />
        <MetricCard
          title="Avg deal cycle"
          value={c.avgDealCycleDays == null ? "—" : `${formatNumber(c.avgDealCycleDays, 1)} days`}
          subtitle="Created to won"
          {...compareChange(c.avgDealCycleDays, p.avgDealCycleDays, { lowerIsBetter: true })}
          icon={<Timer className="w-5 h-5" />}
        />
        <MetricCard title="Reply rate" value={formatRate(c.replyRate)} subtitle={`${formatNumber(c.messagesSent)} messages sent`} {...compareChange(c.replyRate, p.replyRate, { kind: "rate" })} icon={<MessageSquareReply className="w-5 h-5" />} />
        <MetricCard
          title="Agent yield"
          value={c.agentYield == null ? "—" : `${formatNumber(c.agentYield, 1)} / run`}
          subtitle={`${c.agentRuns} runs · ${formatRate(c.agentSuccessRate, 0)} succeeded`}
          {...compareChange(c.agentYield, p.agentYield)}
          icon={<Bot className="w-5 h-5" />}
        />
      </div>

      <ReportCard
        title="Leads and deals over time"
        description={`Per ${data.range.bucket} in ${data.range.timezone}, ${describeRange(data.range.from, data.range.to)}`}
        onExport={() =>
          exportCsv(
            "timeseries",
            ["Period start", "New leads", "Deals created", "Deals won", "Won value", "Messages sent", "Replies"],
            data.timeseries.map((t) => [t.bucket, t.leads, t.deals, t.won, t.wonValue, t.messagesSent, t.replies])
          )
        }
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" stroke={chart.axis} fontSize={12} tickLine={false} minTickGap={16} />
              <YAxis stroke={chart.axis} fontSize={12} allowDecimals={false} tickLine={false} />
              <RechartsTooltip contentStyle={tooltipStyle(chart)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="leads" name="New leads" stroke={chart.primary} fill={chart.primary} fillOpacity={0.15} strokeWidth={2} />
              <Area type="monotone" dataKey="deals" name="Deals created" stroke={chart.series[2]} fill={chart.series[2]} fillOpacity={0.1} strokeWidth={2} />
              <Area type="monotone" dataKey="won" name="Deals won" stroke={chart.series[3]} fill={chart.series[3]} fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ReportCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ReportCard
          title="Conversion funnel"
          description="Leads created in this period and how far they got"
          onExport={() =>
            exportCsv(
              "funnel",
              ["Step", "Leads", "% of new leads", "% of previous step"],
              funnelSteps.map((s, i) => [
                s.name,
                s.value,
                pct(funnelSteps[0].value ? s.value / funnelSteps[0].value : null),
                i === 0 ? "" : pct(funnelSteps[i - 1].value ? s.value / funnelSteps[i - 1].value : null),
              ])
            )
          }
        >
          {data.funnel.leads === 0 ? (
            <NoData />
          ) : (
            <div className="space-y-3 py-2">
              {funnelSteps.map((s, i) => {
                const share = s.value / data.funnel.leads;
                const stepRate = i === 0 ? null : funnelSteps[i - 1].value ? s.value / funnelSteps[i - 1].value : null;
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-foreground">{s.name}</span>
                      <span className="text-muted-foreground">
                        {formatNumber(s.value)} · {formatRate(share)}
                        {stepRate != null && ` (${formatRate(stepRate)} of previous)`}
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 1)}%`, backgroundColor: chart.series[i % chart.series.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ReportCard>

        <ReportCard
          title="Pipeline by stage"
          description={`Right now: ${formatCurrency(data.pipeline.openValue)} open, ${formatCurrency(data.pipeline.weightedValue)} weighted by probability`}
          onExport={() =>
            exportCsv(
              "pipeline",
              ["Stage", "Deals", "Value", "Weighted value", "Closed"],
              data.pipeline.byStage.map((s) => [s.stage, s.count, s.value, s.weightedValue, s.closed ? "yes" : "no"])
            )
          }
        >
          {data.pipeline.byStage.length === 0 ? (
            <NoData text="No deals yet." />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.pipeline.byStage} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                  <XAxis type="number" stroke={chart.axis} fontSize={11} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v))} />
                  <YAxis type="category" dataKey="stage" stroke={chart.axis} fontSize={12} width={100} tickLine={false} />
                  <RechartsTooltip contentStyle={tooltipStyle(chart)} cursor={{ fill: chart.grid, opacity: 0.4 }} formatter={(val, name) => [formatCurrency(Number(val)), String(name)]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="value" name="Value" fill={chart.secondary} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="weightedValue" name="Weighted" fill={chart.primary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ReportCard>

        <ReportCard
          title="Leads by source"
          description="Where new leads came from"
          onExport={() =>
            exportCsv(
              "sources",
              ["Source", "Leads", "Average score", "With deal", "Won", "Lead to deal (%)", "Lead to won (%)"],
              data.bySource.map((s) => [s.source, s.leads, s.avgScore, s.deals, s.won, pct(s.leads ? s.deals / s.leads : null), pct(s.leads ? s.won / s.leads : null)])
            )
          }
        >
          {data.bySource.length === 0 ? (
            <NoData />
          ) : (
            <CountBars data={data.bySource.slice(0, 10).map((s) => ({ name: s.source, value: s.leads }))} chart={chart} color={chart.primary} label="Leads" vertical />
          )}
        </ReportCard>

        <ReportCard
          title="Leads by status"
          description="Current status of leads created in this period"
          onExport={() => exportCsv("status", ["Status", "Leads"], data.byStatus.map((s) => [s.status, s.leads]))}
        >
          {data.byStatus.length === 0 ? (
            <NoData />
          ) : (
            <CountBars data={data.byStatus.map((s) => ({ name: s.status, value: s.leads }))} chart={chart} color={chart.secondary} label="Leads" />
          )}
        </ReportCard>

        <ReportCard
          title="Score distribution"
          description="New leads grouped by fit score"
          onExport={() => exportCsv("scores", ["Score range", "Leads"], data.scoreDistribution.map((s) => [s.range, s.leads]))}
        >
          {c.leads === 0 ? (
            <NoData />
          ) : (
            <CountBars data={data.scoreDistribution.map((s) => ({ name: s.range, value: s.leads }))} chart={chart} color={chart.series[2]} label="Leads" />
          )}
        </ReportCard>

        <ReportCard
          title="AI agent"
          description="Discovery runs started in this period"
          onExport={() =>
            exportCsv(
              "agent-runs",
              ["Started", "Query", "Location", "Status", "Leads found", "Duration (s)", "Tokens used"],
              data.agentRuns.map((r) => [r.startedAt, r.query, r.location, r.status, r.leadsFound, r.durationMs == null ? "" : (r.durationMs / 1000).toFixed(1), r.tokensUsed])
            )
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              ["Runs", formatNumber(c.agentRuns)],
              ["Succeeded", formatRate(c.agentSuccessRate, 0)],
              ["Leads found", formatNumber(c.agentLeadsFound)],
              ["Avg duration", formatDuration(c.agentAvgDurationMs)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-card/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="text-lg font-semibold text-foreground">{value}</div>
              </div>
            ))}
          </div>
          {data.agentRuns.length === 0 ? (
            <NoData text="No agent runs in this period." />
          ) : (
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground border-b border-border sticky top-0 bg-card">
                  <tr>
                    <th className="py-2 font-medium">Query</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium text-right">Leads</th>
                    <th className="py-2 font-medium text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.agentRuns.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-2">
                        <div className="text-foreground truncate max-w-[220px]" title={r.query}>{r.query}</div>
                        <div className="text-muted-foreground">{new Date(r.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{r.location ? ` · ${r.location}` : ""}</div>
                      </td>
                      <td className="py-2">
                        <Badge variant={r.status === "failed" ? "danger" : r.status === "running" ? "warning" : "success"} className="text-[10px]">
                          {r.status.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="py-2 text-right text-foreground">{r.leadsFound}</td>
                      <td className="py-2 text-right text-muted-foreground">{formatDuration(r.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportCard>
      </div>

      <ReportCard
        title="Campaign performance"
        description={`Messages sent in this period: ${formatNumber(campaignTotals)} · delivered ${formatRate(c.deliveryRate)} · opened ${formatRate(c.openRate)} · clicked ${formatRate(c.clickRate)} · replied ${formatRate(c.replyRate)} · bounced ${formatRate(c.bounceRate)}`}
        onExport={() =>
          exportCsv(
            "campaigns",
            ["Campaign", "Channel", "Status", "Sent", "Delivered", "Opened", "Clicked", "Replied", "Bounced", "Delivery (%)", "Open (%)", "Click (%)", "Reply (%)", "Bounce (%)"],
            data.campaigns.map((cp) => [
              cp.name, cp.channel, cp.status, cp.sent, cp.delivered, cp.opened, cp.clicked, cp.replied, cp.bounced,
              pct(cp.deliveryRate), pct(cp.openRate), pct(cp.clickRate), pct(cp.replyRate), pct(cp.bounceRate),
            ])
          )
        }
      >
        {data.campaigns.length === 0 ? (
          <NoData text="No campaign messages were sent in this period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="pb-3 font-medium">Campaign</th>
                  <th className="pb-3 font-medium">Channel</th>
                  <th className="pb-3 font-medium text-right">Sent</th>
                  <th className="pb-3 font-medium text-right">Delivered</th>
                  <th className="pb-3 font-medium text-right">Opened</th>
                  <th className="pb-3 font-medium text-right">Clicked</th>
                  <th className="pb-3 font-medium text-right">Replied</th>
                  <th className="pb-3 font-medium text-right">Bounced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.campaigns.map((cp) => (
                  <tr key={cp.id}>
                    <td className="py-3 font-medium text-foreground">{cp.name}</td>
                    <td className="py-3 text-muted-foreground capitalize">{cp.channel}</td>
                    <td className="py-3 text-right">{formatNumber(cp.sent)}</td>
                    <td className="py-3 text-right text-muted-foreground">{formatRate(cp.deliveryRate)}</td>
                    <td className="py-3 text-right text-muted-foreground">{cp.channel === "email" ? formatRate(cp.openRate) : "—"}</td>
                    <td className="py-3 text-right text-muted-foreground">{cp.channel === "email" ? formatRate(cp.clickRate) : "—"}</td>
                    <td className="py-3 text-right text-muted-foreground">{formatRate(cp.replyRate)}</td>
                    <td className="py-3 text-right text-muted-foreground">{formatRate(cp.bounceRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportCard>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Gauge className="w-3.5 h-3.5" /> Changes compare {describeRange(data.range.from, data.range.to)} with the previous period of the same
        length. Rates show percentage-point changes.
      </p>
    </>
  );
};
