import React from "react";
import { cn } from "@/lib/utils";

export interface AvatarProps {
  src?: string;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ src, name, size = "md", className }) => {
  const sizes = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-14 h-14 text-lg",
  };

  const getInitials = (n: string) => {
    return n
      .split(" ")
      .map((part) => part[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  return src ? (
    <img
      src={src}
      alt={name}
      className={cn("rounded-full object-cover border border-border/80 shadow-xs", sizes[size], className)}
    />
  ) : (
    <div
      className={cn(
        "rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center border border-primary/30",
        sizes[size],
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
};
