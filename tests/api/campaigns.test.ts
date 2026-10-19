import { describe, expect, it } from "vitest";
import { as, errorBody, hasDb, leadInput, runId } from "./support/helpers";

const emailStep = { delayMinutes: 0, subject: "Hello {{first_name}}", body: "Quick question about {{company}}" };

describe.skipIf(!hasDb())("campaigns API", () => {
  it("only managers can create campaigns", async () => {
    const res = await as("memberA").post("/api/campaigns", { name: "Nope", channel: "email" });
    expect(res.status).toBe(403);
    expect(errorBody(res).code).toBe("FORBIDDEN");
  });

  it("validates steps per channel", async () => {
    const email = await as("managerA").post("/api/campaigns", { name: "Bad email", channel: "email", steps: [{ delayMinutes: 0 }] });
    expect(email.status).toBe(400);
    expect(Object.keys(errorBody(email).fields ?? {})).toEqual(expect.arrayContaining(["steps.0.subject", "steps.0.body"]));

    const wa = await as("managerA").post("/api/campaigns", { name: "Bad wa", channel: "whatsapp", steps: [{ delayMinutes: 0, body: "hi" }] });
    expect(wa.status).toBe(400);
    expect(errorBody(wa).fields).toHaveProperty(["steps.0.whatsappTemplate"]);

    const past = await as("managerA").post("/api/campaigns", { name: "Past", channel: "email", scheduledAt: "2020-01-01T00:00:00Z" });
    expect(past.status).toBe(400);
  });

  it("CRUD: create with steps, read detail, rename, replace steps, list, delete", async () => {
    const created = await as("managerA").post("/api/campaigns", { name: `QA Campaign ${runId()}`, channel: "email", steps: [emailStep] });
    expect(created.status).toBe(201);
    const c = created.body.data;
    expect(c).toMatchObject({ status: "draft", channel: "email", stepsCount: 1, channelReady: false });
    expect(c.channelError).toMatch(/not configured/i);

    expect((await as("memberA").get(`/api/campaigns/${c.id}`)).body.data.steps).toHaveLength(1);

    const renamed = await as("managerA").patch(`/api/campaigns/${c.id}`, { name: `QA Renamed ${runId()}` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toContain("QA Renamed");

    const steps = await as("managerA").put(`/api/campaigns/${c.id}/steps`, { steps: [emailStep, { ...emailStep, delayMinutes: 1440 }] });
    expect(steps.status).toBe(200);
    expect((await as("managerA").get(`/api/campaigns/${c.id}/steps`)).body.data).toHaveLength(2);

    const list = await as("memberA").get("/api/campaigns").query({ q: runId(), status: "draft" });
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(list.body.data.map((x: any) => x.id)).toContain(c.id);

    expect((await as("adminB").get(`/api/campaigns/${c.id}`)).status).toBe(404);
    expect((await as("memberA").delete(`/api/campaigns/${c.id}`)).status).toBe(403);
    expect((await as("managerA").delete(`/api/campaigns/${c.id}`)).status).toBeLessThan(300);
    expect((await as("managerA").get(`/api/campaigns/${c.id}`)).status).toBe(404);
  });

  it("launch is blocked with NOT_CONFIGURED when the email channel has no provider", async () => {
    const lead = (await as("adminA").post("/api/leads", leadInput({ consentChannel: ["email"] }))).body.data;
    const c = (await as("managerA").post("/api/campaigns", { name: `QA Launch ${runId()}`, channel: "email", steps: [emailStep] })).body.data;
    expect((await as("managerA").post(`/api/campaigns/${c.id}/leads`, { leadIds: [lead.id] })).status).toBeLessThan(300);

    expect((await as("memberA").post(`/api/campaigns/${c.id}/launch`)).status).toBe(403);

    const res = await as("managerA").post(`/api/campaigns/${c.id}/launch`);
    expect(res.status).toBe(422);
    expect(errorBody(res).code).toBe("NOT_CONFIGURED");
    expect((await as("managerA").get(`/api/campaigns/${c.id}`)).body.data.status).toBe("draft");
  });

  it("launch without steps is a 400", async () => {
    const c = (await as("managerA").post("/api/campaigns", { name: `QA Empty ${runId()}`, channel: "whatsapp" })).body.data;
    const res = await as("managerA").post(`/api/campaigns/${c.id}/launch`);
    expect(res.status).toBe(400);
    expect(errorBody(res).message).toMatch(/step/i);
  });

  it("previews an audience with a filter", async () => {
    const tag = `aud-${runId()}`;
    await as("adminA").post("/api/leads", leadInput({ tags: [tag] }));
    await as("adminA").post("/api/leads", leadInput({ tags: [tag], email: null }));
    const res = await as("memberA").post("/api/campaigns/audience/preview", { channel: "email", audienceFilter: { type: "filter", tags: [tag] } });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeTypeOf("object");
    expect(JSON.stringify(res.body.data)).toMatch(/\d/);

    const bad = await as("memberA").post("/api/campaigns/audience/preview", { channel: "email", audienceFilter: { minScore: 90, maxScore: 10 } });
    expect(bad.status).toBe(400);
  });

  it("adding another workspace's lead does not attach it", async () => {
    const foreign = (await as("adminB").post("/api/leads", leadInput())).body.data;
    const c = (await as("managerA").post("/api/campaigns", { name: `QA Iso ${runId()}`, channel: "email" })).body.data;
    const res = await as("managerA").post(`/api/campaigns/${c.id}/leads`, { leadIds: [foreign.id] });
    if (res.status < 300) {
      const recipients = (await as("managerA").get(`/api/campaigns/${c.id}/recipients`)).body.data;
      expect(recipients.map((r: any) => r.leadId ?? r.lead_id)).not.toContain(foreign.id);
    } else {
      expect([400, 404]).toContain(res.status);
    }
  });
});
