import { createClient } from "@supabase/supabase-js";
import { e2eTarget } from "./target";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

/** Deletes every auth user whose email contains `runId` and the workspaces they own that are named with it. */
export async function cleanupRun(runId: string) {
  const t = e2eTarget();
  const db = createClient(t.url, t.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ids: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) break;
    for (const u of data.users) if (u.email?.includes(runId)) ids.push(u.id);
    if (data.users.length < 200) break;
  }
  if (ids.length > 0) {
    const { data: memberships } = await db.from("org_members").select("org_id").in("user_id", ids);
    const orgIds = [...new Set((memberships ?? []).map((m) => m.org_id))].filter((id) => id !== DEFAULT_ORG_ID);
    if (orgIds.length > 0) {
      const { data: orgs } = await db.from("organizations").select("id, name").in("id", orgIds);
      const ours = (orgs ?? []).filter((o) => o.name.includes(runId)).map((o) => o.id);
      if (ours.length > 0) await db.from("organizations").delete().in("id", ours);
    }
  }
  for (const id of ids) await db.auth.admin.deleteUser(id);
  return ids.length;
}
