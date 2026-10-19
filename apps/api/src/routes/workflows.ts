import { z } from "zod";
import {
  workflowsDb,
  type WorkflowRow,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { parsePagination, send, sendPage } from "../http/pagination";
import { parse, parseId, queryBoolean } from "../http/validate";
import { getCtx, requireRole } from "../middleware/auth";
import { invalidateWorkflowCache, syncWorkflowSchedule, testWorkflow } from "../workflows/engine";
import { loadDeal, loadLead } from "../workflows/actions";
import { logger } from "../logger";
import {
  parseStoredDefinition,
  triggerSubjects,
  workflowDefinitionSchema,
  workflowPatchSchema,
  type WorkflowAction,
  type WorkflowTrigger,
} from "../workflows/schema";
import { publicUrlProblem } from "../integrations/providers";

/** Mounted at /api/workflows behind requireAuth(); owned by the Workflows module. */
export const workflowsRouter = createRouter();

// ---- DTOs ------------------------------------------------------------------------------------

function toWorkflowDto(row: WorkflowRow) {
  const rate = row.success_rate == null ? null : Number(row.success_rate);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    enabled: Boolean(row.enabled),
    status: row.enabled ? "active" : row.status === "draft" ? "draft" : "paused",
    trigger: row.trigger ?? {},
    conditions: row.conditions ?? { op: "and", rules: [] },
    actions: Array.isArray(row.actions) ? row.actions : [],
    stats: {
      totalRuns: row.total_runs ?? 0,
      successRate: rate == null || Number.isNaN(rate) ? null : rate,
      lastRunAt: row.last_run ?? null,
    },
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

function toStepDto(row: WorkflowRunStepRow) {
  return {
    id: row.id,
    position: row.position,
    actionType: row.action_type,
    status: row.status,
    input: row.input ?? {},
    output: row.output ?? null,
    error: row.error ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function toRunDto(row: WorkflowRunRow, workflowName?: string | null, steps?: WorkflowRunStepRow[]) {
  const stored = (row.trigger_payload ?? {}) as Record<string, any>;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: workflowName ?? null,
    triggerEvent: row.trigger_event,
    triggerPayload: stored.payload ?? {},
    conditions: stored.conditions ?? null,
    leadId: row.lead_id,
    dealId: row.deal_id,
    status: row.status,
    dryRun: row.dry_run,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    ...(steps ? { steps: steps.map(toStepDto) } : {}),
  };
}

// ---- Helpers ---------------------------------------------------------------------------------

async function getWorkflowOr404(orgId: string, rawId: unknown): Promise<WorkflowRow> {
  const row = await workflowsDb.get(orgId, parseId(rawId, "workflow id"));
  if (!row) throw HttpError.notFound("Workflow");
  return row;
}

/** Webhook action URLs must be https and resolve to public addresses (checked again when the action runs). */
async function assertSafeWebhookUrls(actions: WorkflowAction[]): Promise<void> {
  const fields: Record<string, string[]> = {};
  await Promise.all(
    actions.map(async (action, index) => {
      if (action.type !== "webhook" || !action.params.url) return;
      const problem = await publicUrlProblem(action.params.url);
      if (problem) fields[`actions.${index}.params.url`] = [problem];
    })
  );
  if (Object.keys(fields).length > 0) throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", fields);
}

/** Re-queues schedule ticks and drops the engine's cache after any definition change. */
async function afterChange(row: WorkflowRow | { id: string; org_id: string; enabled: false }) {
  invalidateWorkflowCache(row.org_id);
  try {
    await syncWorkflowSchedule(row);
  } catch (err: any) {
    logger.error("Scheduling workflow failed", { module: "workflows", orgId: row.org_id, workflowId: row.id, err });
  }
}

const runSortable = { startedAt: "started_at", status: "status", completedAt: "completed_at" };

const runsQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  status: z.enum(["running", "waiting", "succeeded", "failed", "skipped"]).optional(),
  leadId: z.string().uuid().optional(),
  includeTests: queryBoolean.optional(),
});

async function listRuns(orgId: string, query: unknown, forcedWorkflowId?: string) {
  const q = parse(runsQuerySchema.passthrough(), query ?? {});
  const p = parsePagination(query, { sortable: runSortable, defaultSort: "-startedAt" });
  const [{ rows, total }, workflows] = await Promise.all([
    workflowsDb.listRuns(
      orgId,
      {
        workflowId: forcedWorkflowId ?? q.workflowId,
        status: q.status,
        leadId: q.leadId,
        includeDryRuns: q.includeTests ?? true,
      },
      p
    ),
    workflowsDb.list(orgId),
  ]);
  const names = new Map(workflows.map((w) => [w.id, w.name]));
  return { rows: rows.map((r) => toRunDto(r, names.get(r.workflow_id))), total, p };
}

// ---- Routes ----------------------------------------------------------------------------------

const listQuerySchema = z.object({ enabled: queryBoolean.optional() }).passthrough();

// GET /api/workflows
workflowsRouter.get("/", async (req, res) => {
  const { orgId } = getCtx(req);
  const { enabled } = parse(listQuerySchema, req.query);
  const rows = await workflowsDb.list(orgId, { enabled });
  send(res, rows.map(toWorkflowDto));
});

// GET /api/workflows/runs — runs across all workflows
workflowsRouter.get("/runs", async (req, res) => {
  const { orgId } = getCtx(req);
  const { rows, total, p } = await listRuns(orgId, req.query);
  sendPage(res, rows, total, p);
});

// GET /api/workflows/runs/:runId — one run with its steps
workflowsRouter.get("/runs/:runId", async (req, res) => {
  const { orgId } = getCtx(req);
  const run = await workflowsDb.getRun(orgId, parseId(req.params.runId, "run id"));
  if (!run) throw HttpError.notFound("Workflow run");
  const [steps, workflow] = await Promise.all([
    workflowsDb.listSteps(orgId, run.id),
    workflowsDb.get(orgId, run.workflow_id),
  ]);
  send(res, toRunDto(run, workflow?.name, steps));
});

// GET /api/workflows/:id
workflowsRouter.get("/:id", async (req, res) => {
  const { orgId } = getCtx(req);
  send(res, toWorkflowDto(await getWorkflowOr404(orgId, req.params.id)));
});

// POST /api/workflows (manager)
workflowsRouter.post("/", requireRole("manager"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const body = parse(workflowDefinitionSchema, req.body);
  await assertSafeWebhookUrls(body.actions);
  const row = await workflowsDb.create(orgId, {
    name: body.name,
    description: body.description ?? null,
    enabled: body.enabled ?? false,
    trigger: body.trigger,
    conditions: body.conditions,
    actions: body.actions,
    createdBy: userId,
  });
  await afterChange(row);
  send(res, toWorkflowDto(row), 201);
});

// PATCH /api/workflows/:id (manager) — the merged definition is validated as a whole
workflowsRouter.patch("/:id", requireRole("manager"), async (req, res) => {
  const { orgId } = getCtx(req);
  const existing = await getWorkflowOr404(orgId, req.params.id);
  const patch = parse(workflowPatchSchema, req.body);
  const merged = parse(workflowDefinitionSchema, {
    name: patch.name ?? existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    enabled: patch.enabled ?? existing.enabled,
    trigger: patch.trigger !== undefined ? patch.trigger : existing.trigger,
    conditions: patch.conditions !== undefined ? patch.conditions : existing.conditions,
    actions: patch.actions !== undefined ? patch.actions : existing.actions,
  });
  if (patch.actions !== undefined) await assertSafeWebhookUrls(merged.actions);
  const row = await workflowsDb.update(orgId, existing.id, {
    name: merged.name,
    description: merged.description ?? null,
    enabled: merged.enabled,
    trigger: merged.trigger,
    conditions: merged.conditions,
    actions: merged.actions,
  });
  if (!row) throw HttpError.notFound("Workflow");
  await afterChange(row);
  send(res, toWorkflowDto(row));
});

// DELETE /api/workflows/:id (manager)
workflowsRouter.delete("/:id", requireRole("manager"), async (req, res) => {
  const { orgId } = getCtx(req);
  const id = parseId(req.params.id, "workflow id");
  if (!(await workflowsDb.remove(orgId, id))) throw HttpError.notFound("Workflow");
  await afterChange({ id, org_id: orgId, enabled: false });
  res.status(204).end();
});

async function setEnabled(orgId: string, rawId: unknown, enabled: boolean) {
  const existing = await getWorkflowOr404(orgId, rawId);
  if (enabled) {
    const parsed = parseStoredDefinition(existing);
    if (!parsed.ok) throw HttpError.badRequest(`Fix this workflow before enabling it: ${parsed.error}`);
  }
  const row = await workflowsDb.update(orgId, existing.id, { enabled });
  if (!row) throw HttpError.notFound("Workflow");
  await afterChange(row);
  return toWorkflowDto(row);
}

// POST /api/workflows/:id/enable | /disable (manager)
workflowsRouter.post("/:id/enable", requireRole("manager"), async (req, res) => {
  send(res, await setEnabled(getCtx(req).orgId, req.params.id, true));
});
workflowsRouter.post("/:id/disable", requireRole("manager"), async (req, res) => {
  send(res, await setEnabled(getCtx(req).orgId, req.params.id, false));
});

const testSchema = z
  .object({
    leadId: z.string().uuid("Pick a lead").optional().nullable(),
    dealId: z.string().uuid("Pick a deal").optional().nullable(),
  })
  .strict();

// POST /api/workflows/:id/test (manager) — dry run, no side effects; the run is recorded with dryRun=true
workflowsRouter.post("/:id/test", requireRole("manager"), async (req, res) => {
  const { orgId } = getCtx(req);
  const workflow = await getWorkflowOr404(orgId, req.params.id);
  const body = parse(testSchema, req.body ?? {});

  const parsed = parseStoredDefinition(workflow);
  if (!parsed.ok) throw HttpError.badRequest(`This workflow is invalid: ${parsed.error}`);
  const subjects = triggerSubjects(parsed.definition.trigger as WorkflowTrigger);
  if (subjects.includes("deal") && !body.dealId) {
    throw HttpError.badRequest("Pick a deal to test this workflow with.", { dealId: ["Pick a deal"] });
  }
  if (subjects.includes("lead") && !subjects.includes("deal") && !body.leadId) {
    throw HttpError.badRequest("Pick a lead to test this workflow with.", { leadId: ["Pick a lead"] });
  }
  if (body.dealId && !(await loadDeal(orgId, body.dealId))) throw HttpError.notFound("Deal");
  if (body.leadId && !(await loadLead(orgId, body.leadId))) throw HttpError.notFound("Lead");

  const result = await testWorkflow(workflow, { leadId: body.leadId, dealId: body.dealId });
  const steps = await workflowsDb.listSteps(orgId, result.run.id);
  send(res, { ...toRunDto(result.run, workflow.name, steps), conditions: result.conditions });
});

// GET /api/workflows/:id/runs
workflowsRouter.get("/:id/runs", async (req, res) => {
  const { orgId } = getCtx(req);
  const workflow = await getWorkflowOr404(orgId, req.params.id);
  const { rows, total, p } = await listRuns(orgId, req.query, workflow.id);
  sendPage(res, rows, total, p);
});