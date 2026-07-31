"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FileText, Download, Calendar, CheckCircle2 } from "lucide-react";

export default function ReportsPage() {
  const reports = [
    { title: "Q3 AI Lead Generation Executive Summary", date: "Jul 31, 2026", size: "2.4 MB", type: "PDF Report" },
    { title: "Fintech ICP Verification & Deliverability Audit", date: "Jul 28, 2026", size: "1.8 MB", type: "CSV Export" },
    { title: "Weekly Autonomous Outreach Conversion Breakdown", date: "Jul 24, 2026", size: "850 KB", type: "PDF Report" },
  ];

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Executive Reports & Data Exports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Download scheduled PDF performance reports and raw lead CSV files</p>
        </div>
      </div>

      <div className="space-y-4">
        {reports.map((report, idx) => (
          <Card key={idx} glass className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">{report.title}</h3>
                <p className="text-xs text-muted-foreground">{report.date} • {report.size} • {report.type}</p>
              </div>
            </div>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-1.5" /> Download
            </Button>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
