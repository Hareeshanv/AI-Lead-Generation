import { agentsDb, DEFAULT_SCORING, settingsDb, type PipelineRunRow, type ScoringThresholds } from "@ai-lead-gen/database";
import {
  DISCOVERY_AGENT_ID,
  DISCOVERY_CAMPAIGN,
  STEPS,
  runLeadDiscovery,
} from "../../../../services/discovery/agent";
import { SarvamTransportError, type SarvamConfig, type SarvamTransport } from "../../../../services/sarvam";
import {
  buildVocabulary,
  DEFAULT_DISCOVERY_SETTINGS,
  normalizeDiscoverySettings,
  type DiscoverySettings,
  type SearchVocabulary,
} from "../../../../services/search/vocabulary";
import {
  AGENT_LEAD_SOURCE,
  DISCOVERY_SOURCES,
  indexLeadsBySignalKeys,
  signalLeadKeys,
  signalToLeadRow,
  type DiscoverySource,
} from "../../../../services/discovery/postprocess";
import { events, type EventBase } from "../events";
import { HttpError } from "../http/errors";
import { rateLimit } from "../http/rateLimit";
import { getProviderCredentials } from "../integrations/credentials";
import { OutboundHttpError, safePost } from "../integrations/safeHttp";
import { enqueueJob, PermanentJobError, registerJobHandler } from "../jobs/registry";
import { scoredFields } from "../services/leads/service";

declare module "../events" {
  interface DomainEventMap {
    "agent.run_failed": EventBase & { runId: string; error: string };
  }
}

declare module "../jobs/registry" {
  interface JobPayloadMap {
    /** Executes a queued discovery run; query, location, sources and limits live on the run row. */
    "agent.run": { runId: string; actorId: string | null };
  }
}

export const AGENT_RUN_JOB = "agent.run" as const;
/** Runs still queued/running after this long are treated as crashed. */
const STALE_RUN_MS = 30 * 60 * 1000;
const MAX_ACTIVE_RUNS_PER_ORG = 2;

/** Agent runs are slow and cost API credits: 10 per org per 10 minutes. */
export const agentRunLimit = rateLimit({ name: "agent-run", windowMs: 10 * 60 * 1000, max: 10 });

export interface AgentCredentials {
  serperApiKey: string;
  sarvam: SarvamConfig & { apiKey: string };
}

/** Chat completion replies are far larger than safeHttp's 64 KB default. */
const SARVAM_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Sarvam requests through safeHttp: the workspace base URL is re-validated (https, public address,
 * connection pinned) on every request, so it cannot be pointed at internal services.
 */
export const safeSarvamTransport: SarvamTransport = async ({ url, headers, body, timeoutMs }) => {
  try {
    const res = await safePost(url, body, { headers, timeoutMs, maxResponseBytes: SARVAM_MAX_RESPONSE_BYTES, maxRedirects: 0 });
    if (res.truncated) throw new SarvamTransportError("the response was too large", false);
    return { status: res.status, body: res.body };
  } catch (err) {
    if (err instanceof OutboundHttpError) throw new SarvamTransportError(err.message, true);
    throw err;
  }
};

/** A workspace-supplied base URL always goes through the safe transport; the server default uses fetch. */
function toSarvamConfig(credentials: Record<string, string>): SarvamConfig & { apiKey: string } {
  const baseUrl = credentials.baseUrl?.trim() || null;
  return { apiKey: credentials.apiKey, baseUrl, model: credentials.model || null, transport: baseUrl ? safeSarvamTransport : null };
}

/** Workspace Sarvam credentials, or null when no API key is set. */
export async function workspaceSarvamConfig(orgId: string): Promise<(SarvamConfig & { apiKey: string }) | null> {
  const sarvam = await getProviderCredentials(orgId, "sarvam");
  return sarvam?.apiKey ? toSarvamConfig(sarvam) : null;
}

export async function agentConfigStatus(orgId: string): Promise<{ serperConfigured: boolean; sarvamConfigured: boolean }> {
  const [serper, sarvam] = await Promise.all([
    getProviderCredentials(orgId, "serper"),
    getProviderCredentials(orgId, "sarvam"),
  ]);
  return { serperConfigured: Boolean(serper?.apiKey), sarvamConfigured: Boolean(sarvam?.apiKey) };
}

/** Workspace Serper + Sarvam credentials; 422 NOT_CONFIGURED naming whatever is missing. */
export async function requireAgentCredentials(orgId: string): Promise<AgentCredentials> {
  const [serper, sarvam] = await Promise.all([
    getProviderCredentials(orgId, "serper"),
    getProviderCredentials(orgId, "sarvam"),
  ]);
  const missing = [!serper?.apiKey && "Serper (web and places search)", !sarvam?.apiKey && "Sarvam (AI scoring)"].filter(
    (m): m is string => Boolean(m)
  );
  if (missing.length > 0) {
    throw HttpError.notConfigured(
      `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not configured. Add the API key${missing.length > 1 ? "s" : ""} under Integrations.`
    );
  }
  return {
    serperApiKey: serper!.apiKey,
    sarvam: toSarvamConfig(sarvam!),
  };
}

export function runSources(run: Pick<PipelineRunRow, "category">): DiscoverySource[] {
  const parts = String(run.category || "")
    .split(",")
    .map((s) => s.trim());
  const sources = DISCOVERY_SOURCES.filter((s) => parts.includes(s));
  // Runs recorded before places existed were web-only.
  return sources.length > 0 ? sources : ["web"];
}

export async function failStaleRuns(orgId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const ids = await agentsDb
    .failStaleRuns(orgId, cutoff, "The run did not finish (the server stopped or the job timed out).")
    .catch((err) => {
      console.warn(`[Agents] Could not fail stale runs: ${err?.message || err}`);
      return [] as string[];
    });
  for (const runId of ids) events.emit("agent.run_failed", { orgId, actorId: null, runId, error: "Run timed out" });
}

export interface StartRunInput {
  query: string;
  location: string;
  sources: DiscoverySource[];
  maxResults: number;
}

/** Validates credentials, records a queued run and enqueues the "agent.run" job. */
export async function startDiscoveryRun(orgId: string, actorId: string | null, input: StartRunInput): Promise<PipelineRunRow> {
  await requireAgentCredentials(orgId);
  await failStaleRuns(orgId);
  if ((await agentsDb.countActiveRuns(orgId)) >= MAX_ACTIVE_RUNS_PER_ORG) {
    throw HttpError.conflict("Discovery runs are already in progress. Wait for one to finish before starting another.");
  }

  const run = await agentsDb.createRun(orgId, {
    campaign_name: DISCOVERY_CAMPAIGN,
    query: input.query,
    location: input.location || null,
    category: input.sources.join(","),
    target_count: input.maxResults,
    status: "queued",
  });
  try {
    await enqueueJob(AGENT_RUN_JOB, { runId: run.id, actorId }, { orgId, maxAttempts: 1, dedupeKey: `agent.run:${run.id}` });
  } catch (err: any) {
    await agentsDb.updateRun(orgId, run.id, { status: "failed", completed_at: new Date().toISOString() }).catch(() => null);
    throw err;
  }
  await agentsDb.log(orgId, DISCOVERY_AGENT_ID, "info", `[${run.id}] Queued "${input.query}"${input.location ? ` in ${input.location}` : ""}`);
  events.emit("agent.run_started", { orgId, actorId, runId: run.id, query: input.query, location: input.location });
  return run;
}

export interface DiscoveryWorkspaceSettings {
  thresholds: ScoringThresholds;
  discovery: DiscoverySettings;
}

/** Scoring thresholds and discovery settings; defaults when the settings row cannot be read. */
export async function discoveryWorkspaceSettings(orgId: string): Promise<DiscoveryWorkspaceSettings> {
  try {
    const settings = await settingsDb.get(orgId);
    return { thresholds: settings.scoring, discovery: normalizeDiscoverySettings(settings.discovery) };
  } catch {
    return { thresholds: DEFAULT_SCORING, discovery: DEFAULT_DISCOVERY_SETTINGS };
  }
}

/** The workspace's interest/city vocabulary for matching course and city filters. */
export async function workspaceVocabulary(orgId: string): Promise<SearchVocabulary> {
  return buildVocabulary((await discoveryWorkspaceSettings(orgId)).discovery);
}

registerJobHandler(AGENT_RUN_JOB, async ({ runId, actorId }, ctx) => {
  const orgId = ctx.orgId;
  if (!orgId) throw new PermanentJobError("agent.run job has no org id");
  const run = await agentsDb.claimRun(orgId, runId);
  if (!run) return; // already started by another worker, or deleted

  try {
    const credentials = await requireAgentCredentials(orgId);
    const { thresholds, discovery } = await discoveryWorkspaceSettings(orgId);
    const result = await runLeadDiscovery({
      orgId,
      runId,
      query: run.query,
      location: run.location || "",
      sources: runSources(run),
      maxResults: run.target_count || 30,
      serperApiKey: credentials.serperApiKey,
      sarvam: credentials.sarvam,
      thresholds,
      discovery,
      scoreRow: (row) => ({ ...row, ...scoredFields(row, thresholds, false) }),
    });

    await agentsDb.updateRun(orgId, runId, {
      status: result.status,
      total_leads_found: result.leadsCreated + result.signalsSaved,
      high_score_leads: result.highScore,
      duration_ms: result.durationMs,
      tokens_used: result.tokensUsed,
      completed_at: new Date().toISOString(),
    });

    for (const lead of result.leads) {
      events.emit("lead.created", { orgId, actorId, leadId: lead.id, source: lead.source ?? AGENT_LEAD_SOURCE });
    }
    if (result.status === "failed") {
      events.emit("agent.run_failed", { orgId, actorId, runId, error: result.errors[0] || "Run failed" });
    } else {
      events.emit("agent.run_completed", {
        orgId,
        actorId,
        runId,
        status: result.status,
        leadsCreated: result.leadsCreated,
        signalsFound: result.signalsSaved,
      });
    }
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 2000);
    await agentsDb
      .logExecution(orgId, {
        pipeline_run_id: runId,
        agent_id: STEPS.run,
        agent_name: "Run",
        status: "failed",
        input: null,
        output: null,
        error: message,
        duration_ms: run.started_at ? Date.now() - new Date(run.started_at).getTime() : 0,
        tokens_used: 0,
      })
      .catch(() => null);
    await agentsDb
      .updateRun(orgId, runId, {
        status: "failed",
        duration_ms: run.started_at ? Date.now() - new Date(run.started_at).getTime() : null,
        completed_at: new Date().toISOString(),
      })
      .catch(() => null);
    await agentsDb.log(orgId, DISCOVERY_AGENT_ID, "error", `[${runId}] Run failed: ${message}`);
    events.emit("agent.run_failed", { orgId, actorId, runId, error: message });
    throw new PermanentJobError(message);
  }
});

export interface ConvertedSignal {
  signalId: string;
  leadId: string;
  created: boolean;
}

/**
 * Creates a lead from each intent signal (or links the existing lead with the same post URL,
 * email or phone) and marks the signals routed. Unknown ids are reported as missing.
 */
export async function convertSignalsToLeads(
  orgId: string,
  actorId: string | null,
  signalIds: string[]
): Promise<{ results: ConvertedSignal[]; created: number; existing: number; missing: string[] }> {
  const ids = Array.from(new Set(signalIds));
  const signals = await agentsDb.getSignalsByIds(orgId, ids);
  const found = new Set(signals.map((s) => String(s.id)));
  const missing = ids.filter((id) => !found.has(id));
  if (signals.length === 0) return { results: [], created: 0, existing: 0, missing };

  const { thresholds } = await discoveryWorkspaceSettings(orgId);
  const now = new Date().toISOString();
  const index = indexLeadsBySignalKeys(await agentsDb.listLeadContacts(orgId));

  const results: ConvertedSignal[] = [];
  const toInsert: { signalId: string; row: Record<string, any> }[] = [];
  for (const signal of signals) {
    const base = signalToLeadRow(signal, thresholds, now);
    const row: Record<string, any> = { ...base, ...scoredFields(base, thresholds, false) };
    const keys = signalLeadKeys(row);
    const existingId = keys.map((k) => index.get(k)).find(Boolean);
    if (existingId) {
      results.push({ signalId: String(signal.id), leadId: existingId, created: false });
      continue;
    }
    for (const k of keys) index.set(k, `pending:${signal.id}`);
    toInsert.push({ signalId: String(signal.id), row });
  }

  if (toInsert.length > 0) {
    const { inserted } = await agentsDb.insertLeads(
      orgId,
      toInsert.map((t) => t.row)
    );
    const byUrl = new Map(inserted.map((l) => [String(l.profile_url), l]));
    for (const { signalId, row } of toInsert) {
      const lead = byUrl.get(String(row.profile_url));
      if (!lead) continue;
      results.push({ signalId, leadId: String(lead.id), created: true });
      events.emit("lead.created", { orgId, actorId, leadId: String(lead.id), source: AGENT_LEAD_SOURCE });
    }
  }
  // Leads pending on another signal in this batch (same contact) point at that lead.
  const leadBySignal = new Map(results.map((r) => [r.signalId, r.leadId]));
  for (const r of results) {
    if (r.leadId.startsWith("pending:")) r.leadId = leadBySignal.get(r.leadId.slice("pending:".length)) ?? r.leadId;
  }
  const resolved = results.filter((r) => !r.leadId.startsWith("pending:"));

  await agentsDb.setSignalsStatus(
    orgId,
    resolved.map((r) => r.signalId),
    "routed"
  );
  return {
    results: resolved,
    created: resolved.filter((r) => r.created).length,
    existing: resolved.filter((r) => !r.created).length,
    missing,
  };
}
