import { execFileSync } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";

export const REPO_ROOT = path.resolve(__dirname, "../../..");

export interface SupabaseTarget {
  url: string;
  serviceKey: string;
  anonKey: string;
  /** Where the credentials came from (for the report; never the values). */
  source: "TEST_SUPABASE_* env" | "root .env" | "local supabase (supabase status)";
  local: boolean;
}

const isLocalUrl = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(url);

function fromSupabaseStatus(): Omit<SupabaseTarget, "source" | "local"> | null {
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
      timeout: 60_000,
    });
    const env = dotenv.parse(out);
    const url = env.API_URL;
    const serviceKey = env.SERVICE_ROLE_KEY || env.SECRET_KEY;
    const anonKey = env.ANON_KEY || env.PUBLISHABLE_KEY;
    return url && serviceKey && anonKey ? { url, serviceKey, anonKey } : null;
  } catch {
    return null;
  }
}

/**
 * Picks the database the API tests run against, in order: TEST_SUPABASE_URL/_SERVICE_ROLE_KEY/_ANON_KEY,
 * the root .env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), then a running local stack (`supabase start`).
 */
export function resolveSupabaseTarget(): { target: SupabaseTarget } | { reason: string } {
  const rootEnv = dotenv.config({ path: path.join(REPO_ROOT, ".env"), processEnv: {} }).parsed ?? {};
  const pick = (k: string) => (process.env[k] || "").trim();

  const testUrl = pick("TEST_SUPABASE_URL");
  if (testUrl) {
    const serviceKey = pick("TEST_SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = pick("TEST_SUPABASE_ANON_KEY");
    if (!serviceKey || !anonKey) return { reason: "TEST_SUPABASE_URL is set but TEST_SUPABASE_SERVICE_ROLE_KEY / TEST_SUPABASE_ANON_KEY are missing." };
    return { target: { url: testUrl, serviceKey, anonKey, source: "TEST_SUPABASE_* env", local: isLocalUrl(testUrl) } };
  }

  const url = (rootEnv.SUPABASE_URL || rootEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (rootEnv.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const anonKey = (rootEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (url && serviceKey && anonKey) {
    return { target: { url, serviceKey, anonKey, source: "root .env", local: isLocalUrl(url) } };
  }

  const local = fromSupabaseStatus();
  if (local) return { target: { ...local, source: "local supabase (supabase status)", local: true } };

  return {
    reason:
      "No database for API tests: SUPABASE_SERVICE_ROLE_KEY is empty in the root .env, TEST_SUPABASE_* is not set, " +
      "and no local stack answered `npx supabase status` (start one with `npx supabase start`, requires Docker).",
  };
}
