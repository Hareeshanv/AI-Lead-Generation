"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Megaphone,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState, LoadingState } from "@/components/ui/QueryState";
import { smallSelectClassName, useMemberNames } from "@/components/crm/shared";
import { LeadFormModal } from "@/components/leads/LeadFormModal";
import { ImportLeadsModal } from "@/components/leads/ImportLeadsModal";
import { AddToCampaignModal } from "@/components/leads/AddToCampaignModal";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { SignalCard } from "@/components/leads/SignalCard";
import {
  useBulkLeadAction,
  useDeleteLead,
  useLeadAiSearch,
  useLeadFacets,
  useLeads,
  type SearchFilterKey,
} from "@/hooks/useLeads";
import { useHasRole } from "@/hooks/useMe";
import { cn, sourcePlatformLabel } from "@/lib/utils";
import { LEAD_STATUSES } from "@/lib/analytics";
import { csvFilename, downloadCsv, leadsToCsv } from "@/lib/csv";
import { errorMessage } from "@/lib/toast";
import { compareSignals, leadApi } from "@/services/api";
import type { Lead, LeadListParams, LeadSearchFilters, LeadSourcePlatform, LeadStatus } from "@/types";

const ALL = "";
const PAGE_SIZES = [25, 50, 100];
const EXPORT_LIMIT = 5000;

const filterChips = (f: LeadSearchFilters): { key: SearchFilterKey; keyword?: string; label: string }[] => {
  const chips: { key: SearchFilterKey; keyword?: string; label: string }[] = [];
  if (f.course_interest) chips.push({ key: "course_interest", label: `Course: ${f.course_interest}` });
  if (f.city) chips.push({ key: "city", label: `City: ${f.city}` });
  if (f.exam_year) chips.push({ key: "exam_year", label: `Exam year: ${f.exam_year}` });
  if (f.source_platform) {
    const platform =
      f.source_platform === "meta" || f.source_platform === "google" ? sourcePlatformLabel(f.source_platform) : f.source_platform;
    chips.push({ key: "source_platform", label: `Source: ${platform}` });
  }
  if (f.status) chips.push({ key: "status", label: `Status: ${f.status}` });
  if (f.min_score != null) chips.push({ key: "min_score", label: `Score ≥ ${f.min_score}` });
  for (const keyword of f.keywords) chips.push({ key: "keywords", keyword, label: `“${keyword}”` });
  return chips;
};

const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}> = ({ label, value, onChange, options, allLabel = "All" }) => (
  <label className="flex flex-col gap-1 min-w-[140px]">
    <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className={smallSelectClassName}>
      <option value={ALL}>{allLabel}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </label>
);

interface Filters {
  status: string[];
  source: string;
  ownerId: string;
  minScore: string;
  maxScore: string;
  createdFrom: string;
  createdTo: string;
  tag: string;
  sourcePlatform: string;
  campaignName: string;
  courseInterest: string;
  examYear: string;
}

const EMPTY_FILTERS: Filters = {
  status: [],
  source: ALL,
  ownerId: ALL,
  minScore: "",
  maxScore: "",
  createdFrom: "",
  createdTo: "",
  tag: ALL,
  sourcePlatform: ALL,
  campaignName: ALL,
  courseInterest: ALL,
  examYear: ALL,
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const toNumber = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

type BulkDialog = null | "assign" | "status" | "tag" | "untag" | "delete" | "campaign";

export default function LeadsPage() {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <LeadsPageContent />
    </Suspense>
  );
}

function LeadsPageContent() {
  const router = useRouter();
  const urlQuery = useSearchParams().get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(urlQuery);
  const { runSearch, isSearching, searchResult, removeSearchFilter, clearSearch, updateSignalStatus, deleteSignal, importSignals } =
    useLeadAiSearch();
  const isManager = useHasRole("manager");
  const { members, nameOf } = useMemberNames();
  const facets = useLeadFacets();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [sort, setSort] = useState("-createdAt");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [formLead, setFormLead] = useState<Lead | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null);
  const [bulkOwner, setBulkOwner] = useState<string>("");
  const [bulkStatus, setBulkStatus] = useState<LeadStatus>("Contacted");
  const [bulkTags, setBulkTags] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const signalFileRef = useRef<HTMLInputElement>(null);
  const [isImportingSignals, setIsImportingSignals] = useState(false);

  // The header search navigates here with ?q=.
  useEffect(() => {
    setSearchQuery(urlQuery);
  }, [urlQuery]);

  const q = useDebounced(searchQuery.trim(), 300);

  const params: LeadListParams = useMemo(
    () => ({
      page,
      pageSize,
      sort,
      q: q || undefined,
      status: filters.status.length ? filters.status : undefined,
      source: filters.source ? [filters.source] : undefined,
      ownerId: filters.ownerId || undefined,
      minScore: toNumber(filters.minScore),
      maxScore: toNumber(filters.maxScore),
      createdFrom: filters.createdFrom ? new Date(`${filters.createdFrom}T00:00:00`).toISOString() : undefined,
      createdTo: filters.createdTo ? new Date(`${filters.createdTo}T23:59:59.999`).toISOString() : undefined,
      tags: filters.tag ? [filters.tag] : undefined,
      sourcePlatform: filters.sourcePlatform || undefined,
      campaignName: filters.campaignName || undefined,
      courseInterest: filters.courseInterest || undefined,
      examYear: filters.examYear || undefined,
    }),
    [page, pageSize, sort, q, filters]
  );

  const leadsQuery = useLeads(params);
  const bulk = useBulkLeadAction();
  const deleteLead = useDeleteLead();

  // Any filter/search change starts from page 1 and clears the selection.
  useEffect(() => {
    setPage(1);
  }, [q, filters, pageSize, sort]);
  useEffect(() => {
    setSelected(new Set());
  }, [params]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const toggleStatus = (status: string) =>
    setFilters((f) => ({ ...f, status: f.status.includes(status) ? f.status.filter((s) => s !== status) : [...f.status, status] }));

  const activeFilterCount =
    Object.entries(filters).filter(([k, v]) => k !== "status" && (Array.isArray(v) ? v.length > 0 : v !== "")).length + (filters.status.length ? 1 : 0);
  const isFiltered = activeFilterCount > 0 || q !== "";
  const clearAllFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearchQuery("");
    clearSearch();
    if (urlQuery) router.replace("/leads");
  };

  const pageData = leadsQuery.data;
  const rows = searchResult ? searchResult.leads : pageData?.data ?? [];
  const selectedIds = Array.from(selected);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (select: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const l of rows) {
        if (select) next.add(l.id);
        else next.delete(l.id);
      }
      return next;
    });

  const runBulk = async (action: Parameters<typeof bulk.mutateAsync>[0]) => {
    try {
      await bulk.mutateAsync(action);
      setBulkDialog(null);
      setSelected(new Set());
    } catch {
      // toast shown
    }
  };

  const confirmBulk = () => {
    const tags = bulkTags.split(",").map((t) => t.trim()).filter(Boolean);
    switch (bulkDialog) {
      case "assign":
        return runBulk({ action: "assign", leadIds: selectedIds, ownerId: bulkOwner || null });
      case "status":
        return runBulk({ action: "status", leadIds: selectedIds, status: bulkStatus });
      case "tag":
      case "untag":
        if (tags.length === 0) return toast.error("Enter at least one tag.");
        return runBulk({ action: bulkDialog, leadIds: selectedIds, tags });
      case "delete":
        return runBulk({ action: "delete", leadIds: selectedIds });
    }
  };

  const handleExport = async () => {
    if (selectedIds.length > 0) {
      const chosen = rows.filter((l) => selected.has(l.id));
      downloadCsv(csvFilename("leads"), leadsToCsv(chosen));
      toast.success(`Exported ${chosen.length} selected lead${chosen.length === 1 ? "" : "s"}.`);
      return;
    }
    if (searchResult) {
      downloadCsv(csvFilename("leads"), leadsToCsv(searchResult.leads));
      toast.success(`Exported ${searchResult.leads.length} lead${searchResult.leads.length === 1 ? "" : "s"}.`);
      return;
    }
    setIsExporting(true);
    try {
      const all: Lead[] = [];
      for (let p = 1; all.length < EXPORT_LIMIT; p++) {
        const res = await leadApi.list({ ...params, page: p, pageSize: 100 });
        all.push(...res.data);
        if (p >= res.meta.totalPages || res.data.length === 0) break;
      }
      downloadCsv(csvFilename("leads"), leadsToCsv(all));
      toast.success(`Exported ${all.length} lead${all.length === 1 ? "" : "s"}${all.length >= EXPORT_LIMIT ? ` (first ${EXPORT_LIMIT})` : ""}.`);
    } catch (err) {
      toast.error(`Export failed: ${errorMessage(err)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportSignals = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => toast.error(`Could not read ${file.name}.`);
    reader.onload = async () => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(reader.result ?? ""));
      } catch {
        toast.error(`${file.name} is not valid JSON.`);
        return;
      }
      setIsImportingSignals(true);
      try {
        const result = await importSignals(payload);
        toast.success(`Imported ${result.imported} signal${result.imported === 1 ? "" : "s"}, skipped ${result.skipped}.`, {
          description: result.reasons.length > 0 ? result.reasons.slice(0, 3).join("; ") : undefined,
        });
      } catch (err) {
        toast.error(`Signal import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setIsImportingSignals(false);
      }
    };
    reader.readAsText(file);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteLead.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // toast shown
    }
  };

  const chips = searchResult ? filterChips(searchResult.filters) : [];
  const facetData = facets.data;
  const searchHasNoResults = searchResult !== null && searchResult.leads.length === 0 && searchResult.signals.length === 0;
  const meta = pageData?.meta;
  const firstRow = meta && meta.total > 0 ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const lastRow = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0;

  const bulkTitles: Record<Exclude<BulkDialog, null | "campaign">, string> = {
    assign: "Assign owner",
    status: "Change status",
    tag: "Add tags",
    untag: "Remove tags",
    delete: "Delete leads",
  };

  const tableContent = () => {
    if (searchResult) {
      if (searchHasNoResults) {
        return (
          <EmptyState
            icon={Search}
            title="No matching consented leads yet"
            description="Leads appear here once people submit your ad lead forms or consent form. Connect Meta or Google Ads lead forms, or import intent signals from your Sarvam agent."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link
                  href="/integrations"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Connect ad forms
                </Link>
                <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                  Clear search
                </Button>
              </div>
            }
          />
        );
      }
      if (searchResult.leads.length === 0) {
        return (
          <div className="rounded-xl border border-dashed border-border px-6 py-6 text-center text-sm text-muted-foreground">
            No matching consented leads yet. The intent signals below are public posts — reply publicly to invite them to your consent
            form, or{" "}
            <Link href="/integrations" className="text-primary hover:underline">
              connect ad forms
            </Link>
            .
          </div>
        );
      }
      return (
        <LeadsTable
          leads={searchResult.leads}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          ownerName={(id) => nameOf(id)}
          onEdit={(l) => setFormLead(l)}
          onDelete={isManager ? setDeleteTarget : undefined}
        />
      );
    }

    if (leadsQuery.isLoading) return <LoadingState rows={6} />;
    if (leadsQuery.isError || !pageData) {
      return <ErrorState title="Couldn't load leads" error={leadsQuery.error} onRetry={() => void leadsQuery.refetch()} />;
    }
    if (pageData.data.length === 0) {
      return isFiltered ? (
        <EmptyState
          icon={Search}
          title="No leads match the current filters"
          description="Try a different search or clear the filters."
          actionLabel="Clear filters"
          onAction={clearAllFilters}
        />
      ) : (
        <EmptyState
          icon={Users}
          title="No leads yet"
          description="Add a lead manually, import a CSV, or connect a lead source on the Integrations page."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" size="sm" onClick={() => setFormLead(null)}>
                <Plus className="w-4 h-4" /> Add lead
              </Button>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <FileSpreadsheet className="w-4 h-4" /> Import CSV
              </Button>
            </div>
          }
        />
      );
    }
    return (
      <div className={cn("space-y-3 transition-opacity", leadsQuery.isPlaceholderData && "opacity-60")}>
        <LeadsTable
          leads={pageData.data}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          sort={sort}
          onSort={setSort}
          ownerName={(id) => nameOf(id)}
          onEdit={(l) => setFormLead(l)}
          onDelete={isManager ? setDeleteTarget : undefined}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Showing {firstRow}–{lastRow} of {meta?.total ?? 0}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              Rows
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className={smallSelectClassName}>
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span>
              Page {meta?.page ?? 1} of {Math.max(meta?.totalPages ?? 1, 1)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta || page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Leads"
        description="Search, filter and work every lead with its fit score, owner and source."
        icon={Users}
        actions={
          <>
            <input ref={signalFileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportSignals} />
            {isManager && (
              <Button variant="outline" size="sm" onClick={() => signalFileRef.current?.click()} isLoading={isImportingSignals}>
                <Upload className="w-4 h-4" /> Import signals
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="w-4 h-4" /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} isLoading={isExporting} disabled={rows.length === 0}>
              <Download className="w-4 h-4" /> {selectedIds.length > 0 ? `Export ${selectedIds.length}` : "Export CSV"}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setFormLead(null)}>
              <Plus className="w-4 h-4" /> Add lead
            </Button>
          </>
        }
      />

      {/* Search and filters */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (searchQuery.trim()) void runSearch(searchQuery);
          }}
        >
          <div className="flex-1 min-w-[240px] max-w-xl">
            <Input
              icon={<Search className="w-4 h-4" />}
              placeholder="Search name, company, email, phone… or describe who you want"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search leads"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" isLoading={isSearching} disabled={!searchQuery.trim()}>
            {isSearching ? (
              "Searching..."
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Run AI search
              </>
            )}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowMoreFilters((v) => !v)}>
            <Filter className="w-4 h-4" /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
          {isFiltered && (
            <Button type="button" variant="ghost" size="sm" onClick={clearAllFilters}>
              <X className="w-3.5 h-3.5" /> Clear all
            </Button>
          )}
        </form>

        {searchResult && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              {searchResult.parsedBy === "sarvam" ? "AI search (Sarvam)" : "AI search (keyword parser)"}:
            </span>
            {chips.length === 0 ? (
              <span className="text-xs text-muted-foreground">No filters detected — showing all consented leads.</span>
            ) : (
              chips.map((chip) => (
                <span
                  key={`${chip.key}-${chip.keyword ?? ""}`}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-medium border border-primary/30 bg-primary/10 text-foreground"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={() => removeSearchFilter(chip.key, chip.keyword)}
                    aria-label={`Remove filter ${chip.label}`}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))
            )}
            <Button variant="ghost" size="sm" onClick={clearSearch}>
              <X className="w-3.5 h-3.5" /> Back to all leads
            </Button>
          </div>
        )}

        {!searchResult && (
          <div className="flex flex-wrap items-center gap-2">
            {LEAD_STATUSES.map((status) => {
              const isActive = filters.status.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggleStatus(status)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                  )}
                >
                  {status}
                </button>
              );
            })}
            {meta && <span className="ml-auto text-xs text-muted-foreground">{meta.total} lead{meta.total === 1 ? "" : "s"}</span>}
          </div>
        )}

        {showMoreFilters && !searchResult && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <FilterSelect
              label="Owner"
              value={filters.ownerId}
              onChange={(v) => setFilter("ownerId", v)}
              allLabel="Anyone"
              options={[
                { value: "me", label: "Me" },
                { value: "unassigned", label: "Unassigned" },
                ...members.map((m) => ({ value: m.userId, label: nameOf(m.userId) })),
              ]}
            />
            <FilterSelect
              label="Source"
              value={filters.source}
              onChange={(v) => setFilter("source", v)}
              options={(facetData?.sources ?? []).map((s) => ({ value: s, label: s }))}
            />
            <FilterSelect
              label="Tag"
              value={filters.tag}
              onChange={(v) => setFilter("tag", v)}
              options={(facetData?.tags ?? []).map((t) => ({ value: t, label: t }))}
            />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Score</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Min"
                  value={filters.minScore}
                  onChange={(e) => setFilter("minScore", e.target.value)}
                  className={cn(smallSelectClassName, "w-16")}
                  aria-label="Minimum score"
                />
                <span className="text-muted-foreground">–</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Max"
                  value={filters.maxScore}
                  onChange={(e) => setFilter("maxScore", e.target.value)}
                  className={cn(smallSelectClassName, "w-16")}
                  aria-label="Maximum score"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Added between</span>
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={filters.createdFrom}
                  onChange={(e) => setFilter("createdFrom", e.target.value)}
                  className={smallSelectClassName}
                  aria-label="Added from"
                />
                <span className="text-muted-foreground">–</span>
                <input
                  type="date"
                  value={filters.createdTo}
                  onChange={(e) => setFilter("createdTo", e.target.value)}
                  className={smallSelectClassName}
                  aria-label="Added to"
                />
              </div>
            </label>
            <FilterSelect
              label="Ad platform"
              value={filters.sourcePlatform}
              onChange={(v) => setFilter("sourcePlatform", v)}
              options={[
                ...(facetData?.sourcePlatforms ?? []).map((p) => ({ value: p, label: sourcePlatformLabel(p as LeadSourcePlatform) })),
                { value: "none", label: "Other / manual" },
              ]}
            />
            <FilterSelect
              label="Ad campaign"
              value={filters.campaignName}
              onChange={(v) => setFilter("campaignName", v)}
              options={(facetData?.campaigns ?? []).map((c) => ({ value: c, label: c }))}
            />
            <FilterSelect
              label="Course interest"
              value={filters.courseInterest}
              onChange={(v) => setFilter("courseInterest", v)}
              options={(facetData?.courses ?? []).map((c) => ({ value: c, label: c }))}
            />
            <FilterSelect
              label="Exam year"
              value={filters.examYear}
              onChange={(v) => setFilter("examYear", v)}
              options={(facetData?.examYears ?? []).map((y) => ({ value: y, label: y }))}
            />
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card/95 px-4 py-2 shadow-sm backdrop-blur"
        >
          <span className="text-sm font-medium text-foreground mr-1">{selectedIds.length} selected</span>
          <Button variant="outline" size="sm" onClick={() => setBulkDialog("assign")}>
            <Users className="w-3.5 h-3.5" /> Assign
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkDialog("status")}>
            Status
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkDialog("tag")}>
            <Tag className="w-3.5 h-3.5" /> Tag
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkDialog("untag")}>
            Untag
          </Button>
          {isManager && (
            <Button variant="outline" size="sm" onClick={() => setBulkDialog("campaign")}>
              <Megaphone className="w-3.5 h-3.5" /> Add to campaign
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            isLoading={bulk.isPending && bulk.variables?.action === "rescore"}
            onClick={() => void runBulk({ action: "rescore", leadIds: selectedIds })}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Rescore
          </Button>
          {isManager && (
            <Button variant="outline" size="sm" onClick={() => setBulkDialog("delete")} className="text-rose-600 hover:text-rose-600">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        </div>
      )}

      {tableContent()}

      {searchResult && searchResult.signals.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Intent signals</h2>
            <span className="text-xs text-muted-foreground">({searchResult.signals.length})</span>
            <span className="text-xs text-muted-foreground">
              · Public posts. Contact details are shown only when the author asked to be contacted; otherwise reply publicly.
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...searchResult.signals].sort(compareSignals).map((signal) => (
              <SignalCard
                key={signal.id}
                signal={signal}
                onStatusChange={(status) => updateSignalStatus(signal.id, status)}
                onDelete={() => deleteSignal(signal.id)}
              />
            ))}
          </div>
        </section>
      )}

      <LeadFormModal isOpen={formLead !== undefined} onClose={() => setFormLead(undefined)} lead={formLead ?? undefined} />
      <ImportLeadsModal isOpen={importOpen} onClose={() => setImportOpen(false)} />
      <AddToCampaignModal
        isOpen={bulkDialog === "campaign"}
        onClose={() => setBulkDialog(null)}
        leadIds={selectedIds}
        onDone={() => setSelected(new Set())}
      />

      <Modal
        isOpen={bulkDialog !== null && bulkDialog !== "campaign"}
        onClose={() => !bulk.isPending && setBulkDialog(null)}
        title={bulkDialog && bulkDialog !== "campaign" ? `${bulkTitles[bulkDialog]} (${selectedIds.length})` : ""}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setBulkDialog(null)} disabled={bulk.isPending}>
              Cancel
            </Button>
            <Button size="sm" variant={bulkDialog === "delete" ? "destructive" : "primary"} onClick={() => void confirmBulk()} isLoading={bulk.isPending}>
              {bulkDialog === "delete" ? "Delete" : "Apply"}
            </Button>
          </>
        }
      >
        {bulkDialog === "assign" && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            New owner
            <select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)} className={smallSelectClassName}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {nameOf(m.userId)}
                </option>
              ))}
            </select>
          </label>
        )}
        {bulkDialog === "status" && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            New status
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as LeadStatus)} className={smallSelectClassName}>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        {(bulkDialog === "tag" || bulkDialog === "untag") && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Tags (comma separated)
            <Input value={bulkTags} onChange={(e) => setBulkTags(e.target.value)} placeholder="e.g. webinar, priority" autoFocus />
          </label>
        )}
        {bulkDialog === "delete" && (
          <p className="text-sm text-muted-foreground">
            Permanently delete {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"} with their activities and follow-ups? Linked deals
            are kept but unlinked. This cannot be undone.
          </p>
        )}
      </Modal>

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => !deleteLead.isPending && setDeleteTarget(null)}
        title="Delete lead"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleteLead.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void confirmDelete()} isLoading={deleteLead.isPending}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>? This cannot be undone.
        </p>
      </Modal>
    </>
  );
}
