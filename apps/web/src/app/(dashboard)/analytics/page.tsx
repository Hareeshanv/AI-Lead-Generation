"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { mockAnalyticsData } from "@/lib/mockData";
import { BarChart3, Download, TrendingUp, Users, Target, DollarSign } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from "recharts";

export default function AnalyticsPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Advanced Revenue & AI Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Full-funnel lead velocity, conversion attribution, and AI agent performance ROI
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-1.5" /> Export PDF
          </Button>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard title="Lead Acquisition Rate" value="2,840" change="+24.5%" isPositive={true} icon={<Users className="w-5 h-5" />} />
        <MetricCard title="ICP Qualified Ratio" value="78.2%" change="+6.4%" isPositive={true} icon={<Target className="w-5 h-5 text-indigo-400" />} />
        <MetricCard title="Meeting Conversion" value="25.8%" change="+4.1%" isPositive={true} icon={<TrendingUp className="w-5 h-5 text-emerald-400" />} />
        <MetricCard title="Pipeline Revenue" value="$310,000" change="+32.8%" isPositive={true} icon={<DollarSign className="w-5 h-5 text-amber-400" />} />
      </div>

      <Card glass>
        <h2 className="text-base font-semibold text-foreground mb-4">Monthly Revenue & Conversion Funnel</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mockAnalyticsData.monthlyGrowth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <RechartsTooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px" }} />
              <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </DashboardLayout>
  );
}
