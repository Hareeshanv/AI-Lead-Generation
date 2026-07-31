import React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  isPositive?: boolean;
  icon: React.ReactNode;
  subtitle?: string;
  className?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  isPositive = true,
  icon,
  subtitle,
  className,
}) => {
  return (
    <div className={cn("glass-panel p-5 rounded-xl flex flex-col justify-between hover:border-primary/30 transition-all group", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        <div className="p-2.5 rounded-lg bg-primary/10 text-primary group-hover:scale-110 transition-transform">
          {icon}
        </div>
      </div>
      <div className="mt-4">
        <div className="text-2xl font-bold text-foreground tracking-tight">{value}</div>
        <div className="flex items-center justify-between mt-2">
          {change && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                isPositive ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
              )}
            >
              {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {change}
            </span>
          )}
          {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
        </div>
      </div>
    </div>
  );
};
