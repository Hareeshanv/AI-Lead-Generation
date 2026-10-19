import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let browserClient: SupabaseClient | null = null;

/**
 * Browser Supabase client, used ONLY for auth (session, sign-in/out, password) and realtime.
 * All table reads and writes go through the API (`@/services/api`); the browser role has no write grants.
 */
export function getSupabase(): SupabaseClient {
  if (!browserClient) {
    const { url, anonKey } = supabaseEnv();
    browserClient = createBrowserClient(url, anonKey);
  }
  return browserClient;
}
