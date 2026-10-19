import { z } from "zod";
import { agentsDb, type AgentExecutionRow, type PipelineRunRow } from "@ai-lead-gen/database";
import { DISCOVERY_AGENT_ID, DISCOVERY_AGENT_NAME, STEPS } from "../../../../services/discovery/agent";
import {
  computeRunStats,
  DEFAULT_MAX_RESULTS,
  DISCOVERY_SOURCES,
  MAX_RESULTS_LIMIT,
  type RunTotals,
} from "../../../../services/discovery/postprocess";
import { agentConfigStatus, agentRunLimit, failStaleRuns, runSources, startDiscoveryRun } from "../agents/discovery";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { parsePagination, send, sendPage } from "../http/pagination";
import { parse } from "../http/validate";
import { getCtx } from "../middleware/auth";

/** Mounted at /api/agents behind requireAuth(); owned by the AI Agents module. */
export const agentsRouter = createRouter();

export const runDiscoverySchema = z
  .object({
    query: z.string().trim().min(2, "Enter what to search for").max(200),
    /** Empty searches without a location. */
    location: z
      .string()
      .trim()
      .max(120)
      .refine((l) => l === "" || l.length >= 2, "Enter a city or area, or leave it empty")
      .default(""),
    sources: z
      .array(z.enum(DISCOVERY_SOURCES))
      .min(1, "Pick at least one source")
      .default([...DISCOVERY_SOURCES])
      .transform((s) => Array.from(new Set(s))),
    maxResults: z.coerce.number().int().min(1).max(MAX_RESULTS_LIMIT).default(DEFAULT_MAX_RESULTS),
  })
  .strict();

const statsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });
const logsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.string().datetime({ offset: true }).optional(),
  runId: z.string().regex(/^[\w-]{1,64}$/, "Invalid run id").optional(),
});
const runListQuery = z.object({
  status: z.enum(["queued", "running", "completed", "completed_with_errors", "failed"]).optional(),
});

const AGENT_DESCRIPTION =
  "Finds leads for any business niche in a city: public posts from people asking for your product or service " +
  "(web) and public business listings from Google Maps (places). Sarvam scores every result and duplicates of " +
  "existing leads are skipped. Personal phone numbers and emails are never collected, except when the author " +
  "published one in a post asking to be contacted.";

function requireAgent(id: string) {
  if (id !== DISCOVERY_AGENT_ID) throw HttpError.notFound("Agent");
}

function parseRunId(value: unknown): string {
  if (typeof value !== "string" || !/^[\w-]{1,64}$/.test(value)) throw HttpError.badRequest("Invalid run id.");
  return value;
}

function toRunDto(run: PipelineRunRow, totals?: RunTotals & { duplicates?: number; errors?: string[] }) {
  return {
    id: run.id,
    agentId: DISCOVERY_AGENT_ID,
    query: run.query,
    location: run.location,
    sources: runSources(run),
    maxResults: run.target_count,
    status: run.status,
    resultsFound: run.total_leads_found ?? 0,
    highScore: run.high_score_leads ?? 0,
    leadsCreated: totals?.leadsCreated ?? null,
    signalsSaved: totals?.signalsSaved ?? null,
    duplicates: totals?.duplicates ?? null,
    errorCount: totals?.errors?.length ?? null,
    durationMs: run.duration_ms,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    createdAt: run.created_at,
  };
}

function toStepDto(e: AgentExecutionRow) {
  const { leadIds, signalIds, ...output } = e.output || {};
  return {
    id: e.id,
    step: e.agent_id,
    name: e.agent_name,
    status: e.status,
    input: e.input,
    output: e.output ? output : null,
    error: e.error,
    durationMs: e.duration_ms,
    tokensUsed: e.tokens_used,
    startedAt: e.started_at,
    completedAt: e.completed_at,
  };
}

function totalsOf(output: Record<string, any> | null | undefined) {
  if (!output) return undefined;
  return {
    leadsCreated: Number(output.leadsCreated) || 0,
    signalsSaved: Number(output.signalsSaved) || 0,
    duplicates: Number(output.duplicates) || 0,
    errors: Array.isArray(output.errors) ? output.errors.map(String) : [],
  };
}

async function totalsByRun(orgId: string, runIds: string[]) {
  const saves = await agentsDb.listStepExecutions(orgId, STEPS.save, runIds);
  const map = new Map<string, NonNullable<ReturnType<typeof totalsOf>>>();
  for (const s of saves) {
    const t = totalsOf(s.output);
    if (t) map.set(s.pipeline_run_id, t);
  }
  return map;
}

async function agentStats(orgId: string, days?: number) {
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;
  const runs = await agentsDb.listRunStats(orgId, { since });
  const totals = await totalsByRun(
    orgId,
    runs.map((r) => r.id)
  );
  return { ...computeRunStats(runs, totals as Map<string, RunTotals>), days: days ?? null };
}

async function agentDto(orgId: string, withStats: boolean) {
  const [config, active] = await Promise.all([agentConfigStatus(orgId), agentsDb.countActiveRuns(orgId)]);
  const configured = config.serperConfigured && config.sarvamConfigured;
  return {
    id: DISCOVERY_AGENT_ID,
    name: DISCOVERY_AGENT_NAME,
    type: "AI Agent",
    description: AGENT_DESCRIPTION,
    status: active > 0 ? "running" : configured ? "active" : "not_configured",
    activeRuns: active,
    sources: [...DISCOVERY_SOURCES],
    maxResultsLimit: MAX_RESULTS_LIMIT,
    defaultMaxResults: DEFAULT_MAX_RESULTS,
    ...config,
    stats: withStats ? await agentStats(orgId) : null,
  };
}

// GET /api/agents — the agent catalog (one unified discovery agent)
agentsRouter.get("/", async (req, res) => {
  const { orgId } = getCtx(req);
  await failStaleRuns(orgId);
  send(res, [await agentDto(orgId, true)]);
});

// GET /api/agents/:id
agentsRouter.get("/:id", async (req, res) => {
  requireAgent(req.params.id);
  const { orgId } = getCtx(req);
  await failStaleRuns(orgId);
  send(res, await agentDto(orgId, true));
});

// GET /api/agents/:id/stats?days= — runs, success rate, average duration, leads/signals found
agentsRouter.get("/:id/stats", async (req, res) => {
  requireAgent(req.params.id);
  const { days } = parse(statsQuery, req.query);
  send(res, await agentStats(getCtx(req).orgId, days));
});

// GET /api/agents/:id/logs?limit=&before=&runId= — newest first
agentsRouter.get("/:id/logs", async (req, res) => {
  requireAgent(req.params.id);
  const { limit, before, runId } = parse(logsQuery, req.query);
  const logs = await agentsDb.listLogs(getCtx(req).orgId, req.params.id, { limit, before, runId });
  send(
    res,
    logs.map((l) => ({ id: l.id, level: l.level, message: l.message, createdAt: l.created_at }))
  );
});

// POST /api/agents/:id/runs — body {query, location?, sources?, maxResults?}; 202 with the queued run
agentsRouter.post("/:id/runs", agentRunLimit, async (req, res) => {
  requireAgent(req.params.id);
  const { orgId, userId } = getCtx(req);
  const input = parse(runDiscoverySchema, req.body);
  const run = await startDiscoveryRun(orgId, userId, input);
  send(res, toRunDto(run), 202);
});

// GET /api/agents/:id/runs?page=&pageSize=&sort=&status= — run history
agentsRouter.get("/:id/runs", async (req, res) => {
  requireAgent(req.params.id);
  const { orgId } = getCtx(req);
  const page = parsePagination(req.query, {
    sortable: { createdAt: "created_at", durationMs: "duration_ms", resultsFound: "total_leads_found", status: "status" },
    defaultSort: "createdAt:desc",
  });
  const { status } = parse(runListQuery, { status: req.query.status || undefined });
  await failStaleRuns(orgId);
  const { rows, total } = await agentsDb.listRuns(orgId, page, { status });
  const totals = await totalsByRun(
    orgId,
    rows.map((r) => r.id)
  );
  sendPage(
    res,
    rows.map((r) => toRunDto(r, totals.get(r.id))),
    total,
    page
  );
});

// GET /api/agents/:id/runs/:runId — run detail: steps, errors, created leads and saved signals
agentsRouter.get("/:id/runs/:runId", async (req, res) => {
  requireAgent(req.params.id);
  const { orgId } = getCtx(req);
  const runId = parseRunId(req.params.runId);
  const run = await agentsDb.getRun(orgId, runId);
  if (!run) throw HttpError.notFound("Run");
  const executions = await agentsDb.listExecutions(orgId, runId);
  const save = executions.find((e) => e.agent_id === STEPS.save);
  const totals = totalsOf(save?.output);
  const leadIds: string[] = Array.isArray(save?.output?.leadIds) ? save!.output!.leadIds.map(String) : [];
  const signalIds: string[] = Array.isArray(save?.output?.signalIds) ? save!.output!.signalIds.map(String) : [];
  const [leads, signals] = await Promise.all([agentsDb.getLeadsByIds(orgId, leadIds), agentsDb.getSignalsByIds(orgId, signalIds)]);
  const errors = totals?.errors?.length
    ? totals.errors
    : executions.filter((e) => e.error).map((e) => `${e.agent_name}: ${e.error}`);
  send(res, {
    run: toRunDto(run, totals),
    steps: executions.map(toStepDto),
    errors,
    leads: leads.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)),
    signals: signals.sort(
      (a, b) =>
        Number(Boolean(b.contact_requested)) - Number(Boolean(a.contact_requested)) ||
        Number(b.intent_score ?? 0) - Number(a.intent_score ?? 0)
    ),
  });
});
