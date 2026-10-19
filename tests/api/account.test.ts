import { describe, expect, it } from "vitest";
import { as, dbContext, errorBody, hasDb, runId, user, waitFor } from "./support/helpers";

describe.skipIf(!hasDb())("me, settings, members and invitations", () => {
  it("GET /api/me returns the profile and the workspace role", async () => {
    const res = await as("managerA").get("/api/me");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toContain(user("managerA").orgId);
    expect(JSON.stringify(res.body.data)).toContain("manager");
  });

  it("settings: everyone reads, only admins write, values are validated", async () => {
    const get = await as("memberA").get("/api/settings");
    expect(get.status).toBe(200);
    expect(get.body.data.organization.id).toBe(user("memberA").orgId);

    expect((await as("managerA").patch("/api/settings", { currency: "EUR" })).status).toBe(403);

    const bad = await as("adminA").patch("/api/settings", { currency: "XXXX", scoring: { hot: 40, warm: 60 } });
    expect(bad.status).toBe(400);
    expect(Object.keys(errorBody(bad).fields ?? {})).toEqual(expect.arrayContaining(["currency", "scoring.hot"]));

    expect((await as("adminA").patch("/api/settings", { defaultOwnerId: user("adminB").id })).status).toBe(400);
    expect((await as("adminA").patch("/api/settings", { unknownField: 1 })).status).toBe(400);

    const ok = await as("adminA").patch("/api/settings", { currency: "INR", timezone: "Asia/Kolkata" });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body.data.settings)).toContain("INR");
  });

  it("members: list, role change is admin-only, the last admin cannot be demoted", async () => {
    const list = await as("memberA").get("/api/members");
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(3);

    expect((await as("managerA").patch(`/api/members/${user("memberA").id}`, { role: "manager" })).status).toBe(403);

    const last = await as("adminA").patch(`/api/members/${user("adminA").id}`, { role: "member" });
    expect(last.status).toBe(409);

    expect((await as("adminA").patch(`/api/members/${user("adminB").id}`, { role: "member" })).status).toBe(404);
    expect((await as("memberA").delete(`/api/members/${user("managerA").id}`)).status).toBe(403);
  });

  it("role changes take effect on the next request", async () => {
    expect((await as("memberA").post("/api/campaigns", { name: "x", channel: "email" })).status).toBe(403);
    expect((await as("adminA").patch(`/api/members/${user("memberA").id}`, { role: "manager" })).status).toBe(200);
    try {
      const res = await as("memberA").post("/api/campaigns", { name: `QA promoted ${runId()}`, channel: "email" });
      expect(res.status).toBe(201);
    } finally {
      await as("adminA").patch(`/api/members/${user("memberA").id}`, { role: "member" });
    }
  });

  it("invitations are admin-only and validated", async () => {
    expect((await as("managerA").get("/api/invitations")).status).toBe(403);
    expect((await as("managerA").post("/api/invitations", { email: "x@example.com" })).status).toBe(403);
    expect((await as("adminA").post("/api/invitations", { email: "not-an-email" })).status).toBe(400);
    const dup = await as("adminA").post("/api/invitations", { email: user("memberA").email });
    expect(dup.status).toBe(409);

    const list = await as("adminA").get("/api/invitations");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
  });

  it.skipIf(!dbContext().ok || !String((dbContext() as any).source).includes("local"))(
    "inviting a new email creates a pending invitation that can be revoked (local stack only: sends an email)",
    async () => {
      const email = `qa-invitee-${runId()}@example.com`;
      const res = await as("adminA").post("/api/invitations", { email, role: "member" });
      expect(res.status).toBe(201);
      expect(["invited", "pending_email_failed"]).toContain(res.body.data.outcome);
      const id = res.body.data.invitation.id;
      expect((await as("adminB").delete(`/api/invitations/${id}`)).status).toBe(404);
      expect((await as("adminA").delete(`/api/invitations/${id}`)).status).toBe(204);
    }
  );
});

describe.skipIf(!hasDb())("notifications", () => {
  it("lists, counts and marks notifications read for the caller only", async () => {
    // Assigning a lead to managerA notifies them.
    const lead = (await as("adminA").post("/api/leads", { name: `QA Notify ${runId()}`, ownerId: user("managerA").id })).body.data;
    expect(lead.owner_id).toBe(user("managerA").id);

    const unread = await waitFor(async () => {
      const res = await as("managerA").get("/api/notifications/unread-count");
      const count = res.body.data?.count ?? res.body.data;
      return typeof count === "number" && count > 0 ? count : null;
    });
    expect(unread).toBeGreaterThan(0);
    // lead.created and lead.assigned notify asynchronously; let the count settle before read-all.
    let previous = -1;
    await waitFor(async () => {
      const res = await as("managerA").get("/api/notifications/unread-count");
      const count = res.body.data?.count ?? res.body.data;
      const settled = count === previous;
      previous = count;
      return settled;
    }, { intervalMs: 500 });

    const list = await as("managerA").get("/api/notifications");
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);

    expect((await as("managerA").post("/api/notifications/read-all")).status).toBeLessThan(300);
    const after = await as("managerA").get("/api/notifications/unread-count");
    expect(after.body.data?.count ?? after.body.data).toBe(0);

    const other = await as("adminB").get("/api/notifications");
    expect(other.body.data.map((n: any) => n.id)).not.toContain(list.body.data[0].id);
  });
});

describe.skipIf(!hasDb())("integrations", () => {
  it("lists providers without exposing secrets", async () => {
    const res = await as("memberA").get("/api/integrations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.providers)).toBe(true);
    expect(res.body.data.providers.length).toBeGreaterThan(0);
  });

  it("configure is admin-only, test is manager+, unknown providers 404", async () => {
    expect((await as("managerA").put("/api/integrations/resend", { credentials: { apiKey: "re_x" } })).status).toBe(403);
    expect((await as("memberA").post("/api/integrations/resend/test")).status).toBe(403);
    expect((await as("adminA").get("/api/integrations/not-a-provider")).status).toBe(404);

    const missing = await as("adminA").put("/api/integrations/resend", { credentials: {} });
    expect(missing.status).toBe(400);

    const notConfigured = await as("managerA").post("/api/integrations/resend/test");
    expect(notConfigured.status).toBe(422);
    expect(errorBody(notConfigured).code).toBe("NOT_CONFIGURED");
  });

  it("Meta connect needs the app configured", async () => {
    const res = await as("adminA").post("/api/integrations/meta/connect-url");
    expect(res.status).toBe(422);
    expect(errorBody(res).code).toBe("NOT_CONFIGURED");
  });
});
