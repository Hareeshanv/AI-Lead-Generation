/**
 * Pure post-processing for the Lead Discovery agent: classification output -> intent_signals rows,
 * Google Maps listings -> leads rows, duplicate detection against existing leads, and run stats.
 * No I/O here, so every function can be unit tested.
 */

import {
  containsContactDetails,
  isLocationMatch,
  redactContactDetails,
  requestedContactFromText,
  type IntentSignalRow,
  type RequestedContact,
} from "../signals";
import { mentionsTerm } from "../search/vocabulary";
import { sourceChannelFromUrl, type SerperPlace, type SerperResult } from "./serper";

export const DISCOVERY_SOURCES = ["web", "places"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export const DEFAULT_MAX_RESULTS = 30;
export const MAX_RESULTS_LIMIT = 100;
export const AGENT_LEAD_SOURCE = "AI Agent";
export const PLACES_CHANNEL = "Google Maps";

const PER_PLATFORM_CAP = 5;
export const MIN_INTENT_SCORE = 20;
export const MIN_PLACE_SCORE = 20;
const MINOR_RE =
  /\b(?:class|std|standard|grade)\s*(?:11|12|xi|xii)(?:th)?\b|\b(?:11|12)th\b|\b(?:1st|2nd|first|second)?\s*puc?\b|\bmy (?:son|daughter|kid|child)\b/i;
const REPLY_FORBIDDEN_RE = /https?:\/\/|www\.|\.(?:com|in|org|net|io)\b|\b(?:phone|mobile|number|e-?mail|whatsapp|dm me)\b/i;

export interface Candidate extends SerperResult {
  platform: string;
}

export interface ScoringThresholds {
  hot: number;
  warm: number;
}

export const DEFAULT_THRESHOLDS: ScoringThresholds = { hot: 80, warm: 50 };

export function normalizeUrl(link: string): string {
  try {
    const url = new URL(link);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return link;
  }
}

export function clampMaxResults(value: unknown): number {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS_LIMIT, Math.round(n)));
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? redactContactDetails(s).slice(0, maxLength) : null;
}

/** Keeps the handle only if it is visible in the result itself (guards against invented names). */
export function cleanHandle(value: unknown, candidate: SerperResult): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().slice(0, 200);
  if (!handle || containsContactDetails(handle)) return null;
  const bare = handle.replace(/^(?:u\/|@)/i, "").toLowerCase();
  const haystack = `${candidate.title} ${candidate.snippet} ${candidate.link}`.toLowerCase();
  return bare.length >= 2 && haystack.includes(bare) ? handle : null;
}

export function cleanScore(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

const isTrue = (value: unknown): boolean => value === true || value === "true";

/** Brand-free, link-free reply that never asks for a phone or email; otherwise null. */
export function cleanReply(value: unknown): string | null {
  const reply = cleanText(value, 1000);
  return reply && !REPLY_FORBIDDEN_RE.test(reply) && !reply.includes("[contact removed]") ? reply : null;
}

/** Verified requested contact from the title or the snippet (each checked on its own). */
export function requestedContact(candidate: SerperResult): RequestedContact {
  const fromSnippet = requestedContactFromText(candidate.snippet);
  return fromSnippet.contact_requested ? fromSnippet : requestedContactFromText(candidate.title);
}

export function scoreBand(
  score: number,
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS
): { urgency: "high" | "medium" | "low"; routing: "hot" | "warm" | "nurture" } {
  if (score >= thresholds.hot) return { urgency: "high", routing: "hot" };
  if (score >= thresholds.warm) return { urgency: "medium", routing: "warm" };
  return { urgency: "low", routing: "nurture" };
}

/** "exact" when the text names the city or one of its aliases (any script); null otherwise. */
export function textLocationMatch(text: string, aliases: string[]): "exact" | null {
  return aliases.some((alias) => mentionsTerm(text, alias)) ? "exact" : null;
}

/** Contact-requested posts first, then highest intent. */
export function byPriority(a: Record<string, any>, b: Record<string, any>): number {
  return (
    Number(Boolean(b.contact_requested)) - Number(Boolean(a.contact_requested)) ||
    Number(b.intent_score ?? 0) - Number(a.intent_score ?? 0)
  );
}

/** Up to PER_PLATFORM_CAP rows per platform; other rows only fill the remaining slots. */
export function selectRows(rows: IntentSignalRow[], max: number): IntentSignalRow[] {
  const counts = new Map<string, number>();
  const picked: IntentSignalRow[] = [];
  const overflow: IntentSignalRow[] = [];
  for (const row of [...rows].sort(byPriority)) {
    const platform = row.platform || "web";
    const n = counts.get(platform) ?? 0;
    if (n < PER_PLATFORM_CAP) {
      counts.set(platform, n + 1);
      picked.push(row);
    } else {
      overflow.push(row);
    }
  }
  return [...picked, ...overflow].slice(0, max).sort(byPriority);
}

/** Interleaves platforms so a capped candidate list still covers every platform. */
export function interleave(lists: Candidate[][], limit: number): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && out.length < limit; i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item) continue;
      const key = normalizeUrl(item.link);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export interface SignalContext {
  query: string;
  /** "" when the run has no location. */
  city: string;
  cityAliases: string[];
  now: string;
  /** Workspace thresholds for urgency / routing; contact requests are raised to at least `hot`. */
  thresholds?: ScoringThresholds;
}

/**
 * Turns Sarvam's classification of one batch into redacted intent_signals rows. Only prospective
 * customers above MIN_INTENT_SCORE are kept; contacts are kept only when verified in the post text.
 */
export function buildSignalRows(batch: Candidate[], items: unknown[], ctx: SignalContext): IntentSignalRow[] {
  const thresholds = ctx.thresholds ?? DEFAULT_THRESHOLDS;
  const rows: IntentSignalRow[] = [];
  const used = new Set<number>();
  for (const raw of items) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
    const index = Number(item.index);
    const candidate = Number.isInteger(index) ? batch[index] : undefined;
    const prospective =
      isTrue(item.is_prospective_customer) || isTrue(item.is_prospective_learner);
    if (!candidate || used.has(index) || !prospective) continue;
    used.add(index);

    const contact = requestedContact(candidate);
    const score = contact.contact_requested
      ? Math.max(cleanScore(item.intent_score), cleanScore(thresholds.hot))
      : cleanScore(item.intent_score);
    if (score < MIN_INTENT_SCORE) continue;

    const band = scoreBand(score, thresholds);
    const rawText = `${candidate.title}\n${candidate.snippet}`;
    const minor = isTrue(item.is_minor) || MINOR_RE.test(rawText);
    rows.push({
      post_url: candidate.link,
      source_channel: sourceChannelFromUrl(candidate.link),
      platform: candidate.platform,
      author_handle: cleanHandle(item.author_handle, candidate),
      post_excerpt: cleanText(candidate.snippet || candidate.title, 2000),
      post_date: cleanText(candidate.date, 100),
      city: ctx.city || null,
      location_match: !ctx.city
        ? null
        : isLocationMatch(item.location_match)
          ? item.location_match
          : textLocationMatch(rawText, ctx.cityAliases),
      course_interest: cleanText(item.interest ?? item.course_interest, 200) || ctx.query,
      urgency: band.urgency,
      budget: null,
      intent_score: score,
      lead_routing_category: minor ? "guardian_consent_needed" : band.routing,
      suggested_public_reply: cleanReply(item.suggested_public_reply),
      ...contact,
      search_query: ctx.query,
      search_city: ctx.city,
      discovered_at: ctx.now,
      updated_at: ctx.now,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Duplicate detection

/** Hosts shared by many businesses: the first path segment identifies the business. */
const SHARED_HOSTS = new Set([
  "facebook.com",
  "m.facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "linktr.ee",
  "sites.google.com",
  "google.com",
  "maps.google.com",
  "goo.gl",
  "wa.me",
  "justdial.com",
  "sulekha.com",
  "indiamart.com",
  "practo.com",
]);

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Last 10 digits, so "+91 98450 12345" and "098450-12345" compare equal; null for short numbers. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : null;
}

/** "example.com" for https://www.example.com/x; "instagram.com/acme" for shared hosts; null otherwise. */
export function domainKey(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return null;
  if (SHARED_HOSTS.has(host)) {
    const segment = url.pathname.split("/").filter(Boolean)[0];
    return segment ? `${host}/${segment.toLowerCase()}` : null;
  }
  return host;
}

export interface LeadContactLike {
  email?: string | null;
  phone?: string | null;
  profile_url?: string | null;
  name?: string | null;
  source_channel?: string | null;
  /** Google Maps listing id and address; read from raw_answers.place when not given directly. */
  place_cid?: string | null;
  place_address?: string | null;
  raw_answers?: Record<string, any> | null;
}

/** Lowercase letters and digits of any script, single-spaced ("Acme Academy, MG Road" -> "acme academy mg road"). */
export function normalizePlaceText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/** "cid:…" and "place:<name>|<address>" for one Google Maps listing. */
export function placeKeys(place: { cid?: string | null; title?: string | null; address?: string | null }): string[] {
  const keys: string[] = [];
  const cid = typeof place.cid === "string" ? place.cid.trim() : "";
  if (cid) keys.push(`cid:${cid}`);
  const name = normalizePlaceText(place.title);
  if (name) keys.push(`place:${name}|${normalizePlaceText(place.address)}`);
  return keys;
}

function leadPlace(lead: LeadContactLike): { cid: string | null; address: string | null } | null {
  const place = lead.raw_answers && typeof lead.raw_answers.place === "object" ? lead.raw_answers.place : null;
  const cid = lead.place_cid ?? (place?.cid != null ? String(place.cid) : null);
  if (lead.source_channel !== PLACES_CHANNEL && !cid) return null;
  return { cid, address: lead.place_address ?? (typeof place?.address === "string" ? place.address : null) };
}

/** Keys that identify the same lead: "email:…", "phone:…", "domain:…", plus "cid:…" / "place:…" for Google Maps leads. */
export function leadDedupeKeys(lead: LeadContactLike): string[] {
  const keys: string[] = [];
  const email = normalizeEmail(lead.email);
  if (email) keys.push(`email:${email}`);
  const phone = normalizePhone(lead.phone);
  if (phone) keys.push(`phone:${phone}`);
  const domain = domainKey(lead.profile_url);
  if (domain) keys.push(`domain:${domain}`);
  const place = leadPlace(lead);
  if (place) keys.push(...placeKeys({ cid: place.cid, title: lead.name, address: place.address }));
  return keys;
}

export function buildExistingKeySet(existing: LeadContactLike[]): Set<string> {
  const keys = new Set<string>();
  for (const lead of existing) for (const key of leadDedupeKeys(lead)) keys.add(key);
  return keys;
}

export interface DedupeResult<T> {
  fresh: T[];
  duplicates: T[];
}

/**
 * Splits candidate leads into new ones and duplicates. A candidate is a duplicate when any of its
 * email / phone / domain / place keys matches an existing lead or an earlier candidate in the same list.
 */
export function dedupeLeadCandidates<T extends LeadContactLike>(candidates: T[], existingKeys: Set<string>): DedupeResult<T> {
  const seen = new Set(existingKeys);
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const candidate of candidates) {
    const keys = leadDedupeKeys(candidate);
    if (keys.some((k) => seen.has(k))) {
      duplicates.push(candidate);
      continue;
    }
    for (const k of keys) seen.add(k);
    fresh.push(candidate);
  }
  return { fresh, duplicates };
}

// ---------------------------------------------------------------------------------------------
// Business listings -> leads

/** Rule-based fit score, used only when Sarvam could not score a listing. */
export function placeFitScore(place: SerperPlace): number {
  let score = 35;
  if (place.website) score += 15;
  if (place.phoneNumber) score += 15;
  if (place.rating != null) score += Math.round(Math.max(0, Math.min(5, place.rating)) * 4);
  if (place.ratingCount != null) score += place.ratingCount >= 100 ? 10 : place.ratingCount >= 20 ? 5 : 0;
  return Math.min(100, score);
}

export function leadStatusForScore(score: number, thresholds: ScoringThresholds): "Hot" | "Warm" | "Cold" {
  if (score >= thresholds.hot) return "Hot";
  if (score >= thresholds.warm) return "Warm";
  return "Cold";
}

export interface PlaceScore {
  score: number;
  reason: string | null;
  /** "sarvam" or "rules" (fallback). */
  scoredBy: "sarvam" | "rules";
}

export interface PlaceLeadContext {
  runId: string;
  query: string;
  city: string;
  thresholds: ScoringThresholds;
  now: string;
}

/** A Google Maps listing as a leads row (public business details only; no personal contacts). */
export function buildPlaceLeadRow(place: SerperPlace, scored: PlaceScore, ctx: PlaceLeadContext): Record<string, any> {
  const name = place.title.slice(0, 200);
  return {
    name,
    company: name,
    title: place.category?.slice(0, 200) ?? null,
    email: null,
    phone: place.phoneNumber,
    phone_source: place.phoneNumber ? "google_places" : null,
    location: place.address?.slice(0, 500) ?? (ctx.city || null),
    industry: place.category?.slice(0, 200) ?? null,
    profile_url: place.website,
    profile_url_source: place.website ? "google_places" : null,
    source: AGENT_LEAD_SOURCE,
    source_channel: PLACES_CHANNEL,
    score: scored.score,
    status: leadStatusForScore(scored.score, ctx.thresholds),
    scored_at: ctx.now,
    tags: ["ai-agent", agentRunTag(ctx.runId)],
    raw_answers: {
      pipeline_run_id: ctx.runId,
      discovery_query: ctx.query,
      discovery_location: ctx.city || null,
      fit_score: scored.score,
      fit_reason: scored.reason,
      scored_by: scored.scoredBy,
      place: {
        rating: place.rating,
        rating_count: place.ratingCount,
        address: place.address,
        category: place.category,
        website: place.website,
        cid: place.cid,
        latitude: place.latitude,
        longitude: place.longitude,
      },
    },
  };
}

export const agentRunTag = (runId: string) => `agent-run:${runId}`;

/** Maps Sarvam's place scoring for one batch: index -> score, or null when not relevant. */
export function parsePlaceScores(items: unknown[], batchSize: number): Map<number, PlaceScore | null> {
  const out = new Map<number, PlaceScore | null>();
  for (const raw of items) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
    const index = Number(item.index);
    if (!Number.isInteger(index) || index < 0 || index >= batchSize || out.has(index)) continue;
    const score = cleanScore(item.fit_score ?? item.score);
    const relevant = item.is_relevant === undefined ? true : isTrue(item.is_relevant);
    out.set(
      index,
      relevant && score >= MIN_PLACE_SCORE
        ? { score, reason: cleanText(item.reason, 200), scoredBy: "sarvam" }
        : null
    );
  }
  return out;
}

/** Same business listed twice (same cid, or same normalised name + address) is kept once. */
export function uniquePlaces(places: SerperPlace[]): SerperPlace[] {
  const seen = new Set<string>();
  const out: SerperPlace[] = [];
  for (const p of places) {
    const keys = placeKeys(p);
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Intent signal -> lead ("Convert to lead")

/**
 * Keys for leads converted from posts: the exact post URL plus email/phone. The post host is not
 * used (every Reddit post shares reddit.com).
 */
export function signalLeadKeys(lead: LeadContactLike): string[] {
  const keys: string[] = [];
  if (typeof lead.profile_url === "string" && lead.profile_url.trim()) keys.push(`url:${normalizeUrl(lead.profile_url.trim())}`);
  const email = normalizeEmail(lead.email);
  if (email) keys.push(`email:${email}`);
  const phone = normalizePhone(lead.phone);
  if (phone) keys.push(`phone:${phone}`);
  return keys;
}

/** key -> existing lead id, for "url:", "email:" and "phone:" keys. */
export function indexLeadsBySignalKeys(existing: (LeadContactLike & { id: string })[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const lead of existing) {
    for (const key of signalLeadKeys(lead)) if (!index.has(key)) index.set(key, lead.id);
  }
  return index;
}

/**
 * A lead built from a public intent post. The only contact copied is the one the author published
 * next to an explicit contact request (contact_requested + published_contact).
 */
export function signalToLeadRow(signal: Record<string, any>, thresholds: ScoringThresholds, now: string): Record<string, any> {
  const contact = signal.contact_requested === true && typeof signal.published_contact === "string" ? signal.published_contact : null;
  const email = contact && contact.includes("@") ? normalizeEmail(contact) : null;
  const phone = contact && !contact.includes("@") ? contact.trim() : null;
  const score = cleanScore(signal.intent_score);
  const hasIntentScore =
    signal.intent_score !== null && signal.intent_score !== undefined && signal.intent_score !== "" && Number.isFinite(Number(signal.intent_score));
  const platform = typeof signal.platform === "string" && signal.platform ? signal.platform : "web";
  return {
    name: (typeof signal.author_handle === "string" && signal.author_handle.trim()) || `${platform} user`,
    company: "",
    title: null,
    email,
    phone,
    phone_source: phone ? "author_published" : null,
    verified_email_source: email ? "author_published" : null,
    location: signal.city ?? null,
    course_interest: signal.course_interest ?? null,
    profile_url: signal.post_url ?? null,
    profile_url_source: "public_post",
    source: AGENT_LEAD_SOURCE,
    source_channel: signal.source_channel || platform,
    score,
    status: leadStatusForScore(score, thresholds),
    scored_at: now,
    needs_guardian_consent: signal.lead_routing_category === "guardian_consent_needed",
    tags: ["ai-agent", "intent-signal"],
    raw_answers: {
      intent_signal_id: signal.id ?? null,
      intent_score: hasIntentScore ? score : null,
      post_excerpt: signal.post_excerpt ?? null,
      contact_request_quote: signal.contact_request_quote ?? null,
      discovery_query: signal.search_query ?? null,
      discovery_location: signal.search_city ?? null,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Run statistics

export interface RunStatInput {
  id: string;
  status: string;
  duration_ms: number | null;
  total_leads_found: number | null;
  created_at: string;
}

export interface RunTotals {
  leadsCreated: number;
  signalsSaved: number;
}

export interface AgentRunStats {
  runs: number;
  active: number;
  succeeded: number;
  failed: number;
  /** Percent of finished runs that did not fail; null before the first finished run. */
  successRate: number | null;
  avgDurationMs: number | null;
  leadsFound: number;
  signalsFound: number;
  lastRunAt: string | null;
}

/** `totals` holds the save-step output per run; runs without one (older signal-only runs) count as signals. */
export function computeRunStats(runs: RunStatInput[], totals: Map<string, RunTotals>): AgentRunStats {
  let active = 0;
  let succeeded = 0;
  let failed = 0;
  let durationSum = 0;
  let durationCount = 0;
  let leadsFound = 0;
  let signalsFound = 0;
  let lastRunAt: string | null = null;
  for (const run of runs) {
    if (!lastRunAt || run.created_at > lastRunAt) lastRunAt = run.created_at;
    if (run.status === "queued" || run.status === "running") {
      active++;
      continue;
    }
    if (run.status === "failed") failed++;
    else succeeded++;
    if (typeof run.duration_ms === "number" && run.duration_ms >= 0) {
      durationSum += run.duration_ms;
      durationCount++;
    }
    const t = totals.get(run.id);
    if (t) {
      leadsFound += t.leadsCreated;
      signalsFound += t.signalsSaved;
    } else {
      signalsFound += Number(run.total_leads_found) || 0;
    }
  }
  const finished = succeeded + failed;
  return {
    runs: runs.length,
    active,
    succeeded,
    failed,
    successRate: finished > 0 ? Math.round((succeeded / finished) * 1000) / 10 : null,
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    leadsFound,
    signalsFound,
    lastRunAt,
  };
}
