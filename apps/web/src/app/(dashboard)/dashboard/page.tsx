"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { MetricCard } from "@/components/ui/MetricCard";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { mockLeads, mockAgents, mockNotifications, mockAnalyticsData } from "@/lib/mockData";
import {
  Users,
  Flame,
  Zap,
  TrendingUp,
  DollarSign,
  Bot,
  Sparkles,
  Search,
  Plus,
  ArrowUpRight,
  Calendar as CalendarIcon,
  CheckCircle2,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import Link from "next/link";

export default function DashboardPage() {
  const hotLeads = mockLeads.filter((l) => l.status === "Hot").length;
  const warmLeads = mockLeads.filter((l) => l.status === "Warm").length;
  const coldLeads = mockLeads.filter((l) => l.status === "Cold").length;

  return (
    <DashboardLayout>
      {/* Top Banner & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            AI Sales Command Center <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Autonomous agent pipeline running • 14 agents actively discovering & enriching prospects
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/leads">
            <Button variant="outline" size="sm">
              <Users className="w-4 h-4 mr-1.5" /> View All Leads
            </Button>
          </Link>
          <Link href="/agents">
            <Button variant="primary" size="sm">
              <Plus className="w-4 h-4 mr-1.5" /> New AI Campaign Run
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          title="Total Leads Discovered"
          value="2,840"
          change="+24.5%"
          isPositive={true}
          icon={<Users className="w-5 h-5" />}
          subtitle="420 added today"
        />
        <MetricCard
          title="Hot ICP Prospects"
          value={hotLeads + 48}
          change="+18.2%"
          isPositive={true}
          icon={<Flame className="w-5 h-5 text-rose-400" />}
          subtitle="Score >= 85"
        />
        <MetricCard
          title="Conversion Rate"
          value="25.8%"
          change="+4.1%"
          isPositive={true}
          icon={<TrendingUp className="w-5 h-5 text-emerald-400" />}
          subtitle="Industry avg 12%"
        />
        <MetricCard
          title="Pipeline Revenue"
          value="$310,000"
          change="+32.8%"
          isPositive={true}
          icon={<DollarSign className="w-5 h-5 text-amber-400" />}
          subtitle="Q3 Forecast"
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Growth Area Chart */}
        <Card glass className="lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-foreground">Lead Growth & Revenue Trajectory</h2>
              <p className="text-xs text-muted-foreground">Monthly growth across AI discovery pipelines</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-indigo-400 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Leads
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Revenue ($)
              </span>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockAnalyticsData.monthlyGrowth}>
                <defs>
                  <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px" }}
                />
                <Area type="monotone" dataKey="leads" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorLeads)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Lead Source Breakdown Donut Chart */}
        <Card glass>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-foreground">Lead Source Distribution</h2>
            <p className="text-xs text-muted-foreground">Top performing discovery agents</p>
          </div>
          <div className="h-56 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mockAnalyticsData.leadSources}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {mockAnalyticsData.leadSources.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 mt-2">
            {mockAnalyticsData.leadSources.map((source) => (
              <div key={source.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: source.color }} />
                  {source.name}
                </span>
                <span className="font-semibold text-foreground">{source.value}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Grid Section: Live AI Agent Activity & Recent High-Score Leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live AI Agent Fleet */}
        <Card glass>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-semibold text-foreground">Live AI Agent Fleet</h2>
            </div>
            <Link href="/agents">
              <Button variant="ghost" size="sm" className="text-xs">
                Console Logs <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="space-y-3">
            {mockAgents.slice(0, 4).map((agent) => (
              <div
                key={agent.id}
                className="p-3 rounded-xl bg-card/40 border border-border/50 flex items-center justify-between hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{agent.name}</h3>
                    <p className="text-xs text-muted-foreground">{agent.type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-xs font-semibold text-emerald-400">{agent.successRate}% Success</span>
                    <p className="text-[10px] text-muted-foreground">{agent.runningJobs} active jobs</p>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Hot Leads Table */}
        <Card glass>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-rose-400" />
              <h2 className="text-base font-semibold text-foreground">Highest Scoring Hot Leads</h2>
            </div>
            <Link href="/leads">
              <Button variant="ghost" size="sm" className="text-xs">
                View All <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="space-y-3">
            {mockLeads.slice(0, 4).map((lead) => (
              <div
                key={lead.id}
                className="p-3 rounded-xl bg-card/40 border border-border/50 flex items-center justify-between hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Avatar src={lead.avatar} name={lead.name} />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{lead.name}</h3>
                    <p className="text-xs text-muted-foreground">{lead.title} • {lead.company}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 font-mono font-bold text-xs border border-rose-500/20">
                    ICP {lead.score}
                  </div>
                  <StatusBadge status={lead.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Upcoming Tasks & Recent System Notifications */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card glass>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-indigo-400" /> Upcoming Sales & AI Tasks
            </h2>
          </div>
          <div className="space-y-2.5">
            <div className="p-3 rounded-xl bg-card/30 border border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-foreground font-medium">Follow-up Call with Sarah Jenkins (Stripe Tech)</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Today @ 2:00 PM</span>
            </div>
            <div className="p-3 rounded-xl bg-card/30 border border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-foreground font-medium">Run Deep Company Intelligence on BioHealth Global</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Tomorrow @ 10:00 AM</span>
            </div>
          </div>
        </Card>

        <Card glass>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Recent Agent Notifications</h2>
          </div>
          <div className="space-y-2.5">
            {mockNotifications.map((n) => (
              <div key={n.id} className="p-3 rounded-xl bg-card/30 border border-border/50 flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                <div>
                  <h3 className="text-xs font-semibold text-foreground">{n.title}</h3>
                  <p className="text-xs text-muted-foreground">{n.message}</p>
                  <span className="text-[10px] text-muted-foreground mt-1 inline-block">{n.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
