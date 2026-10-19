import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Find root .env by going up directories
let currentDir = __dirname;
let envPath = "";
for (let i = 0; i < 5; i++) {
  const checkPath = path.resolve(currentDir, ".env");
  if (fs.existsSync(checkPath)) {
    envPath = checkPath;
    break;
  }
  currentDir = path.dirname(currentDir);
}

if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

// The anon role has no table grants (RLS migration 0009), so the server needs the service role key.
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const isDbConfigured = !!supabaseUrl && !!supabaseKey;

if (!isDbConfigured) {
  console.error(
    "[DB] Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the root .env. " +
      "All database calls will fail."
  );
}

// createClient throws on an empty URL, so an unroutable URL keeps the module importable
// while every query fails with a visible error.
export const dbClient: SupabaseClient = createClient(
  supabaseUrl || "http://supabase-not-configured.invalid",
  supabaseKey || "supabase-key-not-configured",
  { auth: { persistSession: false, autoRefreshToken: false } }
);
