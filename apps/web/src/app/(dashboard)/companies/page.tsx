"use client";

import React, { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { companyApi } from "@/services/apiClient";
import { Building2, Search, ExternalLink, Globe, Sparkles, ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default function CompaniesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [companiesList, setCompaniesList] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const data = await companyApi.getCompanies();
        setCompaniesList(data);
      } catch (err) {
        console.error("Failed to fetch companies:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchCompanies();
  }, []);

  const handleEnrichDomain = () => {
    if (!domainInput) return;
    const cleanedDomain = domainInput.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const companyName = cleanedDomain.split(".")[0].toUpperCase();

    const newCompany = {
      id: `comp-${Date.now()}`,
      name: companyName,
      domain: cleanedDomain,
      logo: `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=150&q=80`,
      industry: "Technology & Software",
      size: "100 - 500 Employees",
      revenue: "$25,000,000",
      location: "San Francisco, CA",
      techStack: ["Next.js", "TypeScript", "PostgreSQL", "AWS"],
      description: `Automated firmographic and technographic intelligence extracted for ${cleanedDomain}.`,
      founded: 2021,
      linkedin: `https://linkedin.com/company/${companyName.toLowerCase()}`,
      twitter: `https://twitter.com/${companyName.toLowerCase()}`,
      employeeCount: 250,
      leadCount: 12,
      score: 94,
    };

    setCompaniesList([newCompany, ...companiesList]);
    setDomainInput("");
    setIsModalOpen(false);
  };

  const filteredCompanies = companiesList.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.industry.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Company Intelligence Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Deep firmographic data, technographic stacks, and funding insights
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
          <Building2 className="w-4 h-4 mr-1.5" /> Enrich New Domain
        </Button>
      </div>

      <div className="glass-panel p-4 rounded-xl border border-white/10 flex items-center justify-between mt-4">
        <div className="w-full max-w-md">
          <Input 
            icon={<Search className="w-4 h-4" />} 
            placeholder="Search company by name, tech stack, or domain..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Companies Grid */}
      {isLoading ? (
        <div className="glass-panel p-12 rounded-2xl border border-white/10 text-center space-y-4 mt-6">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto animate-spin">
            <Building2 className="w-6 h-6 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Loading Company Profiles...</h3>
        </div>
      ) : filteredCompanies.length === 0 ? (
        <div className="glass-panel p-12 rounded-2xl border border-white/10 text-center space-y-4 mt-6">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-foreground">No Company Profiles Yet</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            All dummy sample companies have been cleared. Click <strong className="text-foreground">"Enrich New Domain"</strong> or run an AI Agent to extract real company intelligence.
          </p>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Sparkles className="w-4 h-4 mr-1.5" /> Enrich Your First Domain
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
          {filteredCompanies.map((company) => (
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
                    {company.techStack.slice(0, 4).map((tech: string) => (
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
      )}

      {/* Enrich Domain Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Enrich New Company Domain"
      >
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Enter a website domain URL. The AI Crawler & Extractor agents will crawl the site, identify key executives, tech stack, and firmographic data.
          </p>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">
              Company Website / Domain
            </label>
            <Input
              icon={<Globe className="w-4 h-4" />}
              placeholder="e.g. stripe.com or acmecorp.io"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
            />
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleEnrichDomain}>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Extract & Enrich Company
            </Button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
