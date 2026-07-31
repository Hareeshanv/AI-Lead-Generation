"use client";

import React from "react";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { mockCompanies, mockLeads } from "@/lib/mockData";
import { ArrowLeft, Globe, MapPin, Building2, Users, DollarSign, ExternalLink, Linkedin, Twitter } from "lucide-react";
import Link from "next/link";

export default function CompanyDetailPage() {
  const params = useParams();
  const companyId = params?.id as string;
  const company = mockCompanies.find((c) => c.id === companyId) || mockCompanies[0];
  const companyLeads = mockLeads.filter((l) => l.company.toLowerCase().includes(company.name.toLowerCase().split(" ")[0]));

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between">
        <Link href="/companies">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Companies
          </Button>
        </Link>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <img src={company.logo} alt={company.name} className="w-16 h-16 rounded-2xl object-cover border border-primary/40" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{company.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{company.description}</p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
              <span className="flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-primary" /> {company.domain}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> {company.location}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a href={company.linkedin} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <Linkedin className="w-4 h-4 text-sky-400" /> LinkedIn
            </Button>
          </a>
          <a href={company.twitter} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <Twitter className="w-4 h-4 text-cyan-400" /> Twitter
            </Button>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card glass className="space-y-4">
          <h2 className="text-base font-semibold text-foreground">Firmographic Metrics</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Founded</span>
              <span className="font-semibold text-foreground">{company.founded}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Employee Size</span>
              <span className="font-semibold text-foreground">{company.size}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Estimated Revenue</span>
              <span className="font-semibold text-emerald-400">{company.revenue}</span>
            </div>
          </div>
        </Card>

        <Card glass className="lg:col-span-2 space-y-4">
          <h2 className="text-base font-semibold text-foreground">Full Tech Stack Intelligence</h2>
          <div className="flex flex-wrap gap-2">
            {company.techStack.map((tech) => (
              <Badge key={tech} variant="indigo" className="text-sm py-1 px-3">
                {tech}
              </Badge>
            ))}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
