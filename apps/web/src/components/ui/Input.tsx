import React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, icon, ...props }, ref) => {
  return (
    <div className="relative flex items-center w-full">
      {icon && <div className="absolute left-3 text-muted-foreground pointer-events-none">{icon}</div>}
      <input
        ref={ref}
        className={cn(
          "w-full h-10 rounded-lg bg-card/60 border border-border px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all",
          icon && "pl-9",
          className
        )}
        {...props}
      />
    </div>
  );
});
Input.displayName = "Input";
