import React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
}

export const Card: React.FC<CardProps> = ({ className, glass = false, children, ...props }) => {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 p-5 transition-all shadow-sm",
        glass ? "glass-panel" : "bg-card text-card-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
