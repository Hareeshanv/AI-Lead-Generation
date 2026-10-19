"use client";

import React from "react";
import { CalendarRange } from "lucide-react";
import { RANGE_PRESETS, presetRange, toIsoDate, type RangePreset } from "@/lib/analytics";
import type { AnalyticsRangeParams } from "@/types";

export interface DateRangeValue {
  preset: RangePreset;
  range: AnalyticsRangeParams;
}

export const defaultDateRange = (preset: Exclude<RangePreset, "custom"> = "30d"): DateRangeValue => ({
  preset,
  range: presetRange(preset),
});

const selectClass =
  "h-8 rounded-lg bg-card/60 border border-border px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";

/** Preset dropdown plus custom from/to dates (inclusive). */
export const DateRangePicker: React.FC<{ value: DateRangeValue; onChange: (value: DateRangeValue) => void }> = ({
  value,
  onChange,
}) => {
  const today = toIsoDate(new Date());

  const setPreset = (preset: RangePreset) => {
    if (preset === "custom") onChange({ preset, range: value.range });
    else onChange({ preset, range: presetRange(preset) });
  };

  const setDate = (key: "from" | "to", date: string) => {
    if (!date) return;
    const next = { ...value.range, [key]: date };
    if (next.from > next.to) {
      if (key === "from") next.to = date;
      else next.from = date;
    }
    onChange({ preset: "custom", range: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarRange className="w-4 h-4 text-muted-foreground" aria-hidden />
      <select
        aria-label="Date range"
        className={selectClass}
        value={value.preset}
        onChange={(e) => setPreset(e.target.value as RangePreset)}
      >
        {RANGE_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range</option>
      </select>
      <input
        type="date"
        aria-label="From date"
        className={selectClass}
        value={value.range.from}
        max={today}
        onChange={(e) => setDate("from", e.target.value)}
      />
      <span className="text-xs text-muted-foreground">to</span>
      <input
        type="date"
        aria-label="To date"
        className={selectClass}
        value={value.range.to}
        max={today}
        onChange={(e) => setDate("to", e.target.value)}
      />
    </div>
  );
};
