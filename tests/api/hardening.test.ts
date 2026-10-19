import request from "supertest";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runJobsOnce } from "../../apps/api/src/jobs/runner";
import { adminDb, app, as, dbContext, errorBody, hasDb, leadInput, runId, user, waitFor } from "./support/helpers";

describe.skipIf(!hasDb())("outbound URL validation (SSRF)", () => {
  it("rejects private, loopback, metadata and non-https webhook URLs when saving an integration", async () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://10.0.0.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::ffff:127.0.0.1]/hook",
      "https://localhost/hook",
      "https://metadata.google.internal/x",
    ]) {
      const res = await as("adminA").put("/api/integrations/webhook", { credentials: { url } });
      expect(res.status, url).toBe(400);
      expect(errorBody(res).fields, url).toHaveProperty(["credentials.url"]);
    }
    expect((await as("adminA").put("/api/integrations/webhook", { credentials: { url: "http://example.com/hook" } })).status).toBe(400);
  });

  it("only accepts hooks.slack.com for Slack", async () => {
    for (const webhookUrl of ["https://hooks.slack.com.evil.example/services/T/B/x", "https://127.0.0.1/services/T/B/x"]) {
      const res = await as("adminA").put("/api/integrations/slack", { credentials: { webhookUrl } });
      expect(res.status, webhookUrl).toBe(400);
    }
  });

  it("rejects private webhook action URLs when saving a workflow", async () => {
    const create = await as("managerA").post("/api/workflows", {
      name: `QA ssrf ${runId()}`,
      trigger: { type: "lead.created" },
      actions: [{ type: "webhook", params: { url: "https://192.168.1.10/hook" } }],
    });
    expect(create.status).toBe(400);
    expect(errorBody(create).fields).toHaveProperty(["actions.0.params.url"]);

    const wf = (
      await as("managerA").post("/api/workflows", {
        name: `QA ssrf patch ${runId()}`,
        trigger: { type: "lead.created" },
        actions: [{ type: "add_tag", params: { tag: "x" } }],
      })
    ).body.data;
    const patch = await as("managerA").patch(`/api/workflows/${wf.id}`, {
      actions: [{ type: "add_tag", params: { tag: "x" } }, { type: "webhook", params: { url: "https://[::1]/hook" } }],
    });
    expect(patch.status).toBe(400);
    expect(errorBody(patch).fields).toHaveProperty(["actions.1.params.url"]);
  });

  it("re-checks the webhook URL at send time (a stored unsafe URL fails the step)", async () => {
    const wf = (
      await as("managerA").post("/api/workflows", {
        name: `QA ssrf send ${runId()}`,
        trigger: { type: "lead.created" },
        actions: [{ type: "add_tag", params: { tag: "x" } }],
      })
    ).body.data;
    // Bypass save-time validation to simulate a row written before the check existed.
    const { error } = await adminDb()
      .from("workflows")
      .update({ actions: [{ type: "webhook", params: { url: "https://127.0.0.1/hook" } }] })
      .eq("id", wf.id);
    expect(error).toBeNull();

    const lead = (await as("adminA").post("/api/leads", leadInput())).body.data;
    const run = await as("managerA").post(`/api/workflows/${wf.id}/test`, { leadId: lead.id });
    expect(run.status).toBe(200);
    const detail = (await as("managerA").get(`/api/workflows/runs/${run.body.data.id}`)).body.data;
    expect(detail.steps[0]).toMatchObject({ actionType: "webhook", status: "failed" });
    expect(JSON.stringify(detail.steps[0])).toMatch(/Webhook URL rejected/);
  });
});

describe.skipIf(!hasDb())("lead-webhook bridge (lead.ingested)", () => {
  const jobsFor = async (leadId: string) => {
    const { data, error } = await adminDb().from("jobs").select("id, type, status, dedupe_key").eq("dedupe_key", `lead.ingested:${leadId}`);
    if (error) throw error;
    return data ?? [];
  };

  it("an edge-function style insert queues one job; the handler scores the lead and fires lead.created", async () => {
    const tag = `wf-ingest-${runId()}`;
    const source = `QA Meta ${runId()}`;
    const wf = (
      await as("managerA").post("/api/workflows", {
        name: `QA ingest tagger ${runId()}`,
        enabled: true,
        trigger: { type: "lead.created", source },
        actions: [{ type: "add_tag", params: { tag } }],
      })
    ).body.data;

    const externalId = `qa-ext-${runId()}-${Math.random().toString(36).slice(2, 8)}`;
    const row = {
      ...leadInput({ source }),
      org_id: user("adminA").orgId,
      source_platform: "meta",
      external_lead_id: externalId,
    };
    const inserted = await adminDb().from("leads").insert(row).select("id, scored_at").single();
    expect(inserted.error).toBeNull();
    const leadId = inserted.data!.id as string;
    expect(inserted.data!.scored_at).toBeNull();

    const queued = await jobsFor(leadId);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ type: "lead.ingested", status: "queued" });

    // A webhook retry (upsert ignoring duplicates) must not queue a second job.
    const retry = await adminDb()
      .from("leads")
      .upsert(row, { onConflict: "source_platform,external_lead_id", ignoreDuplicates: true });
    expect(retry.error).toBeNull();
    expect(await jobsFor(leadId)).toHaveLength(1);

    await waitFor(async () => {
      await runJobsOnce();
      const jobs = await jobsFor(leadId);
      return jobs[0]?.status === "succeeded";
    });

    const lead = (await as("adminA").get(`/api/leads/${leadId}`)).body.data;
    expect(lead.scoredAt ?? lead.scored_at).toBeTruthy();

    const runs = await waitFor(async () => {
      const res = await as("managerA").get(`/api/workflows/${wf.id}/runs`);
      return res.body.data.some((r: { status: string }) => r.status === "succeeded") ? res.body.data : null;
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ leadId, status: "succeeded" });
    expect((await as("adminA").get(`/api/leads/${leadId}`)).body.data.tags).toContain(tag);

    // Running the queue again does not re-fire.
    await runJobsOnce();
    expect((await as("managerA").get(`/api/workflows/${wf.id}/runs`)).body.data).toHaveLength(1);
  });

  it("API-created leads do not queue a lead.ingested job", async () => {
    const lead = (await as("adminA").post("/api/leads", leadInput())).body.data;
    expect(await jobsFor(lead.id)).toHaveLength(0);
  });
});

describe.skipIf(!hasDb())("pending invitations", () => {
  it("invited users stay pending until their first /api/me call, cannot own records, and can be resent/revoked", async () => {
    const ctx = dbContext();
    if (!ctx.ok) throw new Error(ctx.reason);
    const orgId = user("adminA").orgId;
    const email = `qa-pending-${runId()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
    const password = `Qa-${Math.random().toString(36).slice(2)}-Pw1!`;

    const invitation = await adminDb()
      .from("invitations")
      .insert({ org_id: orgId, email, role: "member", invited_by: user("adminA").id })
      .select("id")
      .single();
    expect(invitation.error).toBeNull();

    // What inviteUserByEmail does: create the auth user with invited_org_id metadata.
    const created = await adminDb().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { invited_org_id: orgId },
    });
    expect(created.error).toBeNull();
    const inviteeId = created.data.user!.id;

    try {
      const members = (await as("adminA").get("/api/members")).body.data as Array<{ userId: string; status: string }>;
      expect(members.find((m) => m.userId === inviteeId)).toMatchObject({ status: "pending" });
      const invitations = (await as("adminA").get("/api/invitations")).body.data as Array<{ id: string }>;
      expect(invitations.map((i) => i.id)).not.toContain(invitation.data!.id);

      const owned = await as("adminA").post("/api/leads", leadInput({ ownerId: inviteeId }));
      expect(owned.status).toBe(400);
      expect(errorBody(owned).fields).toHaveProperty("ownerId");

      expect((await as("memberA").post(`/api/members/${inviteeId}/resend-invite`)).status).toBe(403);
      const resend = await as("adminA").post(`/api/members/${inviteeId}/resend-invite`);
      expect(resend.status).toBe(200);
      expect(["invited", "pending_email_failed"]).toContain(resend.body.data.outcome);
      expect((await as("adminA").post(`/api/members/${user("memberA").id}/resend-invite`)).status).toBe(409);

      const reinvite = await as("adminA").post("/api/invitations", { email });
      expect(reinvite.status).toBe(409);

      const anon = createClient(ctx.url, ctx.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await anon.auth.signInWithPassword({ email, password });
      expect(signedIn.error).toBeNull();
      const token = signedIn.data.session!.access_token;

      // Pending: no workspace access yet.
      const leadsBefore = await request(app).get("/api/leads").set("Authorization", `Bearer ${token}`);
      expect(leadsBefore.status).toBe(403);

      const me = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
      expect(me.status).toBe(200);
      expect(JSON.stringify(me.body.data)).toContain(orgId);

      const after = (await as("adminA").get("/api/members")).body.data as Array<{ userId: string; status: string }>;
      expect(after.find((m) => m.userId === inviteeId)).toMatchObject({ status: "active" });
      const inv = await adminDb().from("invitations").select("status").eq("id", invitation.data!.id).single();
      expect(inv.data?.status).toBe("accepted");

      const leadsAfter = await request(app).get("/api/leads").set("Authorization", `Bearer ${token}`);
      expect(leadsAfter.status).toBe(200);
    } finally {
      await adminDb().auth.admin.deleteUser(inviteeId);
    }
  });

  it("revoking a pending member removes them and revokes the invitation", async () => {
    const orgId = user("adminA").orgId;
    const email = `qa-revoke-${runId()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
    const invitation = await adminDb()
      .from("invitations")
      .insert({ org_id: orgId, email, role: "member", invited_by: user("adminA").id })
      .select("id")
      .single();
    expect(invitation.error).toBeNull();
    const created = await adminDb().auth.admin.createUser({
      email,
      password: `Qa-${Math.random().toString(36).slice(2)}-Pw1!`,
      email_confirm: true,
      user_metadata: { invited_org_id: orgId },
    });
    expect(created.error).toBeNull();
    const inviteeId = created.data.user!.id;

    try {
      expect((await as("managerA").delete(`/api/members/${inviteeId}`)).status).toBe(403);
      expect((await as("adminA").delete(`/api/members/${inviteeId}`)).status).toBe(204);
      const members = (await as("adminA").get("/api/members")).body.data as Array<{ userId: string }>;
      expect(members.map((m) => m.userId)).not.toContain(inviteeId);
      const inv = await adminDb().from("invitations").select("status").eq("id", invitation.data!.id).single();
      expect(inv.data?.status).toBe("revoked");
    } finally {
      await adminDb().auth.admin.deleteUser(inviteeId);
    }
  });
});
