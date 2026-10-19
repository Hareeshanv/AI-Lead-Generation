import { resolveSupabaseTarget, REPO_ROOT, type SupabaseTarget } from "../../api/support/supabaseTarget";

export { REPO_ROOT };

export const API_PORT = Number(process.env.E2E_API_PORT || 4011);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT || 3011);
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}/api`;

let cached: SupabaseTarget | null | undefined;

/** E2E drives real sign-ups through the UI, so it only runs against a local stack. */
export function e2eTarget(): SupabaseTarget {
  if (cached) return cached;
  const resolved = resolveSupabaseTarget();
  if ("reason" in resolved) throw new Error(`E2E blocked: ${resolved.reason}`);
  if (!resolved.target.local && process.env.E2E_ALLOW_REMOTE !== "1") {
    throw new Error("E2E blocked: the resolved Supabase project is not local. Start one with `npx supabase start` (or set E2E_ALLOW_REMOTE=1).");
  }
  cached = resolved.target;
  return cached;
}

const PROVIDER_ENV = [
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_WEBHOOK_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "SERPER_API_KEY",
  "SARVAM_API_KEY",
  "SLACK_WEBHOOK_URL",
  "OUTBOUND_WEBHOOK_URL",
  "OUTBOUND_WEBHOOK_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_VERIFY_TOKEN",
];

/** Env for the API and web servers started by Playwright (never the developer's provider keys). */
export function serverEnv(): Record<string, string> {
  const t = e2eTarget();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, {
    NODE_ENV: "production",
    SUPABASE_URL: t.url,
    SUPABASE_SERVICE_ROLE_KEY: t.serviceKey,
    NEXT_PUBLIC_SUPABASE_URL: t.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: t.anonKey,
    NEXT_PUBLIC_API_URL: API_URL,
    WEB_APP_URL: WEB_URL,
    API_PUBLIC_URL: `http://localhost:${API_PORT}`,
    PORT: String(API_PORT),
    NEXT_DIST_DIR: ".next-e2e",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_DEV_AUTO_LOGIN: "false",
    DEV_AUTO_LOGIN: "false",
  });
  for (const key of PROVIDER_ENV) env[key] = "";
  return env;
}
