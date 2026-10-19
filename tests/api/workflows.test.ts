import { describe, expect, it } from "vitest";
import { as, errorBody, hasDb, leadInput, runId, waitFor } from "./support/helpers";

describe.skipIf(!hasDb())("workflows API", () => {
  it("members cannot create workflows", async () => {
    const res = await as("memberA").post("/api/workflows", {
      name: "x",
      trigger: { type: "lead.created" },
      actions: [{ type: "add_tag", params: { tag: "x" } }],
    });
    expect(res.status).toBe(403);
  });

  it("rejects invalid definitions with field paths", async () => {
    const noActions = await as("managerA").post("/api/workflows", { name: "x", trigger: { type: "lead.created" }, actions: [] });
    expect(noActions.status).toBe(400);
    expect(errorBody(noActions).fields).toHaveProperty("actions");

    const http = await as("managerA").post("/api/workflows", {
      name: "x",
      trigger: { type: "lead.created" },
      actions: [{ type: "webhook", params: { url: "http://example.com/hook" } }],
    });
    expect(http.status).toBe(400);

    const needsDeal = await as("managerA").post("/api/workflows", {
      name: "x",
      trigger: { type: "lead.created" },
      actions: [{ type: "set_stage", params: { stage: "Proposal" } }],
    });
    expect(needsDeal.status).toBe(400);

    const cron = await as("managerA").post("/api/workflows", {
      name: "x",
      trigger: { type: "schedule", cron: "* * * * *" },
      actions: [{ type: "notify", params: { title: "hi" } }],
    });
    expect(cron.status).toBe(400);
    expect(errorBody(cron).fields).toHaveProperty(["trigger.cron"]);
  });

  it("lead.created trigger runs add_tag on matching leads only", async () => {
    const tag = `wf-${runId()}`;
    const source = `QA Source ${runId()}`;
    const wf = await as("managerA").post("/api/workflows", {
      name: `QA tagger ${runId()}`,
      enabled: true,
      trigger: { type: "lead.created", source },
      conditions: { op: "and", rules: [{ field: "lead.email", operator: "is_not_empty" }] },
      actions: [{ type: "add_tag", params: { tag } }],
    });
    expect(wf.status).toBe(201);
    expect(wf.body.data).toMatchObject({ enabled: true, status: "active" });

    const match = (await as("adminA").post("/api/leads", leadInput({ source }))).body.data;
    const other = (await as("adminA").post("/api/leads", leadInput({ source: "Somewhere else" }))).body.data;

    const tagged = await waitFor(async () => {
      const lead = (await as("adminA").get(`/api/leads/${match.id}`)).body.data;
      return lead.tags?.includes(tag) ? lead : null;
    });
    expect(tagged.tags).toContain(tag);

    const runs = await waitFor(async () => {
      const res = await as("memberA").get(`/api/workflows/${wf.body.data.id}/runs`);
      return res.body.data.length > 0 ? res.body.data : null;
    });
    expect(runs[0]).toMatchObject({ leadId: match.id, status: "succeeded", dryRun: false });

    const detail = await as("memberA").get(`/api/workflows/runs/${runs[0].id}`);
    expect(detail.body.data.steps[0]).toMatchObject({ actionType: "add_tag", status: "succeeded" });

    expect((await as("adminA").get(`/api/leads/${other.id}`)).body.data.tags ?? []).not.toContain(tag);
    expect((await as("adminB").get(`/api/workflows/runs/${runs[0].id}`)).status).toBe(404);
  });

  it("CSV import fires lead.created workflows per imported lead", async () => {
    const tag = `wf-import-${runId()}`;
    const source = `QA Import ${runId()}`;
    const wf = (
      await as("managerA").post("/api/workflows", {
        name: `QA import tagger ${runId()}`,
        enabled: true,
        trigger: { type: "lead.created", source },
        actions: [{ type: "add_tag", params: { tag } }],
      })
    ).body.data;
    const res = await as("adminA").post("/api/leads/import", { rows: [leadInput(), leadInput()], source });
    expect(res.body.data.imported).toBe(2);
    const runs = await waitFor(async () => {
      const r = await as("adminA").get(`/api/workflows/${wf.id}/runs`);
      return r.body.data.length >= 2 ? r.body.data : null;
    });
    expect(runs).toHaveLength(2);
  });

  it("dry-run test needs a lead, records a dry run and changes nothing", async () => {
    const tag = `dry-${runId()}`;
    const wf = (
      await as("managerA").post("/api/workflows", {
        name: `QA dry ${runId()}`,
        trigger: { type: "lead.created" },
        actions: [{ type: "add_tag", params: { tag } }],
      })
    ).body.data;
    expect(wf.enabled).toBe(false);

    const missing = await as("managerA").post(`/api/workflows/${wf.id}/test`, {});
    expect(missing.status).toBe(400);
    expect(errorBody(missing).fields).toHaveProperty("leadId");

    const lead = (await as("adminA").post("/api/leads", leadInput())).body.data;
    const run = await as("managerA").post(`/api/workflows/${wf.id}/test`, { leadId: lead.id });
    expect(run.status).toBe(200);
    expect(run.body.data.dryRun).toBe(true);
    expect((await as("adminA").get(`/api/leads/${lead.id}`)).body.data.tags ?? []).not.toContain(tag);

    expect((await as("memberA").post(`/api/workflows/${wf.id}/test`, { leadId: lead.id })).status).toBe(403);
  });

  it("enable/disable, patch and delete with isolation", async () => {
    const wf = (
      await as("managerA").post("/api/workflows", {
        name: `QA toggle ${runId()}`,
        trigger: { type: "lead.status_changed", to: "Hot" },
        actions: [{ type: "notify", params: { recipients: "owner", title: "Hot lead" } }],
      })
    ).body.data;
    expect((await as("managerA").post(`/api/workflows/${wf.id}/enable`)).body.data.enabled).toBe(true);
    expect((await as("managerA").post(`/api/workflows/${wf.id}/disable`)).body.data.enabled).toBe(false);

    const patched = await as("managerA").patch(`/api/workflows/${wf.id}`, { name: "Renamed" });
    expect(patched.body.data.name).toBe("Renamed");
    expect((await as("managerA").patch(`/api/workflows/${wf.id}`, { actions: [] })).status).toBe(400);

    expect((await as("adminB").get(`/api/workflows/${wf.id}`)).status).toBe(404);
    expect((await as("adminB").delete(`/api/workflows/${wf.id}`)).status).toBe(404);
    expect((await as("managerA").delete(`/api/workflows/${wf.id}`)).status).toBe(204);
    expect((await as("managerA").get(`/api/workflows/${wf.id}`)).status).toBe(404);
  });
});
