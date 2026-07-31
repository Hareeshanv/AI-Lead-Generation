import React from "react";
import { Badge } from "./Badge";

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  switch (status.toLowerCase()) {
    case "hot":
    case "active":
    case "running":
    case "verified":
    case "success":
      return <Badge variant="success">🔥 {status}</Badge>;
    case "warm":
    case "qualified":
    case "pending":
      return <Badge variant="warning">⚡ {status}</Badge>;
    case "cold":
    case "idle":
    case "paused":
    case "draft":
      return <Badge variant="secondary">❄️ {status}</Badge>;
    case "error":
    case "bounced":
    case "closed lost":
      return <Badge variant="danger">❌ {status}</Badge>;
    default:
      return <Badge variant="indigo">{status}</Badge>;
  }
};
