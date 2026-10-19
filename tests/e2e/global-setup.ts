import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { e2eTarget } from "./support/target";
import { FIXTURES_FILE, PASSWORD, type E2EFixtures } from "./support/fixtures";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

/** Admin (creates workspace "QA E2E <run>") + member (joins through a pending invitation). */
export default async function globalSetup() {
  const t = e2eTarget();
  const db = createClient(t.url, t.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const org = await db.from("organizations").select("id", { count: "exact", head: true }).eq("id", DEFAULT_ORG_ID);
  const members = await db.from("org_members").select("user_id", { count: "exact", head: true }).eq("org_id", DEFAULT_ORG_ID);
  if ((org.count ?? 0) > 0 && (members.count ?? 0) === 0) {
    // The first sign-up claims an unowned Default Workspace; give it a placeholder owner on the local stack.
    const { error } = await db.auth.admin.createUser({ email: "default-workspace-owner@example.com", password: PASSWORD, email_confirm: true });
    if (error && !/already/i.test(error.message)) throw new Error(`Placeholder owner: ${error.message}`);
  }

  const runId = `e${Date.now().toString(36)}`;
  const email = (key: string) => `qa-e2e-${key}-${runId}@example.com`;

  const admin = await db.auth.admin.createUser({
    email: email("admin"),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "QA Admin", org_name: `QA E2E ${runId}` },
  });
  if (admin.error || !admin.data.user) throw new Error(`Creating the E2E admin failed: ${admin.error?.message}`);
  const { data: adminOrg } = await db.from("org_members").select("org_id").eq("user_id", admin.data.user.id).single();
  if (!adminOrg) throw new Error("The E2E admin has no workspace.");

  const invite = await db.from("invitations").insert({ org_id: adminOrg.org_id, email: email("member"), role: "member", invited_by: admin.data.user.id });
  if (invite.error) throw new Error(`Inviting the E2E member failed: ${invite.error.message}`);
  const member = await db.auth.admin.createUser({
    email: email("member"),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "QA Member" },
  });
  if (member.error || !member.data.user) throw new Error(`Creating the E2E member failed: ${member.error?.message}`);

  const fixtures: E2EFixtures = {
    runId,
    users: {
      admin: { id: admin.data.user.id, email: email("admin"), orgId: adminOrg.org_id },
      member: { id: member.data.user.id, email: email("member"), orgId: adminOrg.org_id },
    },
  };
  fs.mkdirSync(path.dirname(FIXTURES_FILE), { recursive: true });
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
}
