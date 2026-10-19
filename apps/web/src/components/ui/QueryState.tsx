import React from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/toast";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { LoadingSkeleton } from "./LoadingSkeleton";

export const ErrorState: React.FC<{
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}> = ({ title = "Couldn't load this", error, onRetry, className }) => (
  <div
    role="alert"
    className={cn(
      "flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center",
      className
    )}
  >
    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
      <AlertTriangle className="h-5 w-5" />
    </div>
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{errorMessage(error)}</p>
    {onRetry && (
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

export const LoadingState: React.FC<{ rows?: number; className?: string }> = ({ rows = 3, className }) => (
  <div className={cn("space-y-3", className)} aria-busy="true">
    {Array.from({ length: rows }, (_, i) => (
      <LoadingSkeleton key={i} className="h-12 w-full" />
    ))}
  </div>
);

export interface QueryStateProps<T> {
  query: { data: T | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  /** Treat the data as empty (defaults to empty arrays). */
  isEmpty?: (data: T) => boolean;
  loading?: React.ReactNode;
  empty?: { title: string; description?: string; icon?: LucideIcon; action?: React.ReactNode };
  errorTitle?: string;
  children: (data: T) => React.ReactNode;
}

/** Standard loading → error (with retry) → empty → content rendering for a React Query result. */
export function QueryState<T>({ query, isEmpty, loading, empty, errorTitle, children }: QueryStateProps<T>) {
  if (query.isLoading) return <>{loading ?? <LoadingState />}</>;
  if (query.isError || query.data === undefined) {
    return <ErrorState title={errorTitle} error={query.error} onRetry={() => void query.refetch()} />;
  }
  const data = query.data;
  const emptyCheck = isEmpty ?? ((d: T) => Array.isArray(d) && d.length === 0);
  if (empty && emptyCheck(data)) return <EmptyState {...empty} />;
  return <>{children(data)}</>;
}
