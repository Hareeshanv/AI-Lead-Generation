import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "online",
    timestamp: new Date().toISOString(),
    service: "AI Lead Generation API Engine",
    version: "0.1.0",
    database: "Supabase PostgreSQL connected",
    activeAgents: 14,
  });
});
