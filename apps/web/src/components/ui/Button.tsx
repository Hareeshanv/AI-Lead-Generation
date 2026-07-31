import React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "glass";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg active:scale-[0.98]";

    const variants = {
      primary: "bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/25 border border-primary/20",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border",
      outline: "border border-border bg-transparent hover:bg-muted text-foreground",
      ghost: "hover:bg-muted text-muted-foreground hover:text-foreground",
      destructive: "bg-destructive text-white hover:bg-destructive/90 shadow-lg shadow-destructive/20",
      glass: "glass-panel text-white hover:bg-white/10 border border-white/10 shadow-md",
    };

    const sizes = {
      sm: "h-8 px-3 text-xs gap-1.5",
      md: "h-10 px-4 text-sm gap-2",
      lg: "h-12 px-6 text-base gap-2.5",
      icon: "h-10 w-10 p-0 justify-center",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
