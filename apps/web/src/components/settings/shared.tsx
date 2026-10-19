import React from "react";
import { cn } from "@/lib/utils";

export const selectClassName =
  "w-full h-10 rounded-lg bg-card/60 border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all disabled:opacity-60";

export const Field: React.FC<{
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ id, label, hint, error, className, children }) => (
  <div className={cn("space-y-1", className)}>
    <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </label>
    {children}
    {error ? (
      <p className="text-[11px] text-destructive">{error}</p>
    ) : (
      hint && <p className="text-[11px] text-muted-foreground">{hint}</p>
    )}
  </div>
);

export const SectionTitle: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; description?: string }> = ({
  icon: Icon,
  title,
  description,
}) => (
  <div>
    <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
      <Icon className="w-4 h-4 text-muted-foreground" /> {title}
    </h2>
    {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
  </div>
);

/** First message per field from an ApiError's `fields`. */
export function fieldError(err: unknown, field: string): string | undefined {
  const fields = (err as { fields?: Record<string, string[]> } | null)?.fields;
  return fields?.[field]?.[0];
}
