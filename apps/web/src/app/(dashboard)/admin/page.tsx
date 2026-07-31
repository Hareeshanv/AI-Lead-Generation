"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Shield, Users, Cpu, Activity, AlertTriangle } from "lucide-react";

export default function AdminPage() {
  const users = [
    { name: "Alex Sterling", email: "alex.sterling@enterprise-ai.io", role: "Super Admin", status: "Active" },
    { name: "Elena Rostova", email: "elena@enterprise-ai.io", role: "Growth Lead", status: "Active" },
    { name: "David Chen", email: "david@enterprise-ai.io", role: "Sales Rep", status: "Active" },
  ];

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin System Control Panel</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage workspace members, feature flags, AI token usage & audit logs</p>
        </div>
        <Badge variant="indigo">Enterprise Workspace</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card glass className="lg:col-span-2 space-y-4">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Workspace Members & Roles
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="bg-card/60 text-muted-foreground uppercase text-[11px] border-b border-border">
              <tr>
                <th className="py-2.5 px-3">User</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {users.map((u, i) => (
                <tr key={i}>
                  <td className="py-2.5 px-3 font-semibold text-foreground">{u.name} <span className="text-xs font-normal text-muted-foreground">({u.email})</span></td>
                  <td className="py-2.5 px-3 text-xs text-indigo-400 font-semibold">{u.role}</td>
                  <td className="py-2.5 px-3"><Badge variant="success">{u.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card glass className="space-y-4">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" /> System LLM Consumption
          </h2>
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-card/60 border border-border">
              <div className="text-muted-foreground">Tokens Processed This Month</div>
              <div className="text-lg font-bold text-foreground font-mono mt-0.5">14,250,800 Tokens</div>
            </div>
            <div className="p-3 rounded-lg bg-card/60 border border-border">
              <div className="text-muted-foreground">System Latency (p99)</div>
              <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">420ms</div>
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
