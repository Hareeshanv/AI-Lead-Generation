import type { TestProject } from "vitest/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabaseTarget, type SupabaseTarget } from "./supabaseTarget";
import type { DbContext, TestUser, TestUserKey } from "./context";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "Qa-Test-Password-123!";

function adminClient(t: SupabaseTarget): SupabaseClient {
  return createClient(t.url, t.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(t: SupabaseTarget, email: string): Promise<string> {
  const client = createClient(t.url, t.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`Sign-in failed for a test user: ${error?.message}`);
  return data.session.access_token;
}

async function orgOf(db: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await db.from("org_members").select("org_id").eq("user_id", userId);
  if (error) throw new Error(`Reading memberships failed: ${error.message}`);
  if (!data || data.length !== 1) throw new Error(`Expected exactly one membership for a new test user, got ${data?.length ?? 0}.`);
  return data[0].org_id;
}

/**
 * Creates isolated test workspaces (never touches existing data):
 *   org A: adminA (signup trigger creates the org), managerA + memberA (joined via pending invitations)
 *   org B: adminB — cross-org isolation
 *   org C: adminC — analytics fixtures in an otherwise empty workspace
 */
export default async function setup(project: TestProject) {
  const resolved = resolveSupabaseTarget();
  if ("reason" in resolved) {
    project.provide("db", { ok: false, reason: resolved.reason } satisfies DbContext);
    console.warn(`\n[api tests] BLOCKED: ${resolved.reason}\n`);
    return;
  }
  const t = resolved.target;
  const db = adminClient(t);

  // The first signup claims an unowned Default Workspace (migration 0008); never let a test user do that.
  const members = await db.from("org_members").select("user_id", { count: "exact", head: true }).eq("org_id", DEFAULT_ORG_ID);
  const org = await db.from("organizations").select("id", { count: "exact", head: true }).eq("id", DEFAULT_ORG_ID);
  if (members.error || org.error) {
    const reason = `Cannot read the target database (${t.source}): ${members.error?.message || org.error?.message}`;
    project.provide("db", { ok: false, reason } satisfies DbContext);
    console.warn(`\n[api tests] BLOCKED: ${reason}\n`);
    return;
  }
  if ((org.count ?? 0) > 0 && (members.count ?? 0) === 0) {
    if (!t.local) {
      const reason = "The Default Workspace has no owner yet; creating a test user would claim it. Sign up the real owner first.";
      project.provide("db", { ok: false, reason } satisfies DbContext);
      console.warn(`\n[api tests] BLOCKED: ${reason}\n`);
      return;
    }
    // Local throwaway stack: give the empty Default Workspace a placeholder owner so test signups get their own orgs.
    const { data, error } = await db.auth.admin.createUser({
      email: "default-workspace-owner@example.com",
      password: PASSWORD,
      email_confirm: true,
    });
    if (error && !/already/i.test(error.message)) throw new Error(`Creating the local placeholder owner failed: ${error.message}`);
    void data;
  }

  const runId = `t${Date.now().toString(36)}`;
  const email = (key: string) => `qa-${key.toLowerCase()}-${runId}@example.com`;
  const created: string[] = [];

  const createUser = async (key: TestUserKey, orgName?: string): Promise<TestUser> => {
    const { data, error } = await db.auth.admin.createUser({
      email: email(key),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `QA ${key}`, ...(orgName ? { org_name: orgName } : {}) },
    });
    if (error || !data.user) throw new Error(`Creating test user ${key} failed: ${error?.message}`);
    created.push(data.user.id);
    return { id: data.user.id, email: email(key), token: "", orgId: "" };
  };

  const users = {} as Record<TestUserKey, TestUser>;
  try {
    users.adminA = await createUser("adminA", `QA Org A ${runId}`);
    const orgA = await orgOf(db, users.adminA.id);
    users.adminA.orgId = orgA;

    for (const [key, role] of [
      ["managerA", "manager"],
      ["memberA", "member"],
    ] as const) {
      const { error } = await db.from("invitations").insert({ org_id: orgA, email: email(key), role, invited_by: users.adminA.id });
      if (error) throw new Error(`Inviting ${key} failed: ${error.message}`);
      users[key] = await createUser(key);
      users[key].orgId = await orgOf(db, users[key].id);
      if (users[key].orgId !== orgA) throw new Error(`${key} did not join org A through the invitation.`);
    }

    users.adminB = await createUser("adminB", `QA Org B ${runId}`);
    users.adminB.orgId = await orgOf(db, users.adminB.id);
    users.adminC = await createUser("adminC", `QA Org C ${runId}`);
    users.adminC.orgId = await orgOf(db, users.adminC.id);

    for (const key of Object.keys(users) as TestUserKey[]) users[key].token = await signIn(t, users[key].email);
  } catch (err) {
    await cleanup(db, runId, created);
    throw err;
  }

  project.provide("db", {
    ok: true,
    url: t.url,
    serviceKey: t.serviceKey,
    anonKey: t.anonKey,
    source: t.source,
    runId,
    users,
  } satisfies DbContext);
  console.log(`\n[api tests] Using ${t.source}; fixtures run id ${runId}.\n`);

  return async () => {
    await cleanup(db, runId, created);
  };
}

/** Deletes the test workspaces (cascades to their rows) and every auth user tagged with this run id. */
async function cleanup(db: SupabaseClient, runId: string, created: string[]) {
  const ids = new Set(created);
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) break;
    for (const u of data.users) if (u.email?.includes(runId)) ids.add(u.id);
    if (data.users.length < 200) break;
  }
  if (ids.size > 0) {
    const { data: memberships } = await db.from("org_members").select("org_id").in("user_id", [...ids]);
    const orgIds = [...new Set((memberships ?? []).map((m) => m.org_id))].filter((id) => id !== DEFAULT_ORG_ID);
    const { data: orgs } = orgIds.length
      ? await db.from("organizations").select("id, name").in("id", orgIds)
      : { data: [] as { id: string; name: string }[] };
    // Only workspaces this run created (named with the run id) are deleted.
    const ours = (orgs ?? []).filter((o) => o.name.includes(runId)).map((o) => o.id);
    if (ours.length > 0) {
      const { error } = await db.from("organizations").delete().in("id", ours);
      if (error) console.error(`[api tests] Deleting test workspaces failed: ${error.message}`);
    }
  }
  for (const id of ids) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) console.error(`[api tests] Deleting a test user failed: ${error.message}`);
  }
}
