import { describe, expect, it } from "vitest";
import { adminDb, as, errorBody, hasDb, leadInput, runId, user, waitFor } from "./support/helpers";

describe.skipIf(!hasDb())("leads API", () => {
  describe("create and validation", () => {
    it("creates a lead owned by the caller and scores it", async () => {
      const input = leadInput({ title: "Head of Growth", phone: "+91 98765 43210" });
      const res = await as("memberA").post("/api/leads", input);
      expect(res.status).toBe(201);
      const lead = res.body.data;
      expect(lead).toMatchObject({ name: input.name, email: input.email, org_id: user("memberA").orgId, owner_id: user("memberA").id });
      expect(lead.status).toBeTruthy();
      expect(typeof lead.score).toBe("number");
      expect(lead.embedding).toBeUndefined();
    });

    it("400s with field errors for an invalid email and missing name", async () => {
      const res = await as("memberA").post("/api/leads", { email: "not-an-email" });
      expect(res.status).toBe(400);
      const err = errorBody(res);
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(err.fields ?? {})).toEqual(expect.arrayContaining(["name", "email"]));
    });

    it("rejects unknown fields (no mass assignment of org_id)", async () => {
      const res = await as("memberA").post("/api/leads", { ...leadInput(), org_id: user("adminB").orgId });
      expect(res.status).toBe(400);
    });

    it("rejects an owner who is not a member of the workspace", async () => {
      const res = await as("adminA").post("/api/leads", leadInput({ ownerId: user("adminB").id }));
      expect(res.status).toBe(400);
      expect(errorBody(res).fields).toHaveProperty("ownerId");
    });

    it("rejects a malformed id with 400 and an unknown id with 404", async () => {
      expect((await as("adminA").get("/api/leads/not-a-uuid")).status).toBe(400);
      const res = await as("adminA").get("/api/leads/00000000-0000-4000-8000-000000000000");
      expect(res.status).toBe(404);
      expect(errorBody(res).code).toBe("NOT_FOUND");
    });
  });

  describe("read, update, delete", () => {
    it("round-trips CRUD with role checks on delete", async () => {
      const created = (await as("memberA").post("/api/leads", leadInput())).body.data;

      const got = await as("memberA").get(`/api/leads/${created.id}`);
      expect(got.status).toBe(200);
      expect(got.body.data.id).toBe(created.id);

      const patched = await as("memberA").patch(`/api/leads/${created.id}`, { status: "Contacted", tags: ["vip"] });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({ status: "Contacted", tags: ["vip"] });

      expect((await as("memberA").patch(`/api/leads/${created.id}`, {})).status).toBe(400);

      const denied = await as("memberA").delete(`/api/leads/${created.id}`);
      expect(denied.status).toBe(403);
      expect(errorBody(denied).code).toBe("FORBIDDEN");

      const deleted = await as("managerA").delete(`/api/leads/${created.id}`);
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ data: { id: created.id, deleted: true } });
      expect((await as("managerA").get(`/api/leads/${created.id}`)).status).toBe(404);
    });

    it("natural-language search returns the standard { data } envelope", async () => {
      expect((await as("adminA").post("/api/leads/search", { query: "" })).status).toBe(400);
      const res = await as("adminA").post("/api/leads/search", { query: "hot leads from meta" });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ filters: expect.any(Object), leads: expect.any(Array), warnings: expect.any(Array) });
      expect(res.body.leads).toBeUndefined();
    });

    it("records a status_change activity when the status changes", async () => {
      const lead = (await as("adminA").post("/api/leads", leadInput())).body.data;
      await as("adminA").patch(`/api/leads/${lead.id}`, { status: "Hot" });
      const activities = await waitFor(async () => {
        const res = await as("adminA").get(`/api/leads/${lead.id}/activities`);
        return res.body.data.some((a: any) => a.type === "status_change") ? res.body.data : null;
      });
      expect(activities.find((a: any) => a.type === "status_change")).toBeTruthy();
    });
  });

  describe("list, filters, pagination", () => {
    it("paginates with meta and filters by q, status and tags", async () => {
      const tag = `qa-${runId()}`;
      for (let i = 0; i < 3; i++) await as("adminA").post("/api/leads", leadInput({ tags: [tag], status: i === 0 ? "Hot" : "Cold" }));

      const page = await as("adminA").get("/api/leads").query({ tags: tag, pageSize: 2, page: 1 });
      expect(page.status).toBe(200);
      expect(page.body.data).toHaveLength(2);
      expect(page.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

      const hot = await as("adminA").get("/api/leads").query({ tags: tag, status: "Hot" });
      expect(hot.body.meta.total).toBe(1);

      const q = await as("adminA").get("/api/leads").query({ q: `QA Lead ${runId()}` });
      expect(q.body.meta.total).toBeGreaterThanOrEqual(3);
    });

    it("validates pagination and sort parameters", async () => {
      expect((await as("adminA").get("/api/leads").query({ pageSize: 1000 })).status).toBe(400);
      expect((await as("adminA").get("/api/leads").query({ sort: "embedding" })).status).toBe(400);
      expect((await as("adminA").get("/api/leads").query({ minScore: 101 })).status).toBe(400);
    });

    it("returns facets", async () => {
      const res = await as("adminA").get("/api/leads/facets");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeTypeOf("object");
    });
  });

  describe("bulk actions", () => {
    it("tags, sets status and deletes (delete is manager-only)", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) ids.push((await as("adminA").post("/api/leads", leadInput())).body.data.id);

      const tagged = await as("memberA").post("/api/leads/bulk", { action: "tag", leadIds: ids, tags: ["bulk"] });
      expect(tagged.body.data.affected).toBe(2);

      const status = await as("memberA").post("/api/leads/bulk", { action: "status", leadIds: ids, status: "Warm" });
      expect(status.body.data.affected).toBe(2);

      expect((await as("memberA").post("/api/leads/bulk", { action: "delete", leadIds: ids })).status).toBe(403);
      const deleted = await as("managerA").post("/api/leads/bulk", { action: "delete", leadIds: ids });
      expect(deleted.body.data.affected).toBe(2);
    });

    it("rejects an unknown action", async () => {
      const res = await as("adminA").post("/api/leads/bulk", { action: "explode", leadIds: [] });
      expect(res.status).toBe(400);
    });
  });

  describe("CSV import", () => {
    it("imports valid rows, skips invalid ones and duplicates, and sends one summary notification", async () => {
      const a = leadInput();
      const b = leadInput();
      const res = await as("adminA").post("/api/leads/import", {
        rows: [a, b, { name: "", email: "bad" }, { ...a }],
        tags: [`import-${runId()}`],
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ imported: 2, invalid: 1 });
      expect(res.body.data.duplicates).toBe(1);

      const notes = await waitFor(async () => {
        const { data } = await adminDb()
          .from("notifications")
          .select("type, title, body")
          .eq("org_id", user("adminA").orgId)
          .order("created_at", { ascending: false })
          .limit(20);
        return data?.some((n) => /import/i.test(`${n.type} ${n.title}`)) ? data : null;
      });
      const perLead = notes.filter((n) => [a.name, b.name].some((name) => `${n.title} ${n.body}`.includes(name)));
      expect(perLead).toHaveLength(0);
    });

    it("400s for an empty import", async () => {
      expect((await as("adminA").post("/api/leads/import", { rows: [] })).status).toBe(400);
    });
  });

  describe("activities and tasks", () => {
    it("logs a call (moves New to Contacted) and creates a follow-up task", async () => {
      const lead = (await as("adminA").post("/api/leads", leadInput({ status: "New" }))).body.data;
      expect(lead.status).toBe("New");

      const act = await as("adminA").post(`/api/leads/${lead.id}/activities`, { type: "call", body: "Intro call" });
      expect(act.status).toBe(201);
      expect((await as("adminA").get(`/api/leads/${lead.id}`)).body.data.status).toBe("Contacted");

      expect((await as("adminA").post(`/api/leads/${lead.id}/activities`, { type: "call" })).status).toBe(400);
      expect((await as("adminA").post(`/api/leads/${lead.id}/activities`, { type: "system", body: "x" })).status).toBe(400);

      const task = await as("adminA").post(`/api/leads/${lead.id}/tasks`, { title: "Send proposal", dueAt: new Date(Date.now() + 86400000).toISOString() });
      expect(task.status).toBe(201);
      const tasks = await as("adminA").get(`/api/leads/${lead.id}/tasks`);
      expect(tasks.body.data.map((t: any) => t.id)).toContain(task.body.data.id);

      const done = await as("adminA").patch(`/api/tasks/${task.body.data.id}`, { status: "done" });
      expect(done.status).toBe(200);
    });
  });

  describe("cross-org isolation", () => {
    it("another workspace cannot read, update, delete or list the lead", async () => {
      const lead = (await as("adminA").post("/api/leads", leadInput())).body.data;

      expect((await as("adminB").get(`/api/leads/${lead.id}`)).status).toBe(404);
      expect((await as("adminB").patch(`/api/leads/${lead.id}`, { name: "Hijacked" })).status).toBe(404);
      expect((await as("adminB").delete(`/api/leads/${lead.id}`)).status).toBe(404);
      expect((await as("adminB").get(`/api/leads/${lead.id}/activities`)).status).toBe(404);
      const bulk = await as("adminB").post("/api/leads/bulk", { action: "delete", leadIds: [lead.id] });
      expect(bulk.body.data.affected).toBe(0);

      const list = await as("adminB").get("/api/leads").query({ q: lead.name });
      expect(list.body.meta.total).toBe(0);

      expect((await as("adminA").get(`/api/leads/${lead.id}`)).body.data.name).toBe(lead.name);
    });

    it("x-org-id for a workspace you are not in is 403 NOT_A_MEMBER", async () => {
      const res = await as("adminB", { "x-org-id": user("adminA").orgId }).get("/api/leads");
      expect(res.status).toBe(403);
      expect(errorBody(res).code).toBe("NOT_A_MEMBER");
    });

    it("a malformed x-org-id is 400", async () => {
      expect((await as("adminA", { "x-org-id": "nope" }).get("/api/leads")).status).toBe(400);
    });
  });
});
