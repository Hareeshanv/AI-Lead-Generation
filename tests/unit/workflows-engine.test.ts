import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  workflowsDb: {
    list: vi.fn(),
    get: vi.fn(),
    createRun: vi.fn(),
    updateRun: vi.fn(),
    getRun: vi.fn(),
    transitionRun: vi.fn(),
    createStep: vi.fn(),
    updateStep: vi.fn(),
    listSteps: vi.fn(),
    refreshStats: vi.fn(),
    scheduleProcessedLeadIds: vi.fn(),
    markScheduleLeadProcessed: vi.fn(),
    listEnabledByTrigger: vi.fn(),
    hasQueuedJob: vi.fn(),
  },
  jobsDb: { enqueue: vi.fn(), cancel: vi.fn() },
  activitiesDb: { create: vi.fn() },
  auditDb: { record: vi.fn() },
}));

vi.mock("@ai-lead-gen/database", () => ({ isDbConfigured: true, ...db }));
vi.mock("../../apps/api/src/logger", () => {
  const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => log };
  return { logger: log };
});
vi.mock("../../apps/api/src/workflows/actions", () => ({
  ActionError: class ActionError extends Error {},
  executeAction: vi.fn(),
  loadLead: vi.fn(),
  loadDeal: vi.fn(),
  loadRecentLeads: vi.fn(),
}));

import { events } from "../../apps/api/src/events";
import { getJobHandler } from "../../apps/api/src/jobs/registry";
import * as actions from "../../apps/api/src/workflows/actions";
import {
  invalidateWorkflowCache,
  runWorkflow,
  syncWorkflowSchedule,
  testWorkflow,
} from "../../apps/api/src/workflows/engine";

const ORG = "11111111-1111-4111-8111-111111111111";
const executeAction = vi.mocked(actions.executeAction);
const loadLead = vi.mocked(actions.loadLead);
const loadDeal = vi.mocked(actions.loadDeal);
const loadRecentLeads = vi.mocked(actions.loadRecentLeads);

let workflowSeq = 0;
function workflow(overrides: Record<string, any> = {}): any {
  workflowSeq++;
  return {
    id: `wf-${workflowSeq}`,
    org_id: ORG,
    name: "Tag hot leads",
    enabled: true,
    trigger: { type: "lead.created" },
    conditions: { op: "and", rules: [{ field: "lead.score", operator: "gte", value: 80 }] },
    actions: [
      { type: "add_tag", params: { tag: "hot" } },
      { type: "notify", params: { recipients: "owner", title: "Hot lead" } },
    ],
    ...overrides,
  };
}

const hotLead = { id: "lead-1", name: "Asha", score: 90, source: "web" };

/** Every handler of an emitted event has settled. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  invalidateWorkflowCache();
  let runSeq = 0;
  db.workflowsDb.createRun.mockImplementation(async (orgId: string, input: any) => ({
    id: `run-${++runSeq}`,
    org_id: orgId,
    workflow_id: input.workflowId,
    status: input.status,
    dry_run: input.dryRun,
    trigger_event: input.triggerEvent,
    trigger_payload: input.triggerPayload,
    lead_id: input.leadId,
    deal_id: input.dealId,
  }));
  db.workflowsDb.updateRun.mockResolvedValue(undefined);
  db.workflowsDb.createStep.mockResolvedValue(undefined);
  db.workflowsDb.refreshStats.mockResolvedValue(undefined);
  db.workflowsDb.list.mockResolvedValue([]);
  db.activitiesDb.create.mockResolvedValue({});
  db.auditDb.record.mockResolvedValue(undefined);
  db.jobsDb.enqueue.mockImplementation(async (input: any) => ({ id: "job-1", ...input }));
  db.jobsDb.cancel.mockResolvedValue(0);
  executeAction.mockResolvedValue({ status: "succeeded", output: {} });
  loadLead.mockImplementation(async (_org, id) => (id === hotLead.id ? hotLead : null));
  loadDeal.mockResolvedValue(null);
});

describe("runWorkflow", () => {
  it("runs every action in order when the conditions match", async () => {
    const wf = workflow();
    const result = await runWorkflow(wf, { event: "lead.created", payload: { orgId: ORG, leadId: "lead-1" } });

    expect(result?.run.status).toBe("succeeded");
    expect(result?.conditions.matched).toBe(true);
    expect(executeAction.mock.calls.map(([, action]) => action.type)).toEqual(["add_tag", "notify"]);
    expect(executeAction.mock.calls[0][0]).toMatchObject({ orgId: ORG, dryRun: false, workflow: wf });
    expect(db.workflowsDb.createStep.mock.calls.map(([, step]) => [step.position, step.status])).toEqual([
      [0, "succeeded"],
      [1, "succeeded"],
    ]);
    expect(db.workflowsDb.createRun).toHaveBeenCalledWith(ORG, expect.objectContaining({ leadId: "lead-1", status: "running" }));
    expect(db.workflowsDb.updateRun).toHaveBeenCalledWith(ORG, "run-1", expect.objectContaining({ status: "succeeded", error: null }));
    expect(db.workflowsDb.refreshStats).toHaveBeenCalledWith(ORG, wf.id);
    expect(db.activitiesDb.create).toHaveBeenCalledWith(ORG, expect.objectContaining({ leadId: "lead-1", type: "workflow" }));
  });

  it("records a skipped run without running actions when the conditions do not match", async () => {
    loadLead.mockResolvedValue({ ...hotLead, score: 10 });
    const result = await runWorkflow(workflow(), { event: "lead.created", payload: { orgId: ORG, leadId: "lead-1" } });

    expect(result?.run.status).toBe("skipped");
    expect(executeAction).not.toHaveBeenCalled();
    expect(db.activitiesDb.create).not.toHaveBeenCalled();
  });

  it("records nothing for a non-matching lead when recordSkipped is false", async () => {
    const result = await runWorkflow(
      workflow(),
      { event: "schedule", payload: { orgId: ORG } },
      { lead: { ...hotLead, score: 10 }, deal: null, recordSkipped: false }
    );
    expect(result).toBeNull();
    expect(db.workflowsDb.createRun).not.toHaveBeenCalled();
  });

  it("stops at the first failing action and fails the run", async () => {
    const failed = vi.fn();
    const off = events.on("workflow.run_failed", failed);
    executeAction.mockRejectedValueOnce(new actions.ActionError("Lead has no owner"));

    const result = await runWorkflow(workflow(), { event: "lead.created", payload: { orgId: ORG, leadId: "lead-1" } });
    await settle();
    off();

    expect(result?.run.status).toBe("failed");
    expect(result?.run.error).toBe("Step 1 (add_tag) failed: Lead has no owner");
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(db.workflowsDb.createStep).toHaveBeenCalledWith(ORG, expect.objectContaining({ position: 0, status: "failed" }));
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", relatedLeadId: "lead-1" }), expect.anything());
  });

  it("parks the run at a delay and queues the rest as a job", async () => {
    const wf = workflow({
      actions: [
        { type: "delay", params: { amount: 2, unit: "hours" } },
        { type: "add_tag", params: { tag: "follow-up" } },
      ],
    });
    const before = Date.now();
    const result = await runWorkflow(wf, { event: "lead.created", payload: { orgId: ORG, leadId: "lead-1" } });

    expect(result?.run.status).toBe("waiting");
    expect(executeAction).not.toHaveBeenCalled();
    expect(db.workflowsDb.updateRun).toHaveBeenCalledWith(ORG, "run-1", { status: "waiting" });
    const queued = db.jobsDb.enqueue.mock.calls[0][0];
    expect(queued).toMatchObject({
      type: "workflow.delayed_action",
      payload: { workflowId: wf.id, runId: "run-1", stepPosition: 1 },
      orgId: ORG,
      dedupeKey: "workflow.delayed_action:run-1:1",
    });
    expect(queued.runAt.getTime() - before).toBeGreaterThanOrEqual(2 * 3_600_000);
  });

  it("fails a run whose stored definition is invalid", async () => {
    const result = await runWorkflow(workflow({ actions: [] }), { event: "lead.created", payload: { orgId: ORG, leadId: "lead-1" } });
    expect(result?.run.status).toBe("failed");
    expect(result?.run.error).toMatch(/^The workflow definition is invalid/);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("dry runs preview actions without updating stats or the activity timeline", async () => {
    const result = await testWorkflow(workflow(), { leadId: "lead-1" });
    expect(result.run.status).toBe("succeeded");
    expect(result.run.dry_run).toBe(true);
    expect(executeAction.mock.calls[0][0]).toMatchObject({ dryRun: true });
    expect(db.workflowsDb.refreshStats).not.toHaveBeenCalled();
    expect(db.activitiesDb.create).not.toHaveBeenCalled();
  });
});

describe("event triggers", () => {
  it("runs enabled workflows whose trigger matches the event", async () => {
    const wf = workflow({ trigger: { type: "lead.created", source: "web" } });
    const other = workflow({ trigger: { type: "lead.created", source: "Meta Lead Ads" } });
    db.workflowsDb.list.mockResolvedValue([wf, other]);

    await events.emitAndWait("lead.created", { orgId: ORG, leadId: "lead-1", source: "web" });

    expect(db.workflowsDb.list).toHaveBeenCalledWith(ORG, { enabled: true });
    expect(db.workflowsDb.createRun).toHaveBeenCalledTimes(1);
    expect(db.workflowsDb.createRun).toHaveBeenCalledWith(ORG, expect.objectContaining({ workflowId: wf.id }));
  });

  it("fires lead.score_above once when the score crosses the threshold", async () => {
    const wf = workflow({ trigger: { type: "lead.score_above", threshold: 80 }, conditions: { op: "and", rules: [] } });
    db.workflowsDb.list.mockResolvedValue([wf]);

    await events.emitAndWait("lead.score_changed", { orgId: ORG, leadId: "lead-1", from: 70, to: 85 });
    // The same crossing reported again as lead.updated, and a change that stays above the threshold.
    await events.emitAndWait("lead.updated", { orgId: ORG, leadId: "lead-1", changes: { score: { from: 70, to: 85 } } });
    await events.emitAndWait("lead.score_changed", { orgId: ORG, leadId: "lead-1", from: 85, to: 95 });

    expect(db.workflowsDb.createRun).toHaveBeenCalledTimes(1);
  });

  it("does not let a workflow re-trigger itself through the events its actions emit", async () => {
    const wf = workflow({
      trigger: { type: "lead.status_changed" },
      conditions: { op: "and", rules: [] },
      actions: [{ type: "set_status", params: { status: "Contacted" } }],
    });
    db.workflowsDb.list.mockResolvedValue([wf]);
    executeAction.mockImplementation(async (env) => {
      await events.emitAndWait("lead.status_changed", { orgId: env.orgId, leadId: "lead-1", from: "New", to: "Contacted" });
      return { status: "succeeded", output: {} };
    });

    await events.emitAndWait("lead.status_changed", { orgId: ORG, leadId: "lead-1", from: "Cold", to: "New" });

    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it("ignores events without an org and workflow.* events", async () => {
    db.workflowsDb.list.mockResolvedValue([workflow()]);
    await events.emitAndWait("lead.created", { orgId: "", leadId: "lead-1" });
    await events.emitAndWait("workflow.run_completed", { orgId: ORG, workflowId: "x", runId: "r", status: "succeeded" });
    expect(db.workflowsDb.list).not.toHaveBeenCalled();
  });
});

describe("schedules", () => {
  const cron = "0 9 * * *";
  const scheduleWorkflow = (overrides: Record<string, any> = {}) =>
    workflow({
      trigger: { type: "schedule", cron, scope: "leads" },
      conditions: { op: "and", rules: [{ field: "lead.score", operator: "gte", value: 50 }] },
      actions: [{ type: "add_tag", params: { tag: "nurture" } }],
      ...overrides,
    });

  it("replaces queued ticks with the next fire time when a schedule is saved", async () => {
    const wf = scheduleWorkflow();
    await syncWorkflowSchedule(wf);

    expect(db.jobsDb.cancel).toHaveBeenCalledWith({
      orgId: ORG,
      type: "workflow.schedule_tick",
      dedupeKeyPrefix: `workflow.schedule_tick:${wf.id}:`,
    });
    const queued = db.jobsDb.enqueue.mock.calls[0][0];
    expect(queued).toMatchObject({ type: "workflow.schedule_tick", payload: { workflowId: wf.id, cron }, orgId: ORG, maxAttempts: 3 });
    expect(queued.runAt.getUTCHours()).toBe(9);
    expect(queued.dedupeKey).toBe(`workflow.schedule_tick:${wf.id}:${queued.runAt.toISOString()}`);
  });

  it("only cancels ticks for a disabled workflow", async () => {
    await syncWorkflowSchedule({ id: "wf-x", org_id: ORG, enabled: false });
    expect(db.jobsDb.cancel).toHaveBeenCalled();
    expect(db.jobsDb.enqueue).not.toHaveBeenCalled();
  });

  it("runs a lead-scoped tick once per new matching lead and queues the next tick", async () => {
    const wf = scheduleWorkflow();
    db.workflowsDb.get.mockResolvedValue(wf);
    loadRecentLeads.mockResolvedValue([
      { id: "lead-a", score: 60 },
      { id: "lead-b", score: 70 },
      { id: "lead-c", score: 10 },
    ]);
    db.workflowsDb.scheduleProcessedLeadIds.mockResolvedValue(new Set(["lead-b"]));
    db.workflowsDb.markScheduleLeadProcessed.mockResolvedValue(undefined);

    const handler = getJobHandler("workflow.schedule_tick")!.handler;
    await handler({ workflowId: wf.id, cron }, { orgId: ORG } as any);

    expect(db.jobsDb.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "workflow.schedule_tick" }));
    expect(db.workflowsDb.scheduleProcessedLeadIds).toHaveBeenCalledWith(ORG, wf.id, ["lead-a", "lead-b", "lead-c"]);
    // lead-b already ran, lead-c does not match yet (and is not recorded, so it is checked again next tick).
    expect(db.workflowsDb.createRun).toHaveBeenCalledTimes(1);
    expect(db.workflowsDb.markScheduleLeadProcessed).toHaveBeenCalledTimes(1);
    expect(db.workflowsDb.markScheduleLeadProcessed).toHaveBeenCalledWith(ORG, wf.id, "lead-a", "run-1");
  });

  it("ignores a stale tick after the schedule changed", async () => {
    db.workflowsDb.get.mockResolvedValue(scheduleWorkflow({ trigger: { type: "schedule", cron: "0 10 * * *", scope: "leads" } }));
    const handler = getJobHandler("workflow.schedule_tick")!.handler;
    await handler({ workflowId: "wf-1", cron }, { orgId: ORG } as any);
    expect(db.jobsDb.enqueue).not.toHaveBeenCalled();
    expect(loadRecentLeads).not.toHaveBeenCalled();
  });

  it("rejects ticks without an org as permanent failures", async () => {
    const handler = getJobHandler("workflow.schedule_tick")!.handler;
    await expect(handler({ workflowId: "wf-1", cron }, { orgId: null } as any)).rejects.toMatchObject({ permanent: true });
  });
});

describe("delayed actions", () => {
  it("resumes a waiting run from the stored step", async () => {
    const wf = workflow();
    db.workflowsDb.getRun.mockResolvedValue({
      id: "run-9",
      status: "waiting",
      dry_run: false,
      lead_id: "lead-1",
      deal_id: null,
      trigger_event: "lead.created",
      trigger_payload: {
        payload: { orgId: ORG, leadId: "lead-1" },
        actions: [
          { type: "delay", params: { amount: 1, unit: "hours" } },
          { type: "add_tag", params: { tag: "follow-up" } },
        ],
      },
    });
    db.workflowsDb.listSteps.mockResolvedValue([{ id: "step-0", status: "waiting" }]);
    db.workflowsDb.get.mockResolvedValue(wf);
    db.workflowsDb.transitionRun.mockResolvedValue(true);
    db.workflowsDb.updateStep.mockResolvedValue(undefined);

    const handler = getJobHandler("workflow.delayed_action")!.handler;
    await handler({ workflowId: wf.id, runId: "run-9", stepPosition: 1 }, { orgId: ORG } as any);

    expect(db.workflowsDb.transitionRun).toHaveBeenCalledWith(ORG, "run-9", "waiting", "running");
    expect(db.workflowsDb.updateStep).toHaveBeenCalledWith(ORG, "step-0", expect.objectContaining({ status: "succeeded" }));
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(executeAction.mock.calls[0][1]).toMatchObject({ type: "add_tag", params: { tag: "follow-up" } });
    expect(db.workflowsDb.updateRun).toHaveBeenCalledWith(ORG, "run-9", expect.objectContaining({ status: "succeeded" }));
  });

  it("skips the rest of the run when the workflow was disabled during the delay", async () => {
    db.workflowsDb.getRun.mockResolvedValue({ id: "run-9", status: "waiting", dry_run: false, trigger_payload: {} });
    db.workflowsDb.listSteps.mockResolvedValue([{ id: "step-0", status: "waiting" }]);
    db.workflowsDb.get.mockResolvedValue(workflow({ enabled: false }));
    db.workflowsDb.transitionRun.mockResolvedValue(true);

    const handler = getJobHandler("workflow.delayed_action")!.handler;
    await handler({ workflowId: "wf-1", runId: "run-9", stepPosition: 1 }, { orgId: ORG } as any);

    expect(executeAction).not.toHaveBeenCalled();
    expect(db.workflowsDb.updateStep).toHaveBeenCalledWith(ORG, "step-0", expect.objectContaining({ status: "skipped" }));
    expect(db.workflowsDb.updateRun).toHaveBeenCalledWith(
      ORG,
      "run-9",
      expect.objectContaining({ status: "skipped", error: "The workflow was disabled before the delay finished." })
    );
  });

  it("does nothing when another worker already resumed the run", async () => {
    db.workflowsDb.getRun.mockResolvedValue({ id: "run-9", status: "running" });
    const handler = getJobHandler("workflow.delayed_action")!.handler;
    await handler({ workflowId: "wf-1", runId: "run-9", stepPosition: 1 }, { orgId: ORG } as any);
    expect(db.workflowsDb.transitionRun).not.toHaveBeenCalled();
    expect(executeAction).not.toHaveBeenCalled();
  });
});
