import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from workspace root or package root
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { app } from "./app";
import { isDbConfigured } from "@ai-lead-gen/database";
import { scorePendingLeads } from "./services/leads/service";
import { startJobRunner, stopJobRunner } from "./jobs/runner";
import { scheduleRetention } from "./jobs/retention";
import { scheduleIntegrationHealthChecks } from "./integrations/service";
import { logger } from "./logger";

const PORT = process.env.PORT || 4000;
const SCORING_INTERVAL_MS = 60_000;

const server = app.listen(PORT, () => {
  logger.info(`AI Lead Generation API listening on http://localhost:${PORT}`, { port: PORT });
});

if (isDbConfigured) {
  startJobRunner();
  scheduleIntegrationHealthChecks();
  scheduleRetention();

  // Scores new webhook leads in the background; a run is skipped while the previous one is still going.
  let scoringInProgress = false;
  setInterval(async () => {
    if (scoringInProgress) return;
    scoringInProgress = true;
    try {
      const scored = await scorePendingLeads(50);
      if (scored > 0) logger.info("Scored new ad leads", { scored });
    } catch (err) {
      logger.error("Background lead scoring failed", { err });
    } finally {
      scoringInProgress = false;
    }
  }, SCORING_INTERVAL_MS);
}

let shuttingDown = false;

/** Stops accepting requests, lets running jobs finish (or requeues them), then exits. */
async function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down", { reason });
  // Must stay below the platform's kill timeout (commonly 30s after SIGTERM).
  setTimeout(() => process.exit(exitCode), 28_000).unref();
  const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  try {
    await stopJobRunner();
  } catch (err) {
    logger.error("Job runner did not stop cleanly", { err });
  }
  await httpClosed;
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { err: reason });
});
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception, shutting down", { err });
  void shutdown("uncaughtException", 1);
});
