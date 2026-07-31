"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { mockLeads } from "@/lib/mockData";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Building,
  Flame,
  Globe,
  DollarSign,
  Users,
  CheckCircle2,
  Clock,
  Sparkles,
  Send,
} from "lucide-react";
import Link from "next/link";

export default function LeadDetailPage() {
  const params = useParams();
  const leadId = params?.id as string;
  const lead = mockLeads.find((l) => l.id === leadId) || mockLeads[0];

  const [notes, setNotes] = useState([
    "Lead has expressed high interest in AI enrichment pipelines.",
    "Budget approved for Q3 rollout.",
  ]);
  const [newNote, setNewNote] = useState("");

  return (
    <DashboardLayout>
      {/* Top Header Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/leads">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Leads
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Phone className="w-4 h-4 mr-1.5 text-emerald-400" /> Schedule Call
          </Button>
          <Button variant="primary" size="sm">
            <Mail className="w-4 h-4 mr-1.5" /> Send Outreach Email
          </Button>
        </div>
      </div>

      {/* Main Profile Header */}
      <div className="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <Avatar src={lead.avatar} name={lead.name} size="lg" className="w-16 h-16 border-2 border-primary" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{lead.name}</h1>
              <StatusBadge status={lead.status} />
            </div>
            <p className="text-sm text-muted-foreground font-medium mt-0.5">
              {lead.title} at <span className="text-foreground">{lead.company}</span>
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> {lead.location}
              </span>
              <span className="flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-primary" /> {lead.email}
              </span>
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-emerald-400" /> {lead.phone}
              </span>
            </div>
          </div>
        </div>

        {/* Score Card */}
        <div className="p-4 rounded-xl bg-card/60 border border-border flex items-center gap-4">
          <div className="text-center">
            <div className="text-xs text-muted-foreground font-medium uppercase">ICP Fit Score</div>
            <div className="text-3xl font-extrabold text-foreground font-mono mt-0.5 flex items-center justify-center gap-1">
              <Flame className="w-6 h-6 text-rose-400" /> {lead.score}
            </div>
          </div>
          <div className="h-10 border-r border-border" />
          <div className="text-xs space-y-1">
            <div className="text-emerald-400 font-semibold">✓ High Buying Intent</div>
            <div className="text-indigo-400 font-semibold">✓ Budget Approved</div>
            <div className="text-muted-foreground">Source: {lead.source}</div>
          </div>
        </div>
      </div>

      {/* Grid: Lead Details & Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Company & Tech Stack Overview */}
        <div className="space-y-6">
          <Card glass>
            <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
              <Building className="w-4 h-4 text-primary" /> Company Profile
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Industry</span>
                <span className="font-semibold text-foreground">{lead.industry}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Employee Count</span>
                <span className="font-semibold text-foreground">{lead.companySize}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Annual Revenue</span>
                <span className="font-semibold text-foreground">{lead.annualRevenue}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Lead Owner</span>
                <span className="font-semibold text-primary">{lead.owner}</span>
              </div>
            </div>
          </Card>

          <Card glass>
            <h2 className="text-base font-semibold text-foreground mb-3">Tech Stack Detected</h2>
            <div className="flex flex-wrap gap-2">
              {lead.techStack.map((tech) => (
                <Badge key={tech} variant="indigo">
                  {tech}
                </Badge>
              ))}
            </div>
          </Card>
        </div>

        {/* Lead Timeline & Notes */}
        <div className="lg:col-span-2 space-y-6">
          <Card glass>
            <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" /> AI Agent & Contact Activity History
            </h2>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="p-2 rounded-full bg-emerald-500/10 text-emerald-400 h-fit">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Email Opened (3x)</h3>
                  <p className="text-xs text-muted-foreground">Opened personalized sequence email step #1</p>
                  <span className="text-[10px] text-muted-foreground mt-1 inline-block">Today @ 10:30 AM</span>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="p-2 rounded-full bg-indigo-500/10 text-indigo-400 h-fit">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Verification Agent Handshake</h3>
                  <p className="text-xs text-muted-foreground">Email address s.jenkins@stripe-demo.com verified (100% deliverability)</p>
                  <span className="text-[10px] text-muted-foreground mt-1 inline-block font-mono">Yesterday @ 4:15 PM</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Lead Notes */}
          <Card glass>
            <h2 className="text-base font-semibold text-foreground mb-4">Lead Notes & Strategy</h2>
            <div className="space-y-3 mb-4">
              {notes.map((note, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-card/40 border border-border text-sm text-foreground">
                  {note}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add a new note..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="flex-1 h-10 px-3 rounded-lg bg-card/60 border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <Button
                variant="primary"
                onClick={() => {
                  if (newNote.trim()) {
                    setNotes([...notes, newNote]);
                    setNewNote("");
                  }
                }}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
