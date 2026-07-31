import React from "react";
import { Button } from "./Button";
import { FolderOpen } from "lucide-react";

export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon = <FolderOpen className="w-12 h-12 text-muted-foreground/50" />,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl glass-panel border border-dashed border-border/80">
      <div className="p-4 rounded-full bg-primary/10 text-primary mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-6">{description}</p>
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
