import { Router } from "express";
import { dbClient } from "@ai-lead-gen/database";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let dbStatus = "connected";
  try {
    const { error } = await dbClient.from("leads").select("id").limit(1);
    if (error) {
      dbStatus = `error: ${error.message}`;
    }
  } catch (err: any) {
    dbStatus = `exception: ${err.message}`;
  }

  res.json({
    status: "online",
    timestamp: new Date().toISOString(),
    service: "AI Lead Generation API Engine",
    version: "0.1.0",
    database: dbStatus,
    activeAgents: 14,
  });
});
