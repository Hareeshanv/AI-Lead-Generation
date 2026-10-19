"use client";

import React from "react";
import { Input } from "@/components/ui/Input";
import { selectClassName } from "@/components/settings/shared";

export const textareaClassName =
  "w-full min-h-[72px] rounded-lg bg-card/60 border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all";

/** Field error by path ("trigger.cron", "actions.0.params.title"); client errors only after a submit attempt. */
export type ErrorLookup = (key: string) => string | undefined;

export interface SelectOption {
  value: string;
  label: string;
}

export const SectionHeading: React.FC<{ icon: React.ComponentType<{ className?: string }>; step: number; title: string; hint?: string }> = ({
  icon: Icon,
  step,
  title,
  hint,
}) => (
  <div className="flex items-start gap-3">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">{step}</div>
    <div>
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" /> {title}
      </h3>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  </div>
);

/** A select with free-text fallback via datalist, for statuses and stages. */
export const SuggestInput: React.FC<{
  id: string;
  value: string | undefined;
  options: string[];
  placeholder?: string;
  onChange: (v: string) => void;
}> = ({ id, value, options, placeholder, onChange }) => (
  <>
    <Input id={id} list={`${id}-options`} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    <datalist id={`${id}-options`}>
      {options.map((o) => (
        <option key={o} value={o} />
      ))}
    </datalist>
  </>
);

/** Select over loaded options with a "Loading…" placeholder while they load. */
export const OptionSelect: React.FC<{
  id: string;
  value: string | undefined;
  onChange: (v: string) => void;
  options: SelectOption[];
  loading?: boolean;
  placeholder: string;
}> = ({ id, value, onChange, options, loading, placeholder }) => (
  <select id={id} className={selectClassName} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
    <option value="">{loading ? "Loading…" : placeholder}</option>
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);
