import { describe, expect, it } from "vitest";
import { as, errorBody, hasDb, leadInput } from "./support/helpers";

describe.skipIf(!hasDb())("deals / CRM API", () => {
  it("creates a deal from a lead with defaults from the lead", async () => {
    const lead = (await as("adminA").post("/api/leads", leadInput())).body.data;
    const res = await as("memberA").post("/api/deals", { title: "Annual plan", leadId: lead.id, value: 50000 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: "Annual plan", lead_id: lead.id, stage: "New", company: lead.company, contact: lead.name });
    expect(Number(res.body.data.value)).toBe(50000);
  });

  it("validates input", async () => {
    const res = await as("adminA").post("/api/deals", { title: "", value: -5, stage: "Won-ish" });
    expect(res.status).toBe(400);
    expect(Object.keys(errorBody(res).fields ?? {})).toEqual(expect.arrayContaining(["title", "value", "stage"]));
    const bad = await as("adminA").post("/api/deals", { title: "x", leadId: "00000000-0000-4000-8000-000000000000" });
    expect(bad.status).toBe(400);
  });

  it("moving a deal writes a stage_change activity and syncs the lead status", async () => {
    const lead = (await as("adminA").post("/api/leads", leadInput())).body.data;
    const deal = (await as("adminA").post("/api/deals", { title: "Pipeline move", leadId: lead.id })).body.data;

    const moved = await as("memberA").patch(`/api/deals/${deal.id}/stage`, { stage: "Proposal", position: 0 });
    expect(moved.status).toBe(200);
    expect(moved.body.data.stage).toBe("Proposal");

    const leadAfter = (await as("adminA").get(`/api/leads/${lead.id}`)).body.data;
    expect(leadAfter.status).toBe("Qualified");
    expect(leadAfter.stage).toBe("Proposal");

    const acts = (await as("adminA").get(`/api/deals/${deal.id}/activities`)).body.data;
    expect(acts.some((a: any) => a.type === "stage_change" && a.metadata?.to === "Proposal")).toBe(true);

    const won = await as("adminA").patch(`/api/deals/${deal.id}/stage`, { stage: "Closed Won" });
    expect(won.body.data.closed_at).toBeTruthy();
    expect((await as("adminA").get(`/api/leads/${lead.id}`)).body.data.status).toBe("Closed");

    expect((await as("adminA").patch(`/api/deals/${deal.id}/stage`, { stage: "Bogus" })).status).toBe(400);
  });

  it("lists the board and filters by stage", async () => {
    const deal = (await as("adminA").post("/api/deals", { title: "Board item", stage: "Negotiation" })).body.data;
    const res = await as("adminA").get("/api/deals").query({ stage: "Negotiation" });
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: any) => d.id)).toContain(deal.id);
    expect(res.body.data.every((d: any) => d.stage === "Negotiation")).toBe(true);
  });

  it("delete is manager-only and isolated per workspace", async () => {
    const deal = (await as("adminA").post("/api/deals", { title: "To delete" })).body.data;
    expect((await as("adminB").get(`/api/deals/${deal.id}`)).status).toBe(404);
    expect((await as("adminB").patch(`/api/deals/${deal.id}/stage`, { stage: "Qualified" })).status).toBe(404);
    expect((await as("memberA").delete(`/api/deals/${deal.id}`)).status).toBe(403);
    expect((await as("adminB").delete(`/api/deals/${deal.id}`)).status).toBe(404);
    expect((await as("managerA").delete(`/api/deals/${deal.id}`)).status).toBe(204);
    expect((await as("adminA").get(`/api/deals/${deal.id}`)).status).toBe(404);
  });
});
