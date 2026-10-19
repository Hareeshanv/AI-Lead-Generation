import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { API_PORT, REPO_ROOT, WEB_PORT, WEB_URL, serverEnv } from "./support/target";

const env = serverEnv();

export default defineConfig({
  testDir: path.join(__dirname, "specs"),
  outputDir: path.join(__dirname, ".results"),
  globalSetup: path.join(__dirname, "global-setup.ts"),
  globalTeardown: path.join(__dirname, "global-teardown.ts"),
  // Specs share the seeded workspace; keep them sequential and deterministic.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: path.join(__dirname, ".report"), open: "never" }]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: path.join(REPO_ROOT, "apps/api"),
      url: `http://localhost:${API_PORT}/api/health`,
      env,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // A production build in its own distDir, so a running `next dev` (.next) is never touched.
      command: `npx next build && npx next start -p ${WEB_PORT}`,
      cwd: path.join(REPO_ROOT, "apps/web"),
      url: `${WEB_URL}/login`,
      env,
      timeout: 420_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
