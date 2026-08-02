"use client";

import React, { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Shield, Users, Cpu, Activity, AlertTriangle, Sparkles, UserPlus, Database, Lock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function AdminPage() {
  const [users, setUsers] = useState([
    { name: "Alex Sterling", email: "alex.sterling@enterprise-ai.io", role: "Super Admin", status: "Active" },
    { name: "Elena Rostova", email: "elena@enterprise-ai.io", role: "Growth Lead", status: "Active" },
    { name: "David Chen", email: "david@enterprise-ai.io", role: "Sales Rep", status: "Active" },
    { name: "Sarah Jenkins", email: "sarah.j@enterprise-ai.io", role: "AI Ops Admin", status: "Active" },
  ]);

  const auditLogs = [
    { event: "API Key Generated", user: "Alex Sterling", time: "10 mins ago", ip: "192.168.1.45" },
    { event: "Agent Pipeline Config Updated", user: "Elena Rostova", time: "1 hour ago", ip: "10.0.4.12" },
    { event: "Supabase Database RLS Sync", user: "System Automator", time: "3 hours ago", ip: "Internal" },
  ];

  const handleInviteUser = () => {
    toast.success("Team invitation link generated & emailed to new member!");
  };

  return (
    <DashboardLayout>
      {/* Top Banner Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            Admin System Control Panel <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage workspace members, security policies, LLM token quotas & live system health
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="indigo" className="px-3 py-1 bg-indigo-500/10 text-indigo-300 border-indigo-500/30 font-mono text-xs">
            Enterprise Tier Workspace
          </Badge>
          <Button variant="primary" size="sm" onClick={handleInviteUser}>
            <UserPlus className="w-4 h-4 mr-1.5" /> Invite Member
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card glass className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase">Active Users</p>
          <p className="text-2xl font-bold text-foreground mt-1">4 / 10 Licenses</p>
          <span className="text-xs text-emerald-400 flex items-center gap-1 mt-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> All active
          </span>
        </Card>

        <Card glass className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase">Monthly Token Usage</p>
          <p className="text-2xl font-bold text-indigo-400 font-mono mt-1">14.2M / 50M</p>
          <div className="w-full bg-card/60 h-1.5 rounded-full overflow-hidden mt-2">
            <div className="bg-indigo-500 h-full w-[28.4%]" />
          </div>
        </Card>

        <Card glass className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase">Agent API Latency (p99)</p>
          <p className="text-2xl font-bold text-emerald-400 font-mono mt-1">420ms</p>
          <span className="text-xs text-muted-foreground mt-1 block">Optimal Performance</span>
        </Card>

        <Card glass className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase">Database Health</p>
          <p className="text-2xl font-bold text-cyan-400 mt-1">100% Operational</p>
          <span className="text-xs text-muted-foreground mt-1 block">Postgres Vector RLS active</span>
        </Card>
      </div>

      {/* Main Admin Section Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User Management Table */}
        <Card glass className="lg:col-span-2 space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" /> Workspace Members & Roles
            </h2>
            <Badge variant="outline" className="text-xs">{users.length} Members</Badge>
          </div>
          <div className="overflow-x-auto">
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
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-foreground">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="py-3 px-3 text-xs text-indigo-400 font-semibold font-mono">{u.role}</td>
                    <td className="py-3 px-3">
                      <Badge variant="success">{u.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Security Audit Log */}
        <Card glass className="space-y-4 p-5">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Lock className="w-4 h-4 text-cyan-400" /> Security Audit Log
          </h2>
          <div className="space-y-3">
            {auditLogs.map((log, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-card/60 border border-white/5 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">{log.event}</span>
                  <span className="text-[10px] text-muted-foreground">{log.time}</span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center justify-between">
                  <span>By {log.user}</span>
                  <span className="font-mono text-[10px] text-indigo-400">{log.ip}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

