import { dbClient, isDbConfigured } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { registeredJobTypes } from "../jobs/registry";

/** Mounted at /api/health without auth; never returns data or secrets. */
export const healthRouter = createRouter();

healthRouter.get("/", async (_req, res) => {
  let database = "connected";
  if (!isDbConfigured) {
    database = "not_configured";
  } else {
    try {
      const { error } = await dbClient.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
      if (error) database = "error";
    } catch {
      database = "error";
    }
  }

  res.status(database === "connected" ? 200 : 503).json({
    status: database === "connected" ? "online" : "degraded",
    timestamp: new Date().toISOString(),
    service: "AI Lead Generation API",
    version: "0.1.0",
    database,
    jobHandlers: registeredJobTypes(),
  });
});
