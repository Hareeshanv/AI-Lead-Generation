"use client";

import React, { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { useLeadStore } from "@/stores/useLeadStore";
import { Search, Filter, Download, Upload, Plus, Flame, Eye, Trash2, Mail, Phone, Users, ExternalLink } from "lucide-react";
import Link from "next/link";

export default function LeadsPage() {
  const { leads, searchQuery, setSearchQuery, selectedStatus, setSelectedStatus, fetchLeads, isLoading, runPipeline, specificAnswer } = useLeadStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadCompany, setNewLeadCompany] = useState("");
  const [newLeadEmail, setNewLeadEmail] = useState("");

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const filteredLeads = leads.filter((lead) => {
    const matchesQuery =
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === "All" || lead.status === selectedStatus;
    return matchesQuery && matchesStatus;
  });

  return (
    <DashboardLayout>
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lead Management Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time ICP scoring, enrichment signals, and outreach tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm">
            <Upload className="w-4 h-4 mr-1.5" /> Import
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Lead
          </Button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="glass-panel p-4 rounded-xl border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <Input
            icon={<Search className="w-4 h-4" />}
            placeholder="Search by name, title, company..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Button variant="secondary" size="sm" onClick={() => runPipeline(searchQuery)}>
            Run AI Search
          </Button>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {["All", "Hot", "Warm", "Cold"].map((status) => (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedStatus === status
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "bg-card/50 text-muted-foreground hover:bg-card hover:text-foreground border border-border"
              }`}
            >
              {status} {status !== "All" && `(${leads.filter((l) => l.status === status).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Sarvam AI Specific Agent Answer Banner */}
      {specificAnswer && (
        <div className="p-4 rounded-xl glass-panel border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-950/40 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 mt-0.5">
              <Users className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Sarvam AI Agent Specific Answer</h3>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Targeted Result
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {specificAnswer}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Lead Table */}
      <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-card/60 text-muted-foreground uppercase text-[11px] font-semibold tracking-wider border-b border-border">
              <tr>
                <th className="py-3.5 px-4">Lead Name</th>
                <th className="py-3.5 px-4">Company & Industry</th>
                <th className="py-3.5 px-4">ICP Score</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Source</th>
                <th className="py-3.5 px-4">Contact Info</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="max-w-sm mx-auto space-y-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto animate-spin">
                        <Users className="w-5 h-5 animate-pulse" />
                      </div>
                      <h4 className="font-bold text-foreground text-sm">Loading Leads from Database...</h4>
                    </div>
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="max-w-sm mx-auto space-y-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                        <Users className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-foreground text-sm">No Leads in Database</h4>
                      <p className="text-xs text-muted-foreground">
                        Dummy sample leads cleared out. Click <strong className="text-foreground">"+ Add Lead"</strong> or run an AI Agent to generate new prospects.
                      </p>
                      <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
                        <Plus className="w-4 h-4 mr-1.5" /> Add Your First Lead
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-card/40 transition-colors group">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <Avatar src={lead.avatar} name={lead.name} />
                        <div>
                          <Link href={`/leads/${lead.id}`} className="font-semibold text-foreground hover:text-primary transition-colors">
                            {lead.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{lead.title}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-foreground">{lead.company}</div>
                      <div className="text-xs text-muted-foreground">{lead.industry}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-mono font-bold text-xs border ${
                        lead.score >= 70
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : lead.score >= 40
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      }`}>
                        <Flame className={`w-3.5 h-3.5 ${lead.score >= 70 ? "text-emerald-400" : lead.score >= 40 ? "text-amber-400" : "text-rose-400"}`} />
                        {lead.score}/100
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="py-3.5 px-4 text-xs text-muted-foreground">{lead.source}</td>
                    <td className="py-3.5 px-4 text-xs">
                      <div className={`font-mono font-semibold ${lead.email && lead.email !== "Not available" ? "text-indigo-400" : "text-muted-foreground/50 italic"}`}>
                        {lead.email && lead.email !== "Not available" ? lead.email : "—"}
                      </div>
                      <div className={`mt-0.5 ${lead.phone && lead.phone !== "Not available" ? "text-muted-foreground" : "text-muted-foreground/50 italic"}`}>
                        {lead.phone && lead.phone !== "Not available" ? lead.phone : "—"}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/leads/${lead.id}`}>
                          <Button variant="ghost" size="icon" aria-label="View lead details">
                            <Eye className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="icon" aria-label="Send email"
                          disabled={!lead.email || lead.email === "Not available"}
                          className={!lead.email || lead.email === "Not available" ? "opacity-30" : ""}
                        >
                          <Mail className="w-4 h-4 text-muted-foreground hover:text-indigo-400" />
                        </Button>
                        {(lead as any).profileUrl && (
                          <a href={(lead as any).profileUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="icon" aria-label="View LinkedIn profile">
                              <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-blue-400" />
                            </Button>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Lead Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add New Lead Manually">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Lead Name</label>
            <Input placeholder="e.g. Sarah Jenkins" value={newLeadName} onChange={(e) => setNewLeadName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Company</label>
            <Input placeholder="e.g. Stripe Tech Solutions" value={newLeadCompany} onChange={(e) => setNewLeadCompany(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Work Email</label>
            <Input placeholder="e.g. s.jenkins@company.com" value={newLeadEmail} onChange={(e) => setNewLeadEmail(e.target.value)} />
          </div>
          <Button
            variant="primary"
            className="w-full mt-2"
            onClick={() => {
              setIsModalOpen(false);
            }}
          >
            Create Lead
          </Button>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
