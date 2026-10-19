import React from "react";
import { cn } from "@/lib/utils";

export const LoadingSkeleton: React.FC<{ className?: string }> = ({ className }) => {
  return <div className={cn("animate-pulse bg-muted/60 rounded-md", className)} />;
};

export const Spinner: React.FC<{ className?: string; label?: string }> = ({ className, label }) => {
  return (
    <div role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <span
        className={cn("inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
      />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
};
