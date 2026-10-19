import React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive" | "glass";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const baseStyles =
  "inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg active:scale-[0.98]";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25 border border-primary/20",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border",
  outline: "border border-border bg-transparent hover:bg-muted text-foreground",
  ghost: "hover:bg-muted text-muted-foreground hover:text-foreground",
  destructive: "bg-destructive text-white hover:bg-destructive/90 shadow-lg shadow-destructive/20",
  glass: "glass-panel text-foreground hover:bg-muted/60 border border-border shadow-sm",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2.5",
  icon: "h-10 w-10 p-0 justify-center",
};

/** Button styling for elements that must not be a <button>, e.g. a next/link (a button inside a link is invalid). */
export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(baseStyles, variants[variant], sizes[size], className);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => (
    <button ref={ref} className={buttonClassName({ variant, size, className })} disabled={disabled || isLoading} {...props}>
      {isLoading ? <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
      {children}
    </button>
  )
);
Button.displayName = "Button";
