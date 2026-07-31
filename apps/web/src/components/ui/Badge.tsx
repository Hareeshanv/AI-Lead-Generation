import React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "success" | "warning" | "danger" | "outline" | "indigo";
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = "default", children, ...props }) => {
  const variants = {
    default: "bg-primary/10 text-primary border-primary/20",
    secondary: "bg-muted text-muted-foreground border-border",
    success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    danger: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    outline: "bg-transparent text-foreground border-border",
    indigo: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
