/**
 * Serper.dev (Google Search API) client: /search for public posts and /places for public business
 * listings. Only reads what Google already shows; never logs into or scrapes the platforms.
 */

import { canonicalCity, cityAliases, sanitizeFilterValue } from "../search/queryParser";
import { DEFAULT_DISCOVERY_SETTINGS, DEFAULT_VOCABULARY, type SearchVocabulary } from "../search/vocabulary";

export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  date: string | null;
}

/** A public Google Maps listing as returned by Serper /places. */
export interface SerperPlace {
  title: string;
  address: string | null;
  category: string | null;
  phoneNumber: string | null;
  website: string | null;
  rating: number | null;
  ratingCount: number | null;
  cid: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface DiscoveryQuery {
  platform: string;
  q: string;
}

const SERPER_BASE_URL = "https://google.serper.dev";

export class SerperError extends Error {}

export interface SerperLocale {
  /** Google country code (gl), e.g. "in" or "us". */
  country?: string;
  /** Google interface language (hl), e.g. "en". */
  language?: string;
}

export interface SerperOptions extends SerperLocale {
  timeoutMs?: number;
}

/** gl/hl request fields; invalid values fall back to the defaults. */
export function serperLocale(locale: SerperLocale = {}): { gl: string; hl: string } {
  const gl = typeof locale.country === "string" && /^[a-z]{2}$/i.test(locale.country) ? locale.country.toLowerCase() : DEFAULT_DISCOVERY_SETTINGS.country;
  const hl =
    typeof locale.language === "string" && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(locale.language) ? locale.language : DEFAULT_DISCOVERY_SETTINGS.language;
  return { gl, hl };
}

async function serperPost(path: "search" | "places", apiKey: string, body: Record<string, unknown>, options: SerperOptions) {
  if (!apiKey) throw new SerperError("Serper API key is not configured. Add it under Integrations.");
  const timeoutMs = options.timeoutMs ?? 20_000;
  let res: Response;
  try {
    res = await fetch(`${SERPER_BASE_URL}/${path}`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ ...serperLocale(options), ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const reason = err?.name === "TimeoutError" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : err?.message || "network error";
    throw new SerperError(`Serper request failed: ${reason}`);
  }

  if (!res.ok) {
    await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) throw new SerperError("Serper rejected the API key (check it under Integrations)");
    if (res.status === 429) throw new SerperError("Serper rate limit or credit limit reached");
    throw new SerperError(`Serper responded with HTTP ${res.status}`);
  }
  return (await res.json().catch(() => null)) as any;
}

export async function searchSerper(apiKey: string, q: string, num = 10, options: SerperOptions = {}): Promise<SerperResult[]> {
  const data = await serperPost("search", apiKey, { q, num }, options);
  const organic: any[] = Array.isArray(data?.organic) ? data.organic : [];
  return organic
    .filter((r) => typeof r?.link === "string" && /^https?:\/\//i.test(r.link))
    .map((r) => ({
      title: String(r.title ?? "").trim(),
      link: String(r.link).trim(),
      snippet: String(r.snippet ?? "").trim(),
      date: typeof r.date === "string" && r.date.trim() ? r.date.trim() : null,
    }));
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};

/** Maps one raw Serper /places item; null when it has no name. */
export function mapSerperPlace(raw: any): SerperPlace | null {
  const title = str(raw?.title);
  if (!title) return null;
  const website = str(raw?.website);
  return {
    title,
    address: str(raw?.address),
    category: str(raw?.category) ?? str(raw?.type),
    phoneNumber: str(raw?.phoneNumber) ?? str(raw?.phone),
    website: website && /^https?:\/\//i.test(website) ? website : null,
    rating: num(raw?.rating),
    ratingCount: num(raw?.ratingCount) ?? num(raw?.reviews),
    cid: str(raw?.cid) ?? (raw?.cid != null ? String(raw.cid) : null),
    latitude: num(raw?.latitude),
    longitude: num(raw?.longitude),
  };
}

/** One page of Serper /places results (about 10-20 listings). */
export async function searchPlaces(apiKey: string, q: string, page = 1, options: SerperOptions = {}): Promise<SerperPlace[]> {
  const data = await serperPost("places", apiKey, { q, page }, options);
  const places: any[] = Array.isArray(data?.places) ? data.places : [];
  return places.map(mapSerperPlace).filter((p): p is SerperPlace => p !== null);
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** City label plus up to three alias spellings, e.g. ["Bengaluru", "Bangalore", "Blr", "Bengalooru"]. */
export function cityNames(city: string, vocab: SearchVocabulary = DEFAULT_VOCABULARY): string[] {
  const label = canonicalCity(city, vocab) || sanitizeFilterValue(city);
  if (!label) return [];
  const byLower = new Map<string, string>();
  for (const name of [label, ...cityAliases(label, vocab).slice(0, 3).map(titleCase)]) {
    const trimmed = name.trim();
    if (trimmed && !byLower.has(trimmed.toLowerCase())) byLower.set(trimmed.toLowerCase(), trimmed);
  }
  return Array.from(byLower.values());
}

/** `(Bengaluru OR Bangalore OR Blr)` for known cities, otherwise the city as typed ("" for none). */
export function cityExpression(city: string, vocab: SearchVocabulary = DEFAULT_VOCABULARY): string {
  return renderPart({ terms: cityNames(city, vocab), min: 1, join: "or" });
}

/** Google ignores everything after its 32nd query word. */
export const MAX_QUERY_WORDS = 32;
/** The user's query is used as plain words (no quotes) and capped so the operators still fit. */
export const MAX_TOPIC_WORDS = 8;

const INTENT_PHRASES = ["looking for", "recommend", "suggest", "any good", "need a"];
const CONTACT_PHRASES = ["call me", "contact me", "send details", "DM me", "whatsapp me"];
const LISTING_SITES: Record<string, string[]> = {
  in: ["justdial.com", "sulekha.com", "indiamart.com", "urbanpro.com", "naukri.com", "indeed.com"],
};
const DEFAULT_LISTING_SITES = ["yelp.com", "yellowpages.com", "indeed.com"];

/** Alternatives joined with OR (multi-word terms quoted), or terms written as-is and ANDed. */
export interface QueryPart {
  terms: string[];
  /** Terms the part keeps when the query is shortened; 0 lets it disappear. */
  min: number;
  join: "or" | "and";
}

const quoteTerm = (t: string) => (/\s/.test(t) ? `"${t}"` : t);

function renderPart(part: QueryPart): string {
  if (part.terms.length === 0) return "";
  if (part.join === "and") return part.terms.join(" ");
  return part.terms.length === 1 ? quoteTerm(part.terms[0]) : `(${part.terms.map(quoteTerm).join(" OR ")})`;
}

/** Words as Google counts them (operators such as OR and site: included). */
export function queryWordCount(q: string): number {
  return q.replace(/[()"]/g, " ").split(/\s+/).filter(Boolean).length;
}

/** Joins the parts, dropping terms from the last shrinkable part until the query fits maxWords. */
export function composeQuery(parts: QueryPart[], maxWords = MAX_QUERY_WORDS): string {
  const work = parts.map((p) => ({ ...p, terms: [...p.terms] }));
  const render = () => work.map(renderPart).filter(Boolean).join(" ");
  let q = render();
  while (queryWordCount(q) > maxWords) {
    const part = [...work].reverse().find((p) => p.terms.length > p.min);
    if (!part) break;
    part.terms.pop();
    q = render();
  }
  return q;
}

/** The query as plain words: quotes and search operators stripped, capped at MAX_TOPIC_WORDS. */
export function topicWords(query: string): string {
  return sanitizeFilterValue(query)
    .replace(/(^|\s)[-+~]+/g, "$1")
    .split(" ")
    .filter((w) => w && w !== "OR" && w !== "AND")
    .slice(0, MAX_TOPIC_WORDS)
    .join(" ");
}

/** The city's own subreddit name, e.g. r/bangalore for Bengaluru. */
function citySubreddit(city: string, vocab: SearchVocabulary): string | null {
  const label = canonicalCity(city, vocab) || sanitizeFilterValue(city);
  if (!label) return null;
  if (label.toLowerCase() === "bengaluru") return "bangalore";
  const name = (cityAliases(label, vocab)[0] || label).replace(/\s+/g, "");
  return /^[a-z0-9_]{2,}$/i.test(name) ? name.toLowerCase() : null;
}

export interface BuildQueriesOptions {
  /** Market country (ISO 3166-1 alpha-2); picks the listing sites to exclude and the national subreddit. */
  country?: string;
  vocab?: SearchVocabulary;
}

const NATIONAL_SUBREDDITS: Record<string, string> = { in: "india" };

/**
 * One Google query per platform (site: scoped, city aliases, intent phrases), plus the city's
 * subreddit and an open-web query for posts where people ask to be contacted. Every query fits
 * Google's word limit: intent phrases are cut first, then listing-site exclusions, then city aliases.
 */
export function buildQueries(query: string, city: string, options: BuildQueriesOptions = {}): DiscoveryQuery[] {
  const vocab = options.vocab ?? DEFAULT_VOCABULARY;
  const country = serperLocale({ country: options.country }).gl;
  const topic = topicWords(query);
  if (!topic) return [];

  const topicPart: QueryPart = { terms: [topic], min: 1, join: "and" };
  const where: QueryPart = { terms: cityNames(city, vocab), min: 1, join: "or" };
  const intent: QueryPart = { terms: INTENT_PHRASES, min: 1, join: "or" };
  const contact: QueryPart = { terms: CONTACT_PHRASES, min: 1, join: "or" };
  const noListings: QueryPart = {
    terms: (LISTING_SITES[country] ?? DEFAULT_LISTING_SITES).map((s) => `-site:${s}`),
    min: 0,
    join: "and",
  };
  const site = (s: string): QueryPart => ({ terms: [`site:${s}`], min: 1, join: "and" });
  const subreddits = [citySubreddit(city, vocab), NATIONAL_SUBREDDITS[country]]
    .filter((s): s is string => Boolean(s))
    .map((s) => `site:reddit.com/r/${s}`);

  const queries: DiscoveryQuery[] = [
    { platform: "contact", q: composeQuery([topicPart, where, noListings, contact]) },
    { platform: "reddit", q: composeQuery([site("reddit.com"), topicPart, where, intent]) },
  ];
  if (subreddits.length > 0) {
    queries.push({ platform: "reddit", q: composeQuery([{ terms: subreddits, min: 1, join: "or" }, topicPart, intent]) });
  }
  queries.push(
    { platform: "quora", q: composeQuery([site("quora.com"), topicPart, where, intent]) },
    { platform: "linkedin", q: composeQuery([site("linkedin.com/posts"), topicPart, where, intent]) },
    { platform: "youtube", q: composeQuery([site("youtube.com"), topicPart, where, intent]) },
    { platform: "instagram", q: composeQuery([site("instagram.com"), topicPart, where, intent]) },
    { platform: "facebook", q: composeQuery([site("facebook.com"), topicPart, where, intent]) },
    { platform: "web", q: composeQuery([topicPart, where, noListings, intent]) }
  );
  return queries;
}

/** Google Maps query: "<query> in <city>", or just the query when there is no location. */
export function placesQuery(query: string, city: string): string {
  const q = sanitizeFilterValue(query);
  const where = sanitizeFilterValue(city);
  return where ? `${q} in ${where}` : q;
}

const PLATFORM_HOSTS: [RegExp, string][] = [
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(facebook\.com|fb\.com)$/, "facebook"],
  [/(^|\.)quora\.com$/, "quora"],
  [/(^|\.)(twitter\.com|x\.com)$/, "x"],
];

/** Platform name from a result URL ("web" when it is not one of the known social sites). */
export function platformFromUrl(link: string): string {
  try {
    const host = new URL(link).hostname.toLowerCase();
    for (const [re, platform] of PLATFORM_HOSTS) if (re.test(host)) return platform;
  } catch {
    // fall through
  }
  return "web";
}

/** Human-readable channel, e.g. "Reddit r/bangalore" or the site's hostname. */
export function sourceChannelFromUrl(link: string): string {
  try {
    const url = new URL(link);
    const platform = platformFromUrl(link);
    if (platform === "reddit") {
      const sub = url.pathname.match(/^\/r\/([^/]+)/i);
      return sub ? `Reddit r/${sub[1]}` : "Reddit";
    }
    if (platform === "web") return url.hostname.replace(/^www\./, "");
    return platform === "x" ? "X" : titleCase(platform).replace("Linkedin", "LinkedIn").replace("Youtube", "YouTube");
  } catch {
    return "web";
  }
}
