import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

/** Prints only counts / booleans, never values. */
async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.log(JSON.stringify({ url: Boolean(url), serviceKey: Boolean(key), anonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) }));
  if (!url || !key) return;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const org = await db.from("organizations").select("id", { count: "exact", head: true }).eq("id", DEFAULT_ORG_ID);
  const members = await db.from("org_members").select("user_id", { count: "exact", head: true }).eq("org_id", DEFAULT_ORG_ID);
  const orgs = await db.from("organizations").select("id", { count: "exact", head: true });
  console.log(
    JSON.stringify({
      defaultOrgExists: (org.count ?? 0) > 0,
      defaultOrgMembers: members.count ?? null,
      totalOrgs: orgs.count ?? null,
      errors: [org.error?.message, members.error?.message, orgs.error?.message].filter(Boolean),
    })
  );
}

void main();
