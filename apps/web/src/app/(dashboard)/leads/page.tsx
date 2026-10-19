"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState, LoadingState } from "@/components/ui/QueryState";
import { smallSelectClassName, useMemberNames } from "@/components/crm/shared";
import { LeadFormModal } from "@/components/leads/LeadFormModal";
import { ImportLeadsModal } from "@/components/leads/ImportLeadsModal";
import { AddToCampaignModal } from "@/components/leads/AddToCampaignModal";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { SignalCard } from "@/components/leads/SignalCard";
import {
  EMPTY_LEAD_FILTERS,
  LeadFiltersPanel,
  SearchFilterChips,
  StatusFilterBar,
  countActiveFilters,
  leadFilterParams,
  type LeadFilterValues,
} from "@/components/leads/LeadFilters";
import { LeadBulkToolbar } from "@/components/leads/LeadBulkToolbar";
import { BulkLeadActionDialog, DeleteLeadDialog, type BulkLeadDialogKind } from "@/components/leads/LeadDialogs";
import { useBulkLeadAction, useLeadAiSearch, useLeads } from "@/hooks/useLeads";
import { useBulkCreateDeals } from "@/hooks/useDeals";
import { useDebounced } from "@/hooks/useDebounced";
import { useLeadExport } from "@/hooks/useLeadExport";
import { useHasRole } from "@/hooks/useMe";
import { cn } from "@/lib/utils";
import { compareSignals } from "@/services/api";
import type { Lead, LeadListParams } from "@/types";

const PAGE_SIZES = [25, 50, 100];

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
  const {
    runSearch,
    isSearching,
    isRefreshing,
    searchError,
    retrySearch,
    searchResult,
    removeSearchFilter,
    clearSearch,
    updateSignalStatus,
    deleteSignal,
    importSignals,
  } = useLeadAiSearch();
  const isManager = useHasRole("manager");
  const { nameOf } = useMemberNames();

  const [filters, setFilters] = useState<LeadFilterValues>(EMPTY_LEAD_FILTERS);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [sort, setSort] = useState("-createdAt");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [formLead, setFormLead] = useState<Lead | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [bulkDialog, setBulkDialog] = useState<BulkLeadDialogKind | "campaign" | null>(null);

  const signalFileRef = useRef<HTMLInputElement>(null);
  const [isImportingSignals, setIsImportingSignals] = useState(false);

  // The header search navigates here with ?q=.
  useEffect(() => {
    setSearchQuery(urlQuery);
  }, [urlQuery]);

  const q = useDebounced(searchQuery.trim(), 300);

  const params: LeadListParams = useMemo(
    () => ({ page, pageSize, sort, q: q || undefined, ...leadFilterParams(filters) }),
    [page, pageSize, sort, q, filters]
  );

  const leadsQuery = useLeads(params);
  const rescore = useBulkLeadAction();
  const createDeals = useBulkCreateDeals();
  const { exportLeads, isExporting } = useLeadExport();

  // Any filter/search change starts from page 1 and clears the selection.
  useEffect(() => {
    setPage(1);
  }, [q, filters, pageSize, sort]);
  useEffect(() => {
    setSelected(new Set());
  }, [params]);

  const setFilter = useCallback(
    <K extends keyof LeadFilterValues>(key: K, value: LeadFilterValues[K]) => setFilters((f) => ({ ...f, [key]: value })),
    []
  );
  const toggleStatus = (status: string) =>
    setFilters((f) => ({ ...f, status: f.status.includes(status) ? f.status.filter((s) => s !== status) : [...f.status, status] }));

  const activeFilterCount = countActiveFilters(filters);
  const isFiltered = activeFilterCount > 0 || q !== "";

  /** Leaves AI search mode and clears the search box (and the header's ?q=). */
  const exitSearch = () => {
    clearSearch();
    setSearchQuery("");
    if (urlQuery) router.replace("/leads");
  };
  const clearAllFilters = () => {
    setFilters(EMPTY_LEAD_FILTERS);
    exitSearch();
  };

  const pageData = leadsQuery.data;
  const rows = useMemo(() => (searchResult ? searchResult.leads : pageData?.data ?? []), [searchResult, pageData]);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const toggle = useCallback(
    (id: string) =>
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );
  const toggleAll = useCallback(
    (select: boolean) =>
      setSelected((s) => {
        const next = new Set(s);
        for (const l of rows) {
          if (select) next.add(l.id);
          else next.delete(l.id);
        }
        return next;
      }),
    [rows]
  );
  const onDelete = isManager ? setDeleteTarget : undefined;

  const handleRescore = async () => {
    try {
      await rescore.mutateAsync({ action: "rescore", leadIds: selectedIds });
      clearSelection();
    } catch {
      // toast shown
    }
  };

  const handleCreateDeals = async () => {
    try {
      await createDeals.mutateAsync({ leadIds: selectedIds });
      clearSelection();
    } catch {
      // toast shown
    }
  };

  const handleExport = () => {
    if (selectedIds.length > 0) {
      const chosen = rows.filter((l) => selected.has(l.id));
      return exportLeads({ kind: "loaded", leads: chosen, label: `selected lead${chosen.length === 1 ? "" : "s"}` });
    }
    if (searchResult) return exportLeads({ kind: "loaded", leads: searchResult.leads });
    return exportLeads({ kind: "filtered", params, total: pageData?.meta.total ?? 0 });
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

  const searchHasNoResults = searchResult !== null && searchResult.leads.length === 0 && searchResult.signals.length === 0;
  const meta = pageData?.meta;
  const firstRow = meta && meta.total > 0 ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const lastRow = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0;

  const tableContent = () => {
    if (searchResult) {
      if (searchError) return <ErrorState title="Couldn't refresh the search" error={searchError} onRetry={retrySearch} />;
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
        <div className={cn("transition-opacity", isRefreshing && "opacity-60")}>
          <LeadsTable
            leads={searchResult.leads}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            ownerName={nameOf}
            onEdit={setFormLead}
            onDelete={onDelete}
          />
        </div>
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
          ownerName={nameOf}
          onEdit={setFormLead}
          onDelete={onDelete}
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
            <Button variant="outline" size="sm" onClick={() => void handleExport()} isLoading={isExporting} disabled={rows.length === 0}>
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

        {searchResult && <SearchFilterChips result={searchResult} onRemove={removeSearchFilter} onBack={exitSearch} />}

        {!searchResult && <StatusFilterBar selected={filters.status} onToggle={toggleStatus} total={meta?.total} />}

        {showMoreFilters && !searchResult && <LeadFiltersPanel filters={filters} onChange={setFilter} />}
      </div>

      {selectedIds.length > 0 && (
        <LeadBulkToolbar
          count={selectedIds.length}
          isManager={isManager}
          onOpenDialog={setBulkDialog}
          onRescore={() => void handleRescore()}
          isRescoring={rescore.isPending}
          onCreateDeals={() => void handleCreateDeals()}
          isCreatingDeals={createDeals.isPending}
          onClear={clearSelection}
        />
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
        onDone={clearSelection}
      />
      <BulkLeadActionDialog
        dialog={bulkDialog === "campaign" ? null : bulkDialog}
        leadIds={selectedIds}
        onClose={() => setBulkDialog(null)}
        onDone={clearSelection}
      />
      <DeleteLeadDialog lead={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </>
  );
}
