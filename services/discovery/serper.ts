/**
 * Serper.dev (Google Search API) client: /search for public posts and /places for public business
 * listings. Only reads what Google already shows; never logs into or scrapes the platforms.
 */

import { canonicalCity, cityAliases, sanitizeFilterValue } from "../search/queryParser";

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

async function serperPost(path: "search" | "places", apiKey: string, body: Record<string, unknown>, timeoutMs: number) {
  if (!apiKey) throw new SerperError("Serper API key is not configured. Add it under Integrations.");
  let res: Response;
  try {
    res = await fetch(`${SERPER_BASE_URL}/${path}`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ gl: "in", hl: "en", ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const reason = err?.name === "TimeoutError" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : err?.message || "network error";
    throw new SerperError(`Serper request failed: ${reason}`);
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401 || res.status === 403) throw new SerperError("Serper rejected the API key (check it under Integrations)");
    throw new SerperError(`Serper responded with HTTP ${res.status}${text ? `: ${text}` : ""}`);
  }
  return (await res.json().catch(() => null)) as any;
}

export async function searchSerper(apiKey: string, q: string, num = 10, timeoutMs = 20_000): Promise<SerperResult[]> {
  const data = await serperPost("search", apiKey, { q, num }, timeoutMs);
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
export async function searchPlaces(apiKey: string, q: string, page = 1, timeoutMs = 20_000): Promise<SerperPlace[]> {
  const data = await serperPost("places", apiKey, { q, page }, timeoutMs);
  const places: any[] = Array.isArray(data?.places) ? data.places : [];
  return places.map(mapSerperPlace).filter((p): p is SerperPlace => p !== null);
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** `(Bengaluru OR Bangalore OR Blr)` for known cities, otherwise the city as typed. */
export function cityExpression(city: string): string {
  const label = canonicalCity(city) || sanitizeFilterValue(city);
  const byLower = new Map<string, string>();
  for (const name of [label, ...cityAliases(label).slice(0, 3).map(titleCase)]) {
    const trimmed = name.trim();
    if (trimmed && !byLower.has(trimmed.toLowerCase())) byLower.set(trimmed.toLowerCase(), trimmed);
  }
  const names = Array.from(byLower.values());
  return names.length > 1 ? `(${names.join(" OR ")})` : names[0] || "";
}

const INTENT_PHRASES = [
  "looking for",
  "recommend",
  "suggest",
  "best",
  "any good",
  "near me",
  "how much",
  "price",
  "cost",
  "need a",
  "should I",
  "review",
];
const CONTACT_PHRASES = ["call me", "contact me", "send details", "DM me", "whatsapp me", "interested please contact"];
const LISTING_SITES = ["justdial.com", "sulekha.com", "indiamart.com", "indeed.com", "naukri.com", "urbanpro.com"];

const anyOf = (phrases: string[]) => `(${phrases.map((p) => `"${p}"`).join(" OR ")})`;

/** The city's own subreddit name, e.g. r/bangalore for Bengaluru. */
function citySubreddit(city: string): string | null {
  const label = canonicalCity(city) || sanitizeFilterValue(city);
  if (label.toLowerCase() === "bengaluru") return "bangalore";
  const name = (cityAliases(label)[0] || label).replace(/\s+/g, "");
  return /^[a-z0-9_]{2,}$/i.test(name) ? name.toLowerCase() : null;
}

/**
 * One Google query per platform (site: scoped, city aliases, intent phrases), plus the city's
 * subreddit and an open-web query for posts where people ask to be contacted.
 */
export function buildQueries(query: string, city: string): DiscoveryQuery[] {
  const c = sanitizeFilterValue(query);
  const where = cityExpression(city);
  const intent = anyOf(INTENT_PHRASES);
  const subreddits = [citySubreddit(city), "india"]
    .filter((s): s is string => Boolean(s))
    .map((s) => `site:reddit.com/r/${s}`);
  const noListings = LISTING_SITES.map((s) => `-site:${s}`).join(" ");

  return [
    { platform: "contact", q: `"${c}" ${where} ${anyOf(CONTACT_PHRASES)} ${noListings}` },
    { platform: "reddit", q: `site:reddit.com "${c}" ${intent} ${where}` },
    { platform: "reddit", q: `(${subreddits.join(" OR ")}) "${c}" ${intent}` },
    { platform: "quora", q: `site:quora.com "${c}" ${intent} ${where}` },
    { platform: "linkedin", q: `site:linkedin.com/posts "${c}" ${intent} ${where}` },
    { platform: "youtube", q: `site:youtube.com "${c}" ${intent} ${where}` },
    { platform: "instagram", q: `site:instagram.com "${c}" ${intent} ${where}` },
    { platform: "facebook", q: `site:facebook.com "${c}" ${intent} ${where}` },
    { platform: "web", q: `"${c}" ${intent} ${where} ${noListings}` },
  ];
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
