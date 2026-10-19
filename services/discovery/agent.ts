/**
 * Lead Discovery Agent: query + location for any business niche.
 * - "web":    Serper /search over public posts -> Sarvam classification -> redacted intent_signals
 *             (upserted on post_url). A phone/email is stored only when the same post explicitly asks
 *             to be contacted and publishes it (verified in code by requestedContactFromText).
 * - "places": Serper /places public business listings -> Sarvam fit scoring -> deduplicated leads
 *             (source "AI Agent", tagged with the run id).
 * Every step is recorded in agent_executions for the pipeline run; the caller owns the run row.
 */

import { agentsDb, dbQueries } from "@ai-lead-gen/database";
import { sarvamClient, type SarvamConfig } from "../sarvam";
import { redactContactDetails, type IntentSignalRow } from "../signals";
import { canonicalCity, cityAliases, sanitizeFilterValue } from "../search/queryParser";
import { buildQueries, platformFromUrl, searchPlaces, searchSerper, type SerperPlace } from "./serper";
import {
  buildExistingKeySet,
  buildPlaceLeadRow,
  buildSignalRows,
  byPriority,
  dedupeLeadCandidates,
  interleave,
  parsePlaceScores,
  placeFitScore,
  selectRows,
  uniquePlaces,
  type Candidate,
  type DiscoverySource,
  type PlaceScore,
  type ScoringThresholds,
} from "./postprocess";

export const DISCOVERY_AGENT_ID = "agt-discovery";
export const DISCOVERY_AGENT_NAME = "Lead Discovery Agent";
export const DISCOVERY_CAMPAIGN = "Lead Discovery";

/** agent_executions.agent_id of each step; SAVE_STEP holds the run totals. */
export const STEPS = {
  webSearch: "serper-web",
  classify: "sarvam-classify",
  placesSearch: "serper-places",
  placesScore: "sarvam-score-places",
  save: "dedupe-save",
  run: "run",
} as const;

const WEB_BATCH_SIZE = 10;
const PLACE_BATCH_SIZE = 15;
const SARVAM_CONCURRENCY = 3;
const SARVAM_TIMEOUT_MS = 120_000;
/** Most web results are dropped as non-customers, so more candidates than results are classified. */
const MAX_WEB_CANDIDATES = 120;
const MAX_PLACE_PAGES = 5;
const HIGH_SCORE = 80;

export interface LeadDiscoveryParams {
  orgId: string;
  runId: string;
  query: string;
  location: string;
  sources: DiscoverySource[];
  /** Per source. */
  maxResults: number;
  serperApiKey: string;
  sarvam: SarvamConfig;
  thresholds: ScoringThresholds;
}

export interface LeadDiscoveryResult {
  status: "completed" | "completed_with_errors" | "failed";
  searched: { web: number; places: number };
  leadsCreated: number;
  duplicates: number;
  signalsSaved: number;
  highScore: number;
  /** Inserted leads (id + source) so the caller can emit lead.created. */
  leads: { id: string; source: string | null }[];
  signalIds: string[];
  errors: string[];
  tokensUsed: number;
  durationMs: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)) || "unknown error";

export async function runLeadDiscovery(params: LeadDiscoveryParams): Promise<LeadDiscoveryResult> {
  const { orgId, runId } = params;
  const start = Date.now();
  const query = sanitizeFilterValue(params.query);
  const city = canonicalCity(params.location) || sanitizeFilterValue(params.location);
  const aliases = cityAliases(city);
  const now = new Date().toISOString();
  const errors: string[] = [];
  let tokensUsed = 0;

  const log = (level: "info" | "warn" | "error", message: string) =>
    agentsDb.log(orgId, DISCOVERY_AGENT_ID, level, `[${runId}] ${message}`);

  /** Times one step and records it in agent_executions; recording failures never break the run. */
  async function step<T>(
    agentId: string,
    agentName: string,
    input: Record<string, any>,
    fn: () => Promise<{ value: T; output: Record<string, any>; error?: string | null; tokens?: number }>
  ): Promise<T | null> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let status = "completed";
    let output: Record<string, any> | null = null;
    let error: string | null = null;
    let tokens = 0;
    let value: T | null = null;
    try {
      const r = await fn();
      value = r.value;
      output = r.output;
      tokens = r.tokens ?? 0;
      if (r.error) {
        error = r.error;
        status = "completed_with_errors";
      }
    } catch (err) {
      status = "failed";
      error = errorText(err);
      errors.push(`${agentName}: ${error}`);
    }
    tokensUsed += tokens;
    await agentsDb
      .logExecution(orgId, {
        pipeline_run_id: runId,
        agent_id: agentId,
        agent_name: agentName,
        status,
        input,
        output,
        error,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
        tokens_used: tokens,
      })
      .catch((err) => console.warn(`[Discovery] Could not record step ${agentId}: ${errorText(err)}`));
    await log(status === "failed" ? "error" : status === "completed" ? "info" : "warn", `${agentName}: ${status}${error ? ` (${error})` : ""}`);
    return value;
  }

  await log("info", `Started: "${query}" in ${city} (sources: ${params.sources.join(", ")}, up to ${params.maxResults} per source)`);

  // ---- Web: public posts -> intent signals --------------------------------------------------
  let webSearched = 0;
  let signals: any[] = [];
  if (params.sources.includes("web")) {
    const candidates =
      (await step(STEPS.webSearch, "Web search (Serper)", { query, city }, async () => {
        const queries = buildQueries(query, city);
        const perQuery = params.maxResults > 50 ? 20 : 10;
        const searches = await Promise.allSettled(queries.map((q) => searchSerper(params.serperApiKey, q.q, perQuery)));
        const stepErrors: string[] = [];
        const lists: Candidate[][] = searches.map((s, i) => {
          if (s.status === "rejected") {
            stepErrors.push(`${queries[i].platform}: ${errorText(s.reason)}`);
            return [];
          }
          return s.value.map((r) => ({ ...r, platform: platformFromUrl(r.link) }));
        });
        if (stepErrors.length === queries.length) throw new Error(stepErrors[0]);
        errors.push(...stepErrors.map((e) => `Web search ${e}`));
        const picked = interleave(lists, Math.min(params.maxResults * 2, MAX_WEB_CANDIDATES));
        return {
          value: picked,
          output: { queries: queries.length, results: lists.reduce((n, l) => n + l.length, 0), candidates: picked.length },
          error: stepErrors.length ? stepErrors.join("; ") : null,
        };
      })) ?? [];
    webSearched = candidates.length;

    if (candidates.length > 0) {
      const rows =
        (await step(STEPS.classify, "Intent classification (Sarvam)", { candidates: candidates.length }, async () => {
          const batches = chunk(candidates, WEB_BATCH_SIZE);
          const stepErrors: string[] = [];
          let tokens = 0;
          const perBatch = await mapLimit(batches, SARVAM_CONCURRENCY, async (batch, b) => {
            const response = await sarvamClient.callAgent({
              agentId: DISCOVERY_AGENT_ID,
              config: params.sarvam,
              timeoutMs: SARVAM_TIMEOUT_MS,
              input: {
                query,
                city,
                city_aliases: aliases,
                results: batch.map((c, index) => ({
                  index,
                  platform: c.platform,
                  url: c.link,
                  title: redactContactDetails(c.title),
                  snippet: redactContactDetails(c.snippet),
                  date: c.date,
                })),
              },
            });
            tokens += response.tokensUsed || 0;
            if (!response.success) {
              stepErrors.push(`Batch ${b + 1}/${batches.length}: ${response.error || "Sarvam call failed"}`);
              return [] as IntentSignalRow[];
            }
            const items: unknown[] = Array.isArray(response.output?.results)
              ? response.output.results
              : Array.isArray(response.output?.leads)
                ? response.output.leads
                : [];
            if (items.length === 0) stepErrors.push(`Batch ${b + 1}/${batches.length}: Sarvam returned no classifications`);
            return buildSignalRows(batch, items, { query, city, cityAliases: aliases, now });
          });
          if (stepErrors.length === batches.length) throw new Error(stepErrors[0]);
          errors.push(...stepErrors.map((e) => `Intent classification ${e}`));
          const kept = selectRows(perBatch.flat(), params.maxResults);
          return {
            value: kept,
            output: { batches: batches.length, prospective: perBatch.flat().length, kept: kept.length },
            error: stepErrors.length ? stepErrors.join("; ") : null,
            tokens,
          };
        })) ?? [];

      if (rows.length > 0) {
        try {
          signals = (await dbQueries.upsertIntentSignals(orgId, rows)).sort(byPriority);
        } catch (err) {
          errors.push(`Could not save signals: ${errorText(err)}`);
        }
      }
    }
  }

  // ---- Places: business listings -> leads ---------------------------------------------------
  let placesSearched = 0;
  let scoredPlaces: { place: SerperPlace; scored: PlaceScore }[] = [];
  if (params.sources.includes("places")) {
    const places =
      (await step(STEPS.placesSearch, "Places search (Serper)", { query, city }, async () => {
        const q = `${query} in ${city}`;
        const target = Math.min(params.maxResults * 2, MAX_PLACE_PAGES * 20);
        const found: SerperPlace[] = [];
        let pages = 0;
        for (let page = 1; page <= MAX_PLACE_PAGES && found.length < target; page++) {
          const batch = await searchPlaces(params.serperApiKey, q, page);
          pages++;
          const before = uniquePlaces(found).length;
          found.push(...batch);
          if (batch.length === 0 || uniquePlaces(found).length === before) break;
        }
        const unique = uniquePlaces(found).slice(0, target);
        return { value: unique, output: { q, pages, results: unique.length } };
      })) ?? [];
    placesSearched = places.length;

    if (places.length > 0) {
      scoredPlaces =
        (await step(STEPS.placesScore, "Business fit scoring (Sarvam)", { listings: places.length }, async () => {
          const batches = chunk(places, PLACE_BATCH_SIZE);
          const stepErrors: string[] = [];
          let tokens = 0;
          const perBatch = await mapLimit(batches, SARVAM_CONCURRENCY, async (batch, b) => {
            const response = await sarvamClient.callAgent({
              agentId: "agt-place-scoring",
              config: params.sarvam,
              timeoutMs: SARVAM_TIMEOUT_MS,
              input: {
                query,
                city,
                businesses: batch.map((p, index) => ({
                  index,
                  name: p.title,
                  category: p.category,
                  address: p.address,
                  rating: p.rating,
                  rating_count: p.ratingCount,
                  has_website: Boolean(p.website),
                  has_phone: Boolean(p.phoneNumber),
                })),
              },
            });
            tokens += response.tokensUsed || 0;
            const items: unknown[] = response.success && Array.isArray(response.output?.results) ? response.output.results : [];
            if (items.length === 0) {
              stepErrors.push(
                `Batch ${b + 1}/${batches.length}: ${response.error || "Sarvam returned no scores"}; used rule-based scores`
              );
              return batch.map((place) => ({ place, scored: { score: placeFitScore(place), reason: null, scoredBy: "rules" as const } }));
            }
            const scores = parsePlaceScores(items, batch.length);
            return batch.flatMap((place, i) => {
              const s = scores.get(i);
              if (s === null) return [];
              return [{ place, scored: s ?? { score: placeFitScore(place), reason: null, scoredBy: "rules" as const } }];
            });
          });
          errors.push(...stepErrors.map((e) => `Business scoring ${e}`));
          const kept = perBatch.flat().sort((a, b) => b.scored.score - a.scored.score);
          return {
            value: kept,
            output: { batches: batches.length, relevant: kept.length },
            error: stepErrors.length ? stepErrors.join("; ") : null,
            tokens,
          };
        })) ?? [];
    }
  }

  // ---- Dedupe + save ------------------------------------------------------------------------
  const saved =
    (await step(STEPS.save, "Dedupe & save", { places: scoredPlaces.length, signals: signals.length }, async () => {
      let inserted: any[] = [];
      let duplicates = 0;
      if (scoredPlaces.length > 0) {
        const existing = await agentsDb.listLeadContacts(orgId);
        const rows = scoredPlaces.map(({ place, scored }) =>
          buildPlaceLeadRow(place, scored, { runId, query, city, thresholds: params.thresholds, now })
        );
        const { fresh, duplicates: dupes } = dedupeLeadCandidates(rows, buildExistingKeySet(existing));
        const result = await agentsDb.insertLeads(orgId, fresh.slice(0, params.maxResults));
        inserted = result.inserted;
        duplicates = dupes.length + result.conflicts;
      }
      const leadIds = inserted.map((l) => String(l.id));
      const signalIds = signals.map((s) => String(s.id));
      return {
        value: { inserted, duplicates },
        output: {
          leadsCreated: inserted.length,
          duplicates,
          signalsSaved: signals.length,
          leadIds,
          signalIds,
          searched: { web: webSearched, places: placesSearched },
          errors,
        },
      };
    })) ?? { inserted: [] as any[], duplicates: 0 };

  const leadsCreated = saved.inserted.length;
  const highScore =
    saved.inserted.filter((l) => Number(l.score ?? 0) >= HIGH_SCORE).length +
    signals.filter((s) => Number(s.intent_score ?? 0) >= HIGH_SCORE).length;
  const nothingSearched = webSearched === 0 && placesSearched === 0;
  const status: LeadDiscoveryResult["status"] =
    nothingSearched && errors.length > 0 ? "failed" : errors.length > 0 ? "completed_with_errors" : "completed";
  const durationMs = Date.now() - start;

  await log(
    status === "failed" ? "error" : status === "completed" ? "info" : "warn",
    `Finished (${status}) in ${Math.round(durationMs / 1000)}s: searched ${webSearched} posts and ${placesSearched} businesses; ` +
      `${leadsCreated} new lead${leadsCreated === 1 ? "" : "s"}, ${saved.duplicates} duplicate${saved.duplicates === 1 ? "" : "s"}, ` +
      `${signals.length} intent signal${signals.length === 1 ? "" : "s"}${errors.length ? `, ${errors.length} error(s)` : ""}.`
  );

  return {
    status,
    searched: { web: webSearched, places: placesSearched },
    leadsCreated,
    duplicates: saved.duplicates,
    signalsSaved: signals.length,
    highScore,
    leads: saved.inserted.map((l) => ({ id: String(l.id), source: l.source ?? null })),
    signalIds: signals.map((s) => String(s.id)),
    errors,
    tokensUsed,
    durationMs,
  };
}
