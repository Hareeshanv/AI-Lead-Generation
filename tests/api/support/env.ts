import path from "node:path";
import dotenv from "dotenv";
import { inject } from "vitest";
import "./context";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// Keeps the workflow schedule bootstrap and other background timers off while the app is imported.
process.env.NODE_ENV = "test";
process.env.WEB_APP_URL = "http://localhost:3000";

// The API's database client reads these when it is first imported, so they must be set before any test imports the app.
const db = inject("db");
if (db.ok) {
  process.env.SUPABASE_URL = db.url;
  process.env.NEXT_PUBLIC_SUPABASE_URL = db.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = db.serviceKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = db.anonKey;
} else {
  // Never let DB-less suites talk to the linked project.
  process.env.SUPABASE_URL = "";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
}
// Integrations fall back to these env vars; tests must never reach real providers with the developer's keys.
const PROVIDER_ENV = [
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_FROM_NAME",
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
  "PLATFORM_MANAGED_PROVIDERS",
  "PLATFORM_MANAGED_ORG_IDS",
];
// Empty strings (not deletes) so the database package's dotenv load cannot repopulate them from the root .env.
for (const key of PROVIDER_ENV) process.env[key] = "";
process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = "api-test-unsubscribe-secret";
