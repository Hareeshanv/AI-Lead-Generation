import { AsyncLocalStorage } from "async_hooks";
import {
  activitiesDb,
  isDbConfigured,
  jobsDb,
  workflowsDb,
  type WorkflowRow,
  type WorkflowRunRow,
  type WorkflowRunStatus,
} from "@ai-lead-gen/database";
import { events, type DomainEvent } from "../events";
import { enqueueJob, PermanentJobError, registerJobHandler } from "../jobs/registry";
import { ActionError, executeAction, loadDeal, loadLead, loadRecentLeads } from "./actions";
import { explainConditions, type ConditionTrace, type WorkflowContext } from "./conditions";
import {
  actionSchema,
  delayMs,
  nextCronDate,
  parseStoredDefinition,
  type ConditionGroup,
  type TriggerType,
  type WorkflowAction,
  type WorkflowTrigger,
} from "./schema";

/** A workflow-originated event may trigger other workflows only this many levels deep. */
export const MAX_CHAIN_DEPTH = 3;
const SCHEDULE_LEAD_SCAN_LIMIT = 500;
const SCHEDULE_MAX_RUNS = 100;
const WORKFLOW_CACHE_MS = 5_000;
const SCORE_DEDUPE_MS = 30_000;

interface ChainScope {
  depth: number;
  /** Workflow ids already running in this causal chain; a workflow never re-triggers itself. */
  chain: string[];
}

/** Set while a workflow executes actions, so events emitted by those actions carry the chain. */
const chainScope = new AsyncLocalStorage<ChainScope>();

export interface TriggerInput {
  event: string | null;
  payload: Record<string, any>;
}

export interface RunOptions {
  dryRun?: boolean;
  scope?: ChainScope;
  /** Preloaded records (schedule scans, tests). */
  lead?: Record<string, any> | null;
  deal?: Record<string, any> | null;
  /** Skip recording a run when the conditions don't match (schedule scans). */
  recordSkipped?: boolean;
}

export interface RunResult {
  run: WorkflowRunRow;
  conditions: ConditionTrace;
}

/** What a run stores in trigger_payload: the event and a snapshot of the actions (used to resume after a delay). */
interface StoredTriggerPayload {
  payload: Record<string, any>;
  actions: WorkflowAction[];
  conditions?: ConditionTrace;
}

const nowIso = () => new Date().toISOString();

// ---- Context ---------------------------------------------------------------------------------

async function buildContext(
  orgId: string,
  trigger: TriggerInput,
  triggerType: string,
  preloaded: Pick<RunOptions, "lead" | "deal"> = {}
): Promise<WorkflowContext> {
  const p = trigger.payload || {};
  const deal = preloaded.deal !== undefined ? preloaded.deal : await loadDeal(orgId, p.dealId);
  const leadId = p.leadId ?? deal?.lead_id ?? null;
  const lead = preloaded.lead !== undefined ? preloaded.lead : await loadLead(orgId, leadId);
  return { lead, deal, event: p, trigger: { type: triggerType, event: trigger.event } };
}

// ---- Trigger matching ------------------------------------------------------------------------

const eqi = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** Score transition carried by an event, if any. */
function scoreChange(name: string, payload: Record<string, any>): { from: number | null; to: number } | null {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : null);
  if (name === "lead.updated" && payload.changes?.score) {
    const to = num(payload.changes.score.to);
    return to === null || Number.isNaN(to) ? null : { from: num(payload.changes.score.from), to };
  }
  if (name.startsWith("lead.") && /scor/.test(name)) {
    const to = num(payload.to ?? payload.score);
    return to === null || Number.isNaN(to) ? null : { from: num(payload.from), to };
  }
  if (name === "lead.created") {
    const to = num(payload.lead?.score);
    return to === null || Number.isNaN(to) ? null : { from: null, to };
  }
  return null;
}

/** Trigger types an event can fire. */
function triggerTypesFor(name: string, payload: Record<string, any>): TriggerType[] {
  const types: TriggerType[] = [];
  if (name === "lead.created") types.push("lead.created");
  if (name === "lead.status_changed") types.push("lead.status_changed");
  if (name === "deal.stage_changed") types.push("deal.stage_changed");
  if (name === "campaign.replied") types.push("campaign.replied");
  if (name === "agent.run_completed") types.push("agent.run_completed");
  if (payload.leadId && scoreChange(name, payload)) types.push("lead.score_above");
  return types;
}

const recentScoreFires = new Map<string, number>();

function triggerMatches(trigger: WorkflowTrigger, workflowId: string, name: string, p: Record<string, any>): boolean {
  switch (trigger.type) {
    case "lead.created":
      return !trigger.source || eqi(trigger.source, p.source ?? p.lead?.source);
    case "lead.status_changed":
    case "deal.stage_changed":
      if (trigger.from && !eqi(trigger.from, p.from)) return false;
      if (trigger.to && !eqi(trigger.to, p.to)) return false;
      return true;
    case "lead.score_above": {
      const change = scoreChange(name, p);
      if (!change) return false;
      const crossed = (change.from === null || change.from < trigger.threshold) && change.to >= trigger.threshold;
      if (!crossed) return false;
      // The same crossing may arrive as both lead.score_changed and lead.updated.
      const key = `${workflowId}:${p.leadId}`;
      const now = Date.now();
      const last = recentScoreFires.get(key);
      if (last && now - last < SCORE_DEDUPE_MS) return false;
      if (recentScoreFires.size > 5_000) recentScoreFires.clear();
      recentScoreFires.set(key, now);
      return true;
    }
    case "campaign.replied":
      if (trigger.campaignId && trigger.campaignId !== p.campaignId) return false;
      if (trigger.channel && trigger.channel !== p.channel) return false;
      return true;
    case "agent.run_completed":
      return !trigger.status || trigger.status === p.status;
    case "schedule":
      return false;
  }
}

// ---- Enabled-workflow cache ------------------------------------------------------------------

const workflowCache = new Map<string, { rows: WorkflowRow[]; expiresAt: number }>();

async function enabledWorkflows(orgId: string): Promise<WorkflowRow[]> {
  const cached = workflowCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const rows = await workflowsDb.list(orgId, { enabled: true });
  if (workflowCache.size > 1_000) workflowCache.clear();
  workflowCache.set(orgId, { rows, expiresAt: Date.now() + WORKFLOW_CACHE_MS });
  return rows;
}

/** Call after creating, editing, enabling or deleting a workflow. */
export function invalidateWorkflowCache(orgId?: string): void {
  if (orgId) workflowCache.delete(orgId);
  else workflowCache.clear();
}

// ---- Running ---------------------------------------------------------------------------------

async function finishRun(
  orgId: string,
  wf: { id: string; name: string },
  run: WorkflowRunRow,
  status: Extract<WorkflowRunStatus, "succeeded" | "failed" | "skipped">,
  ctx: WorkflowContext,
  error: string | null
): Promise<WorkflowRunRow> {
  const completedAt = nowIso();
  await workflowsDb.updateRun(orgId, run.id, { status, error, completedAt });
  const finished: WorkflowRunRow = { ...run, status, error, completed_at: completedAt };
  if (run.dry_run) return finished;

  await workflowsDb.refreshStats(orgId, wf.id).catch((err) =>
    console.error(`[Workflows] Updating stats for ${wf.id} failed: ${err?.message || err}`)
  );
  if (status !== "skipped" && (ctx.lead?.id || ctx.deal?.id)) {
    await activitiesDb
      .create(orgId, {
        type: "workflow",
        leadId: ctx.lead?.id ?? null,
        dealId: ctx.deal?.id ?? null,
        title: status === "succeeded" ? `Workflow "${wf.name}" ran` : `Workflow "${wf.name}" failed`,
        body: error,
        metadata: { workflowId: wf.id, runId: run.id, status },
      })
      .catch((err) => console.error(`[Workflows] Writing activity for run ${run.id} failed: ${err?.message || err}`));
  }
  // Failures emit only workflow.run_failed so subscribers don't handle the same failure twice.
  if (status !== "failed") {
    events.emit("workflow.run_completed", { orgId, actorId: null, workflowId: wf.id, runId: run.id, status });
  } else {
    events.emit("workflow.run_failed", {
      orgId,
      actorId: null,
      workflowId: wf.id,
      workflowName: wf.name,
      runId: run.id,
      relatedLeadId: ctx.lead?.id ?? null,
      error: error || "Workflow run failed",
    });
  }
  return finished;
}

/**
 * Executes actions[start..] in order. A delay parks the run as "waiting" and queues
 * workflow.delayed_action; the first failing action fails the run.
 */
async function executeFrom(
  orgId: string,
  wf: { id: string; name: string },
  run: WorkflowRunRow,
  actions: WorkflowAction[],
  start: number,
  ctx: WorkflowContext,
  scope: ChainScope
): Promise<WorkflowRunRow> {
  for (let position = start; position < actions.length; position++) {
    const action = actions[position];
    const startedAt = nowIso();

    if (action.type === "delay" && !run.dry_run) {
      const resumeAt = new Date(Date.now() + delayMs(action.params));
      await workflowsDb.createStep(orgId, {
        runId: run.id,
        position,
        actionType: action.type,
        status: "waiting",
        input: action.params,
        output: { resumeAt: resumeAt.toISOString() },
        startedAt,
      });
      await workflowsDb.updateRun(orgId, run.id, { status: "waiting" });
      await enqueueJob(
        "workflow.delayed_action",
        { workflowId: wf.id, runId: run.id, stepPosition: position + 1 },
        { orgId, runAt: resumeAt, dedupeKey: `workflow.delayed_action:${run.id}:${position + 1}` }
      );
      return { ...run, status: "waiting" };
    }

    try {
      const result = await chainScope.run(scope, () =>
        executeAction({ orgId, dryRun: run.dry_run, workflow: wf, runId: run.id, ctx }, action)
      );
      await workflowsDb.createStep(orgId, {
        runId: run.id,
        position,
        actionType: action.type,
        status: result.status,
        input: action.params,
        output: result.output,
        startedAt,
        completedAt: nowIso(),
      });
    } catch (err: any) {
      const message =
        err instanceof ActionError ? err.message : `Unexpected error: ${String(err?.message || err).slice(0, 500)}`;
      if (!(err instanceof ActionError)) console.error(`[Workflows] Run ${run.id} step ${position} crashed:`, err);
      await workflowsDb.createStep(orgId, {
        runId: run.id,
        position,
        actionType: action.type,
        status: "failed",
        input: action.params,
        error: message,
        startedAt,
        completedAt: nowIso(),
      });
      return finishRun(orgId, wf, run, "failed", ctx, `Step ${position + 1} (${action.type}) failed: ${message}`);
    }
  }
  return finishRun(orgId, wf, run, "succeeded", ctx, null);
}

/** Evaluates conditions and runs a workflow for one trigger occurrence; records the run. */
export async function runWorkflow(wf: WorkflowRow, trigger: TriggerInput, options: RunOptions = {}): Promise<RunResult | null> {
  const orgId = wf.org_id;
  const scope = options.scope ?? { depth: 1, chain: [wf.id] };
  const dryRun = options.dryRun ?? false;
  const parsed = parseStoredDefinition(wf);
  const triggerType = (wf.trigger?.type as string) || "unknown";

  if (!parsed.ok) {
    const run = await workflowsDb.createRun(orgId, {
      workflowId: wf.id,
      triggerEvent: trigger.event,
      triggerPayload: { payload: trigger.payload, actions: [] },
      leadId: trigger.payload?.leadId ?? null,
      dealId: trigger.payload?.dealId ?? null,
      status: "running",
      dryRun,
    });
    const ctx: WorkflowContext = { lead: null, deal: null, event: trigger.payload, trigger: { type: triggerType, event: trigger.event } };
    const finished = await finishRun(orgId, wf, run, "failed", ctx, `The workflow definition is invalid (${parsed.error}).`);
    return { run: finished, conditions: { matched: false, rules: [] } };
  }

  const { actions, conditions } = parsed.definition;
  const ctx = await buildContext(orgId, trigger, triggerType, options);
  const trace = explainConditions(conditions as ConditionGroup, ctx);
  if (!trace.matched && options.recordSkipped === false) return null;

  const stored: StoredTriggerPayload = { payload: trigger.payload, actions, conditions: trace };
  const run = await workflowsDb.createRun(orgId, {
    workflowId: wf.id,
    triggerEvent: trigger.event,
    triggerPayload: stored as unknown as Record<string, any>,
    leadId: ctx.lead?.id ?? null,
    dealId: ctx.deal?.id ?? null,
    status: "running",
    dryRun,
  });

  if (!trace.matched) {
    const finished = await finishRun(orgId, wf, run, "skipped", ctx, "Conditions did not match.");
    return { run: finished, conditions: trace };
  }

  try {
    const finished = await executeFrom(orgId, wf, run, actions, 0, ctx, scope);
    return { run: finished, conditions: trace };
  } catch (err: any) {
    console.error(`[Workflows] Run ${run.id} crashed:`, err);
    const finished = await finishRun(orgId, wf, run, "failed", ctx, `Unexpected error: ${err?.message || err}`);
    return { run: finished, conditions: trace };
  }
}

// ---- Event subscription ----------------------------------------------------------------------

async function handleEvent(event: DomainEvent): Promise<void> {
  const name = String(event.name);
  if (name.startsWith("workflow.")) return;
  const payload = (event.payload || {}) as Record<string, any>;
  const orgId: string | undefined = payload.orgId;
  if (!orgId) return;

  const types = triggerTypesFor(name, payload);
  if (types.length === 0) return;

  const parent = chainScope.getStore();
  const depth = parent?.depth ?? 0;
  if (depth >= MAX_CHAIN_DEPTH) {
    console.warn(`[Workflows] Not triggering workflows from ${name}: chain depth ${depth} reached.`);
    return;
  }

  const candidates = (await enabledWorkflows(orgId)).filter(
    (wf) => types.includes(wf.trigger?.type) && !(parent?.chain ?? []).includes(wf.id)
  );
  for (const wf of candidates) {
    const parsed = parseStoredDefinition(wf);
    const trigger = parsed.ok ? parsed.definition.trigger : (wf.trigger as WorkflowTrigger);
    if (!triggerMatches(trigger, wf.id, name, payload)) continue;
    const scope: ChainScope = { depth: depth + 1, chain: [...(parent?.chain ?? []), wf.id] };
    try {
      await runWorkflow(wf, { event: name, payload }, { scope });
    } catch (err: any) {
      console.error(`[Workflows] Workflow ${wf.id} failed to run for ${name}: ${err?.message || err}`);
    }
  }
}

// ---- Delays ----------------------------------------------------------------------------------

async function resumeDelayedRun(orgId: string, workflowId: string, runId: string, stepPosition: number): Promise<void> {
  const run = await workflowsDb.getRun(orgId, runId);
  if (!run || run.status !== "waiting") return;

  const steps = await workflowsDb.listSteps(orgId, runId);
  const waiting = steps.filter((s) => s.status === "waiting");
  const wf = await workflowsDb.get(orgId, workflowId);
  const stored = (run.trigger_payload || {}) as Partial<StoredTriggerPayload>;
  const ctxStub: WorkflowContext = {
    lead: null,
    deal: null,
    event: stored.payload || {},
    trigger: { type: (wf?.trigger?.type as string) || "unknown", event: run.trigger_event },
  };

  if (!wf || !wf.enabled) {
    if (!(await workflowsDb.transitionRun(orgId, runId, "waiting", "running"))) return;
    for (const step of waiting) {
      await workflowsDb.updateStep(orgId, step.id, { status: "skipped", completedAt: nowIso() });
    }
    await finishRun(
      orgId,
      { id: workflowId, name: wf?.name || "Deleted workflow" },
      run,
      "skipped",
      ctxStub,
      wf ? "The workflow was disabled before the delay finished." : "The workflow was deleted before the delay finished."
    );
    return;
  }

  if (!(await workflowsDb.transitionRun(orgId, runId, "waiting", "running"))) return;

  try {
    for (const step of waiting) {
      await workflowsDb.updateStep(orgId, step.id, { status: "succeeded", completedAt: nowIso() });
    }
    const actions: WorkflowAction[] = [];
    for (const raw of Array.isArray(stored.actions) ? stored.actions : []) {
      const parsed = actionSchema.safeParse(raw);
      if (!parsed.success) throw new Error("The stored actions for this run are invalid.");
      actions.push(parsed.data);
    }
    const ctx = await buildContext(orgId, { event: run.trigger_event, payload: stored.payload || {} }, ctxStub.trigger.type, {
      lead: await loadLead(orgId, run.lead_id),
      deal: await loadDeal(orgId, run.deal_id),
    });
    await executeFrom(orgId, wf, { ...run, status: "running" }, actions, stepPosition, ctx, { depth: 1, chain: [wf.id] });
  } catch (err: any) {
    console.error(`[Workflows] Resuming run ${runId} failed:`, err);
    await finishRun(orgId, wf, run, "failed", ctxStub, `Resuming after the delay failed: ${err?.message || err}`);
  }
}

// ---- Schedules -------------------------------------------------------------------------------

const scheduleKeyPrefix = (workflowId: string) => `workflow.schedule_tick:${workflowId}:`;

/** Cancels queued ticks and, for an enabled schedule workflow, queues the next one. */
export async function syncWorkflowSchedule(wf: WorkflowRow | { id: string; org_id: string; enabled: false }): Promise<void> {
  await jobsDb.cancel({ orgId: wf.org_id, type: "workflow.schedule_tick", dedupeKeyPrefix: scheduleKeyPrefix(wf.id) });
  if (!wf.enabled) return;
  const trigger = (wf as WorkflowRow).trigger;
  if (trigger?.type !== "schedule" || typeof trigger.cron !== "string") return;
  await queueNextTick(wf as WorkflowRow, new Date());
}

async function queueNextTick(wf: WorkflowRow, after: Date): Promise<void> {
  const { cron, timezone } = wf.trigger as { cron: string; timezone?: string };
  let next: Date;
  try {
    next = nextCronDate(cron, timezone, after);
  } catch (err: any) {
    console.error(`[Workflows] Workflow ${wf.id} has an invalid cron "${cron}": ${err?.message || err}`);
    return;
  }
  await enqueueJob(
    "workflow.schedule_tick",
    { workflowId: wf.id, cron },
    { orgId: wf.org_id, runAt: next, maxAttempts: 3, dedupeKey: `${scheduleKeyPrefix(wf.id)}${next.toISOString()}` }
  );
}

async function runScheduleTick(orgId: string, workflowId: string, cron: string): Promise<void> {
  const wf = await workflowsDb.get(orgId, workflowId);
  // Stale tick: the workflow was deleted, disabled or rescheduled after this job was queued.
  if (!wf || !wf.enabled || wf.trigger?.type !== "schedule" || wf.trigger?.cron !== cron) return;

  await queueNextTick(wf, new Date(Date.now() + 1_000));

  const parsed = parseStoredDefinition(wf);
  const scope: ChainScope = { depth: 1, chain: [wf.id] };
  const payload = { orgId, scheduledAt: nowIso(), cron };
  if (!parsed.ok || parsed.definition.trigger.type !== "schedule" || parsed.definition.trigger.scope !== "leads") {
    await runWorkflow(wf, { event: "schedule", payload }, { scope });
    return;
  }

  const leads = await loadRecentLeads(orgId, SCHEDULE_LEAD_SCAN_LIMIT);
  let runs = 0;
  for (const lead of leads) {
    if (runs >= SCHEDULE_MAX_RUNS) break;
    const result = await runWorkflow(
      wf,
      { event: "schedule", payload: { ...payload, leadId: lead.id } },
      { scope, lead, deal: null, recordSkipped: false }
    );
    if (result) runs++;
  }
}

/** Queues a tick for every enabled schedule workflow that has none (after a restart or a lost job). */
async function bootstrapSchedules(): Promise<void> {
  const rows = await workflowsDb.listEnabledByTrigger("schedule");
  for (const wf of rows) {
    if (await workflowsDb.hasQueuedJob(wf.org_id, "workflow.schedule_tick", scheduleKeyPrefix(wf.id))) continue;
    await queueNextTick(wf, new Date());
  }
}

// ---- Dry run ---------------------------------------------------------------------------------

/** A representative event payload for testing a trigger against a real lead/deal. */
export function syntheticTriggerPayload(
  orgId: string,
  trigger: Record<string, any>,
  lead: Record<string, any> | null,
  deal: Record<string, any> | null
): TriggerInput {
  const base = { orgId, actorId: null, leadId: lead?.id ?? deal?.lead_id ?? null, dealId: deal?.id ?? null };
  switch (trigger?.type as TriggerType) {
    case "lead.created":
      return { event: "lead.created", payload: { ...base, source: lead?.source ?? null } };
    case "lead.status_changed":
      return {
        event: "lead.status_changed",
        payload: { ...base, from: trigger.from ?? lead?.status ?? null, to: trigger.to ?? lead?.status ?? null },
      };
    case "lead.score_above":
      return { event: "lead.score_changed", payload: { ...base, from: null, to: lead?.score ?? 0 } };
    case "deal.stage_changed":
      return {
        event: "deal.stage_changed",
        payload: { ...base, from: trigger.from ?? deal?.stage ?? null, to: trigger.to ?? deal?.stage ?? null },
      };
    case "campaign.replied":
      return {
        event: "campaign.replied",
        payload: { ...base, campaignId: trigger.campaignId ?? null, messageId: "test", channel: trigger.channel ?? "email" },
      };
    case "agent.run_completed":
      return {
        event: "agent.run_completed",
        payload: { ...base, runId: "test", status: trigger.status ?? "completed", leadsCreated: 0, signalsFound: 0 },
      };
    default:
      return { event: "schedule", payload: { ...base, scheduledAt: nowIso(), cron: trigger?.cron ?? null } };
  }
}

/** Dry run: evaluates conditions and previews every action without writing anything except the test run record. */
export async function testWorkflow(
  wf: WorkflowRow,
  input: { leadId?: string | null; dealId?: string | null }
): Promise<RunResult> {
  const deal = await loadDeal(wf.org_id, input.dealId);
  const lead = await loadLead(wf.org_id, input.leadId ?? deal?.lead_id);
  const trigger = syntheticTriggerPayload(wf.org_id, wf.trigger, lead, deal);
  const result = await runWorkflow(wf, trigger, { dryRun: true, lead, deal, scope: { depth: MAX_CHAIN_DEPTH, chain: [wf.id] } });
  return result!;
}

// ---- Wiring ----------------------------------------------------------------------------------

events.onAny((event) => handleEvent(event));

registerJobHandler("workflow.delayed_action", async (payload, { orgId }) => {
  if (!orgId) throw new PermanentJobError("workflow.delayed_action job has no org_id");
  await resumeDelayedRun(orgId, payload.workflowId, payload.runId, payload.stepPosition);
});

registerJobHandler(
  "workflow.schedule_tick",
  async (payload, { orgId }) => {
    if (!orgId) throw new PermanentJobError("workflow.schedule_tick job has no org_id");
    await runScheduleTick(orgId, payload.workflowId, payload.cron);
  },
  { backoffMs: () => 60_000 }
);

if (isDbConfigured && process.env.NODE_ENV !== "test") {
  setTimeout(() => {
    bootstrapSchedules().catch((err) => console.error(`[Workflows] Schedule bootstrap failed: ${err?.message || err}`));
  }, 5_000).unref();
}
