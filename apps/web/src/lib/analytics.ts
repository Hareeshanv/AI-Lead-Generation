import { useEffect, useState, type CSSProperties } from "react";
import type { AnalyticsBucket, AnalyticsRangeParams, Lead, LeadStatus } from "@/types";
import { useThemeStore } from "@/stores/useThemeStore";
import { sourcePlatformLabel } from "@/lib/utils";

export const LEAD_STATUSES: LeadStatus[] = ["New", "Hot", "Warm", "Cold", "Qualified", "Contacted", "Closed"];

export const HIGH_SCORE = 70;
export const MEDIUM_SCORE = 40;

export const scoreBadgeClass = (score: number): string =>
  score >= HIGH_SCORE
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
    : score >= MEDIUM_SCORE
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
      : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";

export const leadSourceLabel = (lead: Lead): string =>
  lead.sourcePlatform ? sourcePlatformLabel(lead.sourcePlatform) : lead.source?.trim() || "Other";

/** "12.3%" for a 0..1 ratio; "—" when there is no data. */
export const formatRate = (ratio: number | null | undefined, digits = 1): string =>
  ratio == null || Number.isNaN(ratio) ? "—" : `${(ratio * 100).toFixed(digits)}%`;

export const formatNumber = (value: number | null | undefined, digits = 0): string =>
  value == null || Number.isNaN(value)
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const formatDuration = (ms: number | null | undefined): string => {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
};

/** Spread into MetricCard; empty when there is nothing to compare. */
export interface ChangeChip {
  change?: string;
  isPositive?: boolean;
}

/**
 * MetricCard change chip vs the previous period. Counts and amounts show a relative change ("+12.5%"),
 * rates show percentage points ("+2.1 pts"). `lowerIsBetter` flips the colour (bounce rate, deal cycle).
 */
export function compareChange(
  current: number | null | undefined,
  previous: number | null | undefined,
  options: { kind?: "count" | "rate"; lowerIsBetter?: boolean } = {}
): ChangeChip {
  if (current == null || previous == null) return {};
  const good = (delta: number) => (options.lowerIsBetter ? delta <= 0 : delta >= 0);
  if (options.kind === "rate") {
    const pts = (current - previous) * 100;
    return { change: `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts`, isPositive: good(pts) };
  }
  const delta = current - previous;
  if (previous === 0) {
    if (current === 0) return { change: "0%", isPositive: true };
    return { change: "New", isPositive: good(delta) };
  }
  const pct = (delta / Math.abs(previous)) * 100;
  return { change: `${pct >= 0 ? "+" : ""}${Math.abs(pct) >= 100 ? pct.toFixed(0) : pct.toFixed(1)}%`, isPositive: good(delta) };
}

/** YYYY-MM-DD in the browser's local time. */
export const toIsoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type RangePreset = "7d" | "30d" | "90d" | "mtd" | "lastMonth" | "ytd" | "12m" | "custom";

export const RANGE_PRESETS: { key: Exclude<RangePreset, "custom">; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "ytd", label: "Year to date" },
  { key: "12m", label: "Last 12 months" },
];

/** Inclusive from/to dates for a preset, ending today. */
export function presetRange(preset: Exclude<RangePreset, "custom">, today = new Date()): AnalyticsRangeParams {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysAgo = (n: number) => new Date(end.getFullYear(), end.getMonth(), end.getDate() - n);
  switch (preset) {
    case "7d":
      return { from: toIsoDate(daysAgo(6)), to: toIsoDate(end) };
    case "30d":
      return { from: toIsoDate(daysAgo(29)), to: toIsoDate(end) };
    case "90d":
      return { from: toIsoDate(daysAgo(89)), to: toIsoDate(end) };
    case "mtd":
      return { from: toIsoDate(new Date(end.getFullYear(), end.getMonth(), 1)), to: toIsoDate(end) };
    case "lastMonth":
      return {
        from: toIsoDate(new Date(end.getFullYear(), end.getMonth() - 1, 1)),
        to: toIsoDate(new Date(end.getFullYear(), end.getMonth(), 0)),
      };
    case "ytd":
      return { from: toIsoDate(new Date(end.getFullYear(), 0, 1)), to: toIsoDate(end) };
    case "12m":
      return { from: toIsoDate(new Date(end.getFullYear() - 1, end.getMonth(), end.getDate() + 1)), to: toIsoDate(end) };
  }
}

/** Axis label for a time-series bucket start (YYYY-MM-DD). */
export function bucketLabel(bucket: string, size: AnalyticsBucket): string {
  const [y, m, d] = bucket.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(date.getTime())) return bucket;
  if (size === "month") return date.toLocaleString(undefined, { month: "short", year: "2-digit" });
  return date.toLocaleString(undefined, { day: "numeric", month: "short" });
}

/** Human description of an API range (to is exclusive). */
export function describeRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(new Date(toIso).getTime() - 1);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(from)} – ${fmt(to)}`;
}

export interface ChartTheme {
  grid: string;
  axis: string;
  text: string;
  tooltipBg: string;
  tooltipBorder: string;
  primary: string;
  secondary: string;
  series: string[];
}

const FALLBACK_THEME: ChartTheme = {
  grid: "hsl(240 10% 14%)",
  axis: "hsl(217.9 10.6% 64.9%)",
  text: "hsl(210 20% 98%)",
  tooltipBg: "hsl(240 10% 6%)",
  tooltipBorder: "hsl(240 10% 14%)",
  primary: "hsl(160 84% 45%)",
  secondary: "hsl(190 95% 42%)",
  series: ["hsl(160 84% 45%)", "hsl(190 95% 42%)", "#6366f1", "#f59e0b", "#94a3b8"],
};

const readVar = (styles: CSSStyleDeclaration, name: string, fallback: string): string => {
  const value = styles.getPropertyValue(name).trim();
  return value ? `hsl(${value})` : fallback;
};

/** Chart colours resolved from the active theme's CSS variables. */
export const useChartTheme = (): ChartTheme => {
  const theme = useThemeStore((s) => s.theme);
  const [colors, setColors] = useState<ChartTheme>(FALLBACK_THEME);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const primary = readVar(styles, "--primary", FALLBACK_THEME.primary);
    const secondary = readVar(styles, "--secondary", FALLBACK_THEME.secondary);
    setColors({
      grid: readVar(styles, "--border", FALLBACK_THEME.grid),
      axis: readVar(styles, "--muted-foreground", FALLBACK_THEME.axis),
      text: readVar(styles, "--foreground", FALLBACK_THEME.text),
      tooltipBg: readVar(styles, "--card", FALLBACK_THEME.tooltipBg),
      tooltipBorder: readVar(styles, "--border", FALLBACK_THEME.tooltipBorder),
      primary,
      secondary,
      series: [primary, secondary, "#6366f1", "#f59e0b", "#94a3b8"],
    });
  }, [theme]);

  return colors;
};

export const tooltipStyle = (c: ChartTheme): CSSProperties => ({
  backgroundColor: c.tooltipBg,
  borderColor: c.tooltipBorder,
  borderRadius: 8,
  color: c.text,
  fontSize: 12,
});
