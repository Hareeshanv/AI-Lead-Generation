import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from workspace root or package root
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { app } from "./app";
import { isDbConfigured } from "@ai-lead-gen/database";
import { scorePendingAdLeads } from "../../../agents/scoring/intent";
import { startJobRunner, stopJobRunner } from "./jobs/runner";
import { scheduleIntegrationHealthChecks } from "./integrations/service";

const PORT = process.env.PORT || 4000;
const SCORING_INTERVAL_MS = 60_000;

const server = app.listen(PORT, () => {
  console.log(`AI Lead Generation API listening on http://localhost:${PORT}`);
});

if (isDbConfigured) {
  startJobRunner();
  scheduleIntegrationHealthChecks();

  // Scores new webhook leads in the background; a run is skipped while the previous one is still going.
  let scoringInProgress = false;
  setInterval(async () => {
    if (scoringInProgress) return;
    scoringInProgress = true;
    try {
      const scored = await scorePendingAdLeads(50);
      if (scored > 0) console.log(`[Scoring] Scored ${scored} new ad lead(s).`);
    } catch (err: any) {
      console.error(`[Scoring] Background lead scoring failed: ${err?.message || err}`);
    } finally {
      scoringInProgress = false;
    }
  }, SCORING_INTERVAL_MS);
}

function shutdown(signal: string) {
  console.log(`[API] ${signal} received, shutting down.`);
  stopJobRunner();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
