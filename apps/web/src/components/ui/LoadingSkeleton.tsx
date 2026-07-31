import React from "react";
import { cn } from "@/lib/utils";

export const LoadingSkeleton: React.FC<{ className?: string }> = ({ className }) => {
  return <div className={cn("animate-pulse bg-muted/60 rounded-md", className)} />;
};
