"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { smallSelectClassName, useMemberNames } from "@/components/crm/shared";
import { useLeadFacets, type SearchFilterKey } from "@/hooks/useLeads";
import { LEAD_STATUSES } from "@/lib/analytics";
import { cn, sourcePlatformLabel } from "@/lib/utils";
import type { LeadListParams, LeadSearchFilters, LeadSearchResult, LeadSourcePlatform } from "@/types";

const ALL = "";

export interface LeadFilterValues {
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

export const EMPTY_LEAD_FILTERS: LeadFilterValues = {
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

const toNumber = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

/** List API params for the filter form (dates are whole local days). */
export function leadFilterParams(filters: LeadFilterValues): LeadListParams {
  return {
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
  };
}

/** The status chips count as one filter. */
export const countActiveFilters = (filters: LeadFilterValues): number =>
  Object.entries(filters).filter(([k, v]) => k !== "status" && (Array.isArray(v) ? v.length > 0 : v !== "")).length +
  (filters.status.length ? 1 : 0);

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

export const StatusFilterBar: React.FC<{ selected: string[]; onToggle: (status: string) => void; total?: number }> = ({
  selected,
  onToggle,
  total,
}) => (
  <div className="flex flex-wrap items-center gap-2">
    {LEAD_STATUSES.map((status) => {
      const isActive = selected.includes(status);
      return (
        <button
          key={status}
          type="button"
          aria-pressed={isActive}
          onClick={() => onToggle(status)}
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
    {total !== undefined && <span className="ml-auto text-xs text-muted-foreground">{total} lead{total === 1 ? "" : "s"}</span>}
  </div>
);

export const LeadFiltersPanel: React.FC<{
  filters: LeadFilterValues;
  onChange: <K extends keyof LeadFilterValues>(key: K, value: LeadFilterValues[K]) => void;
}> = ({ filters, onChange }) => {
  const { members, nameOf } = useMemberNames();
  const facetData = useLeadFacets().data;
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <FilterSelect
        label="Owner"
        value={filters.ownerId}
        onChange={(v) => onChange("ownerId", v)}
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
        onChange={(v) => onChange("source", v)}
        options={(facetData?.sources ?? []).map((s) => ({ value: s, label: s }))}
      />
      <FilterSelect
        label="Tag"
        value={filters.tag}
        onChange={(v) => onChange("tag", v)}
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
            onChange={(e) => onChange("minScore", e.target.value)}
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
            onChange={(e) => onChange("maxScore", e.target.value)}
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
            onChange={(e) => onChange("createdFrom", e.target.value)}
            className={smallSelectClassName}
            aria-label="Added from"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            value={filters.createdTo}
            onChange={(e) => onChange("createdTo", e.target.value)}
            className={smallSelectClassName}
            aria-label="Added to"
          />
        </div>
      </label>
      <FilterSelect
        label="Ad platform"
        value={filters.sourcePlatform}
        onChange={(v) => onChange("sourcePlatform", v)}
        options={[
          ...(facetData?.sourcePlatforms ?? []).map((p) => ({ value: p, label: sourcePlatformLabel(p as LeadSourcePlatform) })),
          { value: "none", label: "Other / manual" },
        ]}
      />
      <FilterSelect
        label="Ad campaign"
        value={filters.campaignName}
        onChange={(v) => onChange("campaignName", v)}
        options={(facetData?.campaigns ?? []).map((c) => ({ value: c, label: c }))}
      />
      <FilterSelect
        label="Course interest"
        value={filters.courseInterest}
        onChange={(v) => onChange("courseInterest", v)}
        options={(facetData?.courses ?? []).map((c) => ({ value: c, label: c }))}
      />
      <FilterSelect
        label="Exam year"
        value={filters.examYear}
        onChange={(v) => onChange("examYear", v)}
        options={(facetData?.examYears ?? []).map((y) => ({ value: y, label: y }))}
      />
    </div>
  );
};

interface FilterChip {
  key: SearchFilterKey;
  keyword?: string;
  label: string;
}

const filterChips = (f: LeadSearchFilters): FilterChip[] => {
  const chips: FilterChip[] = [];
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

/** Filters an AI search derived from the query; removing one re-runs the search without it. */
export const SearchFilterChips: React.FC<{
  result: LeadSearchResult;
  onRemove: (key: SearchFilterKey, keyword?: string) => void;
  onBack: () => void;
}> = ({ result, onRemove, onBack }) => {
  const chips = filterChips(result.filters);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium text-muted-foreground">
        {result.parsedBy === "sarvam" ? "AI search (Sarvam)" : "AI search (keyword parser)"}:
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
              onClick={() => onRemove(chip.key, chip.keyword)}
              aria-label={`Remove filter ${chip.label}`}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))
      )}
      <Button variant="ghost" size="sm" onClick={onBack}>
        <X className="w-3.5 h-3.5" /> Back to all leads
      </Button>
    </div>
  );
};
