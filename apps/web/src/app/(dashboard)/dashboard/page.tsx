"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BarChart3, DollarSign, Flame, LayoutDashboard, TrendingUp, Users } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/QueryState";
import { Spinner } from "@/components/ui/LoadingSkeleton";
import { useAnalyticsSummary } from "@/hooks/useAnalytics";
import { cn, formatCurrency } from "@/lib/utils";
import {
  bucketLabel,
  compareChange,
  formatNumber,
  formatRate,
  presetRange,
  scoreBadgeClass,
  tooltipStyle,
  useChartTheme,
} from "@/lib/analytics";

export default function DashboardPage() {
  const router = useRouter();
  const chart = useChartTheme();
  const range = useMemo(() => presetRange("30d"), []);
  const query = useAnalyticsSummary(range);
  const summary = query.data;
  const cur = summary?.current;
  const prev = summary?.previous;

  const series = useMemo(
    () => (summary?.timeseries ?? []).map((p) => ({ ...p, label: bucketLabel(p.bucket, summary!.range.bucket) })),
    [summary]
  );
  const openStages = useMemo(() => (summary?.pipeline.byStage ?? []).filter((s) => !s.closed), [summary]);

  const show = (value: string) => (summary ? value : "–");
  const vsPrev = "vs previous 30 days";

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Lead volume, quality and pipeline for the last 30 days."
        icon={LayoutDashboard}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push("/analytics")}>
              <BarChart3 className="w-4 h-4" /> Analytics
            </Button>
            <Button variant="primary" size="sm" onClick={() => router.push("/leads")}>
              <Users className="w-4 h-4" /> View leads
            </Button>
          </>
        }
      />

      {query.isError && !summary ? (
        <ErrorState title="Couldn't load your dashboard" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <MetricCard
              title="New leads"
              value={show(formatNumber(cur?.leads))}
              subtitle={vsPrev}
              {...compareChange(cur?.leads, prev?.leads)}
              icon={<Users className="w-5 h-5" />}
            />
            <MetricCard
              title="Hot leads"
              value={show(formatNumber(cur?.hotLeads))}
              subtitle="At or above the hot score threshold"
              {...compareChange(cur?.hotLeads, prev?.hotLeads)}
              icon={<Flame className="w-5 h-5" />}
            />
            <MetricCard
              title="Lead → deal"
              value={show(formatRate(cur?.leadToDealRate))}
              subtitle={cur ? `${formatNumber(cur.leadsWithDeal)} of new leads have a deal` : undefined}
              {...compareChange(cur?.leadToDealRate, prev?.leadToDealRate, { kind: "rate" })}
              icon={<TrendingUp className="w-5 h-5" />}
            />
            <MetricCard
              title="Open pipeline"
              value={show(formatCurrency(summary?.pipeline.openValue ?? 0))}
              subtitle={
                summary
                  ? `${summary.pipeline.openDeals} open deal${summary.pipeline.openDeals === 1 ? "" : "s"} · ${formatCurrency(summary.pipeline.weightedValue)} weighted`
                  : undefined
              }
              icon={<DollarSign className="w-5 h-5" />}
            />
          </div>

          {!summary ? (
            <Card className="py-12">
              <Spinner label="Loading dashboard" />
            </Card>
          ) : summary.current.leads === 0 && summary.pipeline.openDeals === 0 && summary.recentLeads.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No lead data yet"
              description="Charts appear here once leads are added, captured from a connected lead source or found by the AI agent."
              actionLabel="Go to leads"
              onAction={() => router.push("/leads")}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 p-6">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-foreground">New leads and deals</h2>
                  <p className="text-xs text-muted-foreground">
                    Per {summary.range.bucket}, last 30 days ({summary.range.timezone})
                  </p>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="label" stroke={chart.axis} fontSize={12} tickLine={false} minTickGap={16} />
                      <YAxis stroke={chart.axis} fontSize={12} tickLine={false} allowDecimals={false} />
                      <RechartsTooltip contentStyle={tooltipStyle(chart)} />
                      <Area type="monotone" dataKey="leads" name="Leads" stroke={chart.primary} fill={chart.primary} fillOpacity={0.15} strokeWidth={2} />
                      <Area type="monotone" dataKey="deals" name="Deals" stroke={chart.series[2]} fill={chart.series[2]} fillOpacity={0.1} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-6">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-foreground">Open pipeline by stage</h2>
                  <p className="text-xs text-muted-foreground">Deal value per stage, right now</p>
                </div>
                {openStages.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-12 text-center">No open deals.</p>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={openStages} layout="vertical" margin={{ left: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                        <XAxis type="number" stroke={chart.axis} fontSize={11} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v))} />
                        <YAxis type="category" dataKey="stage" stroke={chart.axis} fontSize={12} width={90} tickLine={false} />
                        <RechartsTooltip
                          contentStyle={tooltipStyle(chart)}
                          cursor={{ fill: chart.grid, opacity: 0.4 }}
                          formatter={(val, name) => [formatCurrency(Number(val)), String(name)]}
                        />
                        <Bar dataKey="value" name="Value" fill={chart.secondary} radius={[0, 4, 4, 0]} />
                        <Bar dataKey="weightedValue" name="Weighted" fill={chart.primary} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </div>
          )}

          {summary && summary.recentLeads.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Recent leads</h2>
                  <p className="text-xs text-muted-foreground">The six most recently added leads</p>
                </div>
                <Link href="/leads" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  View all <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground border-b border-border">
                    <tr>
                      <th className="pb-3 font-medium">Lead</th>
                      <th className="pb-3 font-medium">Company</th>
                      <th className="pb-3 font-medium">Title</th>
                      <th className="pb-3 font-medium">Score</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {summary.recentLeads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-muted/40 transition-colors">
                        <td className="py-3">
                          <Link href={`/leads/${lead.id}`} className="font-medium text-foreground hover:text-primary">
                            {lead.name}
                          </Link>
                          {lead.email && lead.email !== "Not available" && (
                            <div className="text-xs text-muted-foreground">{lead.email}</div>
                          )}
                        </td>
                        <td className="py-3 text-muted-foreground">{lead.company || "—"}</td>
                        <td className="py-3 text-muted-foreground">{lead.title || "—"}</td>
                        <td className="py-3">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-mono font-semibold border", scoreBadgeClass(lead.score))}>
                            {lead.score}
                          </span>
                        </td>
                        <td className="py-3">
                          <StatusBadge status={lead.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
