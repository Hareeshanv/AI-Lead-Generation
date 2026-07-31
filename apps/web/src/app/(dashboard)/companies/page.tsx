"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { mockCompanies } from "@/lib/mockData";
import { Building2, Search, ExternalLink, Globe, Users, DollarSign, Flame, ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default function CompaniesPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Company Intelligence Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Deep firmographic data, technographic stacks, and funding insights
          </p>
        </div>
        <Button variant="primary" size="sm">
          <Building2 className="w-4 h-4 mr-1.5" /> Enrich New Domain
        </Button>
      </div>

      <div className="glass-panel p-4 rounded-xl border border-white/10 flex items-center justify-between">
        <div className="w-full max-w-md">
          <Input icon={<Search className="w-4 h-4" />} placeholder="Search company by name, tech stack, or domain..." />
        </div>
      </div>

      {/* Companies Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {mockCompanies.map((company) => (
          <Card key={company.id} glass className="hover:border-primary/40 transition-all group flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <img
                    src={company.logo}
                    alt={company.name}
                    className="w-12 h-12 rounded-xl object-cover border border-border"
                  />
                  <div>
                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                      {company.name}
                    </h3>
                    <a
                      href={`https://${company.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground flex items-center gap-1 hover:underline"
                    >
                      <Globe className="w-3 h-3 text-primary" /> {company.domain}
                    </a>
                  </div>
                </div>
                <div className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-mono font-bold text-xs border border-emerald-500/20">
                  {company.score}% ICP
                </div>
              </div>

              <p className="text-xs text-muted-foreground line-clamp-2 mb-4">{company.description}</p>

              <div className="space-y-2 mb-4 text-xs">
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Industry</span>
                  <span className="font-semibold text-foreground">{company.industry}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Employees</span>
                  <span className="font-semibold text-foreground">{company.size}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Annual Revenue</span>
                  <span className="font-semibold text-emerald-400">{company.revenue}</span>
                </div>
              </div>

              <div className="space-y-1.5 mb-4">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Tech Stack</span>
                <div className="flex flex-wrap gap-1.5">
                  {company.techStack.slice(0, 4).map((tech) => (
                    <Badge key={tech} variant="indigo" className="text-[10px]">
                      {tech}
                    </Badge>
                  ))}
                  {company.techStack.length > 4 && (
                    <Badge variant="secondary" className="text-[10px]">
                      +{company.techStack.length - 4} more
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <Link href={`/companies/${company.id}`}>
              <Button variant="outline" className="w-full text-xs">
                View Deep Intelligence <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
