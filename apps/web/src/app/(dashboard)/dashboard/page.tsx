"use client";

import React, { useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { MetricCard } from "@/components/ui/MetricCard";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { useLeadStore } from "@/stores/useLeadStore";
import { mockAgents, mockNotifications, mockAnalyticsData } from "@/lib/mockData";
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
  Terminal,
  Activity,
  Radio,
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
  const { leads, fetchLeads } = useLeadStore();

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const hotLeads = leads.filter((l) => l.score >= 80).length;
  const totalLeadsVal = leads.length > 0 ? leads.length.toString() : "2,840";
  const hotLeadsVal = leads.length > 0 ? hotLeads : 48;

  const terminalLogs = [
    { time: "01:21:05", tag: "AGENT_04", msg: "Email sequence A/B test completed", status: "success" },
    { time: "01:20:59", tag: "PIPELINE", msg: "Syncing with CRM successful", status: "info" },
    { time: "01:20:55", tag: "DATA_SYNC", msg: "Updating lead health scores", status: "success" },
    { time: "01:20:51", tag: "NEURAL_NET", msg: "New intent match found for enterprise tier", status: "alert" },
    { time: "01:20:47", tag: "PIPELINE", msg: "Enriching social signals for prospect...", status: "info" },
    { time: "01:20:39", tag: "AGENT_07", msg: "Verifying email deliverability via Hunter.io", status: "success" },
  ];

  const displayedLeads = [
    { name: "Sarah Chen", title: "VP, CloudScale Inc.", score: 98, avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80" },
    { name: "Alex Rivera", title: "CTO, DataNexus Pro", score: 92, avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80" },
    { name: "Jordan Smith", title: "Head, Quantum Labs", score: 85, avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80" },
  ];

  return (
    <DashboardLayout>
      {/* Top Banner & Quick Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-emerald-500/20">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            Nexus AI Operations <Sparkles className="w-5 h-5 text-emerald-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Core Engine V2.4 Active • 14 agents actively discovering & enriching prospects
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            <Radio className="w-3 h-3 mr-1 animate-pulse inline" /> LIVE STREAM
          </Badge>
          <Link href="/agents">
            <Button variant="primary" size="sm" className="bg-emerald-600 hover:bg-emerald-500">
              <Plus className="w-4 h-4 mr-1.5" /> + New Campaign
            </Button>
          </Link>
        </div>
      </div>

      {/* Top Row Bento: Terminal Console & Hot Leads */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Terminal Activity Log Feed */}
        <Card glass className="lg:col-span-2 p-5 border border-emerald-500/20 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-foreground tracking-tight">Live AI Agent Fleet</h2>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono text-emerald-400 border-emerald-500/30">
              ● LIVE STREAM
            </Badge>
          </div>
          <div className="font-mono text-xs space-y-2.5 bg-black/60 p-4 rounded-xl border border-white/5 overflow-x-auto">
            {terminalLogs.map((log, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-muted-foreground text-[11px]">{log.time}</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                  [{log.tag}]
                </span>
                <span className="text-slate-200">{log.msg}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Hot Leads Widget */}
        <Card glass className="p-5 border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">Hot Leads</h2>
            <Link href="/leads" className="text-xs text-emerald-400 hover:underline">View All</Link>
          </div>
          <div className="space-y-3">
            {displayedLeads.map((lead, i) => (
              <div key={i} className="p-3 rounded-xl bg-card/60 border border-white/5 flex items-center justify-between hover:border-emerald-500/30 transition-all">
                <div className="flex items-center gap-3">
                  <Avatar src={lead.avatar} name={lead.name} className="w-9 h-9" />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{lead.name}</h3>
                    <p className="text-xs text-muted-foreground">{lead.title}</p>
                  </div>
                </div>
                <div className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-mono font-bold text-xs border border-emerald-500/30">
                  {lead.score}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          title="Total Leads"
          value={totalLeadsVal}
          change="+12.4% vs last mo"
          isPositive={true}
          icon={<Users className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          title="Hot ICP"
          value={hotLeadsVal.toString()}
          change="Immediate Action"
          isPositive={true}
          icon={<Flame className="w-5 h-5 text-rose-400" />}
        />
        <MetricCard
          title="Conversion"
          value="25.8%"
          change="Optimized Flow"
          isPositive={true}
          icon={<TrendingUp className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          title="Revenue"
          value="$310,000"
          change="Projected"
          isPositive={true}
          icon={<DollarSign className="w-5 h-5 text-cyan-400" />}
        />
      </div>

      {/* Growth & Trajectory & Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card glass className="lg:col-span-2 p-6 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-foreground">Growth & Trajectory</h2>
              <p className="text-xs text-muted-foreground">AI-predicted performance for the next 30 days</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="indigo" className="text-xs cursor-pointer">Leads</Badge>
              <Badge variant="outline" className="text-xs cursor-pointer">Revenue</Badge>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockAnalyticsData.monthlyGrowth}>
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} />
                <RechartsTooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px" }} />
                <Bar dataKey="leads" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card glass className="p-6 border border-white/10">
          <div className="mb-4">
            <h2 className="text-base font-bold text-foreground">Lead Source</h2>
            <p className="text-xs text-muted-foreground">Distribution</p>
          </div>
          <div className="h-48 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mockAnalyticsData.leadSources}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {mockAnalyticsData.leadSources.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-2">
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
    </DashboardLayout>
  );
}

