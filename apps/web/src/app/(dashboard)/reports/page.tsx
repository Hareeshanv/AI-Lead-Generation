"use client";

import React, { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FileText, Download, Calendar, Sparkles, Filter, CheckCircle2, FileSpreadsheet, Clock, Plus } from "lucide-react";
import { toast } from "sonner";

export default function ReportsPage() {
  const [generating, setGenerating] = useState(false);

  const reports = [
    { title: "Q3 AI Lead Generation Executive Summary", date: "Aug 02, 2026", size: "2.4 MB", type: "PDF Report", status: "Ready", category: "Executive" },
    { title: "Fintech ICP Verification & Deliverability Audit", date: "Jul 31, 2026", size: "1.8 MB", type: "CSV Export", status: "Ready", category: "Data Audit" },
    { title: "Weekly Autonomous Outreach Conversion Breakdown", date: "Jul 28, 2026", size: "850 KB", type: "PDF Report", status: "Ready", category: "Outreach" },
    { title: "AI Search Agent Scraping & Enrichment Logs", date: "Jul 24, 2026", size: "4.2 MB", type: "JSON Log", status: "Ready", category: "Agent Performance" },
    { title: "Pipeline Revenue & Conversion Forecast Q3/Q4", date: "Jul 20, 2026", size: "3.1 MB", type: "PDF Report", status: "Ready", category: "Financial" },
  ];

  const handleGenerateReport = () => {
    setGenerating(true);
    toast.info("Compiling latest lead discovery analytics...");
    setTimeout(() => {
      setGenerating(false);
      toast.success("Executive AI Report generated successfully!");
    }, 1500);
  };

  return (
    <DashboardLayout>
      {/* Top Banner & Quick Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            Executive Reports & Data Exports <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated PDF performance reports, CSV data exports, and AI discovery audit trails
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={handleGenerateReport} disabled={generating}>
            {generating ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin mr-2" />
                Generating Report...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1.5" /> Generate Custom AI Report
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card glass className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Reports</p>
            <h3 className="text-2xl font-bold text-foreground mt-1">48 Reports</h3>
            <span className="text-xs text-emerald-400 font-medium mt-1 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Auto-synced daily
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400">
            <FileText className="w-6 h-6" />
          </div>
        </Card>

        <Card glass className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Export Volume</p>
            <h3 className="text-2xl font-bold text-foreground mt-1">12.5 MB</h3>
            <span className="text-xs text-muted-foreground mt-1 block">Formatted CSV & JSON</span>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
        </Card>

        <Card glass className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Next Auto Scheduled</p>
            <h3 className="text-2xl font-bold text-foreground mt-1">Mon, 08:00 AM</h3>
            <span className="text-xs text-cyan-400 font-medium mt-1 block">Weekly ICP Digest</span>
          </div>
          <div className="p-3 rounded-2xl bg-cyan-500/10 text-cyan-400">
            <Clock className="w-6 h-6" />
          </div>
        </Card>
      </div>

      {/* Reports Feed */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Available Reports & Exports</h2>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            5 Recent Documents
          </Badge>
        </div>

        {reports.map((report, idx) => (
          <Card key={idx} glass className="glass-panel-hover flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                {report.type.includes("CSV") ? <FileSpreadsheet className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground text-base tracking-tight">{report.title}</h3>
                  <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                    {report.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Generated {report.date} • {report.size} • <span className="text-indigo-300 font-mono">{report.type}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.success(`Downloading ${report.title}...`)}
              >
                <Download className="w-4 h-4 mr-1.5" /> Download
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}

