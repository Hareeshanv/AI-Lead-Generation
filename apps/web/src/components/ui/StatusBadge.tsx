import React from "react";
import { Badge, BadgeProps } from "./Badge";

const statusVariant = (status: string): NonNullable<BadgeProps["variant"]> => {
  switch (status.toLowerCase()) {
    case "hot":
    case "active":
    case "running":
    case "verified":
    case "success":
    case "completed":
    case "closed":
    case "closed won":
      return "success";
    case "warm":
    case "qualified":
    case "pending":
      return "warning";
    case "cold":
    case "idle":
    case "paused":
    case "draft":
      return "secondary";
    case "error":
    case "bounced":
    case "closed lost":
      return "danger";
    default:
      return "indigo";
  }
};

export const StatusBadge: React.FC<{ status: string; className?: string }> = ({ status, className }) => (
  <Badge variant={statusVariant(status)} className={className}>
    {status}
  </Badge>
);
