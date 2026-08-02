"use client";

import React, { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { mockAnalyticsData } from "@/lib/mockData";
import { BarChart3, Download, TrendingUp, Users, Target, DollarSign, Sparkles, ArrowUpRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, AreaChart, Area } from "recharts";
import { toast } from "sonner";

export default function AnalyticsPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <DashboardLayout>
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            Advanced Revenue & AI Analytics <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Full-funnel lead velocity, conversion attribution, and AI agent performance ROI
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => toast.success("Downloading Analytics PDF Report...")}>
            <Download className="w-4 h-4 mr-1.5" /> Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.success("Downloading Raw CSV Analytics Data...")}>
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard title="Lead Acquisition Rate" value="2,840" change="+24.5%" isPositive={true} icon={<Users className="w-5 h-5" />} />
        <MetricCard title="ICP Qualified Ratio" value="78.2%" change="+6.4%" isPositive={true} icon={<Target className="w-5 h-5 text-indigo-400" />} />
        <MetricCard title="Meeting Conversion" value="25.8%" change="+4.1%" isPositive={true} icon={<TrendingUp className="w-5 h-5 text-emerald-400" />} />
        <MetricCard title="Pipeline Revenue" value="$310,000" change="+32.8%" isPositive={true} icon={<DollarSign className="w-5 h-5 text-amber-400" />} />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card glass className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Monthly Revenue Growth ($)</h2>
            <Badge variant="indigo" className="font-mono text-xs">Q3 Pipeline</Badge>
          </div>
          <div className="h-72 w-full">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mockAnalyticsData.monthlyGrowth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <RechartsTooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px" }} />
                  <Bar dataKey="revenue" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading Analytics Chart...</div>
            )}
          </div>
        </Card>

        <Card glass className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Lead Volume Velocity</h2>
            <Badge variant="success" className="font-mono text-xs">+24.5% MoM</Badge>
          </div>
          <div className="h-72 w-full">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mockAnalyticsData.monthlyGrowth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <RechartsTooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px" }} />
                  <Area type="monotone" dataKey="leads" stroke="#10b981" fill="#10b98120" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading Velocity Chart...</div>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

