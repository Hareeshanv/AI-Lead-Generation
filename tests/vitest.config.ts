import path from "node:path";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(__dirname, "..");

export default defineConfig({
  resolve: {
    alias: {
      "@ai-lead-gen/database": path.join(repoRoot, "packages/database/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        resolve: {
          alias: {
            "@/": path.join(repoRoot, "apps/web/src") + "/",
          },
        },
        test: {
          name: "unit",
          include: ["unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "api",
          include: ["api/**/*.test.ts"],
          setupFiles: ["api/support/env.ts"],
          globalSetup: ["api/support/globalSetup.ts"],
          // Suites share seeded orgs and the in-process event bus; run them one file at a time.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
