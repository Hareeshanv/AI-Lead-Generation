"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { companyApi } from "@/services/apiClient";
import { ArrowLeft, Globe, MapPin, Building2, Users, DollarSign, ExternalLink, Linkedin, Twitter } from "lucide-react";
import Link from "next/link";

export default function CompanyDetailPage() {
  const params = useParams();
  const companyId = params?.id as string;
  const [company, setCompany] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const companies = await companyApi.getCompanies();
        const found = companies.find((c) => c.id === companyId) || companies[0];
        setCompany(found);
      } catch (err) {
        console.error("Failed to load company detail:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchCompany();
  }, [companyId]);

  if (isLoading || !company) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto animate-spin">
            <Building2 className="w-6 h-6 animate-pulse" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Loading Company Details...</h2>
        </div>
      </DashboardLayout>
    );
  }

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
            {company.techStack?.map((tech: string) => (
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
