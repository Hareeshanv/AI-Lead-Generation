import fs from "node:fs";
import { cleanupRun } from "./support/cleanup";
import { FIXTURES_FILE, loadFixtures } from "./support/fixtures";

export default async function globalTeardown() {
  if (!fs.existsSync(FIXTURES_FILE)) return;
  const { runId } = loadFixtures();
  const removed = await cleanupRun(runId);
  fs.rmSync(FIXTURES_FILE, { force: true });
  console.log(`[e2e] Removed ${removed} test user(s) for run ${runId}.`);
}
