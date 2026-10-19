/**
 * Turns a free-text lead search ("NEET students in Bengaluru") into structured filters.
 * Pure module (no DB / network) so it can be unit-tested directly. Which interests and cities are
 * recognised comes from the workspace vocabulary (see ./vocabulary).
 */

import { DEFAULT_VOCABULARY, type CityDef, type InterestDef, type SearchVocabulary } from "./vocabulary";

export type SourcePlatform = "meta" | "google";

export interface LeadSearchFilters {
  course_interest: string | null;
  city: string | null;
  exam_year: string | null;
  source_platform: SourcePlatform | null;
  status: string | null;
  min_score: number | null;
  keywords: string[];
}

export function emptyFilters(): LeadSearchFilters {
  return {
    course_interest: null,
    city: null,
    exam_year: null,
    source_platform: null,
    status: null,
    min_score: null,
    keywords: [],
  };
}

const KNOWN_STATUSES = ["Hot", "Warm", "Cold", "New", "Contacted", "Qualified", "Converted", "Lost"];

const STOPWORDS = new Set([
  "a", "an", "the", "in", "at", "on", "of", "for", "from", "to", "and", "or", "with", "near", "around",
  "me", "my", "show", "find", "get", "list", "search", "all", "any", "who", "are", "is", "want", "wants",
  "looking", "interested", "students", "student", "aspirants", "aspirant", "leads", "lead", "people",
  "training", "course", "courses", "class", "classes", "coaching", "developers", "developer", "learners",
  "candidates", "parents", "batch", "year", "exam", "city", "based", "score", "above", "over", "least",
  "minimum", "min", "ads", "ad", "form", "forms", "from", "via", "customers", "customer", "clients", "client",
  "buyers", "buyer", "prospects", "prospect",
]);

const SOURCE_PATTERNS: { platform: SourcePlatform; detect: RegExp }[] = [
  { platform: "meta", detect: /\b(?:meta|facebook|fb|instagram|insta|ig)\b/i },
  { platform: "google", detect: /\b(?:google(?:\s+ads)?|adwords)\b/i },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strips characters that break PostgREST filter syntax or act as ilike wildcards. */
export function sanitizeFilterValue(value: string): string {
  return value.replace(/[,()"\\%*:{}]/g, " ").replace(/\s+/g, " ").trim();
}

function findCourse(text: string, vocab: SearchVocabulary): { course: InterestDef; index: number; match: string } | null {
  let best: { course: InterestDef; index: number; match: string } | null = null;
  for (const course of vocab.interests) {
    const m = course.detect.exec(text);
    if (m && (best === null || m.index < best.index)) best = { course, index: m.index, match: m[0] };
  }
  return best;
}

function findCity(text: string, vocab: SearchVocabulary): { city: CityDef; match: string } | null {
  let best: { city: CityDef; index: number; match: string } | null = null;
  for (const city of vocab.cities) {
    const m = city.detect.exec(text);
    if (m && (best === null || m.index < best.index)) best = { city, index: m.index, match: m[0] };
  }
  return best ? { city: best.city, match: best.match } : null;
}

/** Canonical course label ("neet ug" -> "NEET"); unknown courses are returned trimmed. */
export function canonicalCourse(value: unknown, vocab: SearchVocabulary = DEFAULT_VOCABULARY): string | null {
  if (typeof value !== "string") return null;
  const trimmed = sanitizeFilterValue(value);
  if (!trimmed) return null;
  return findCourse(trimmed, vocab)?.course.label ?? trimmed;
}

/** Canonical city label ("Bangalore" -> "Bengaluru"); unknown cities are returned trimmed. */
export function canonicalCity(value: unknown, vocab: SearchVocabulary = DEFAULT_VOCABULARY): string | null {
  if (typeof value !== "string") return null;
  const trimmed = sanitizeFilterValue(value);
  if (!trimmed) return null;
  return findCity(trimmed, vocab)?.city.label ?? trimmed;
}

/** All spellings that should match a city in an ilike search. */
export function cityAliases(city: string, vocab: SearchVocabulary = DEFAULT_VOCABULARY): string[] {
  const clean = sanitizeFilterValue(city).normalize("NFKC").toLowerCase();
  if (!clean) return [];
  const def = vocab.cities.find((c) => c.label.toLowerCase() === clean || c.aliases.includes(clean));
  return def ? def.aliases : [clean];
}

/** ilike fragments that should match a course (without surrounding %). */
export function coursePatterns(course: string, vocab: SearchVocabulary = DEFAULT_VOCABULARY): string[] {
  const clean = sanitizeFilterValue(course);
  if (!clean) return [];
  const def = vocab.interests.find((c) => c.label.toLowerCase() === clean.toLowerCase());
  return def ? def.patterns : [clean.toLowerCase()];
}

/** Exact tag values to check with an array-overlap filter. */
export function courseTags(course: string): string[] {
  const clean = sanitizeFilterValue(course);
  if (!clean) return [];
  return Array.from(new Set([clean, clean.toLowerCase(), clean.toUpperCase()]));
}

function canonicalStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = sanitizeFilterValue(value);
  if (!clean) return null;
  const known = KNOWN_STATUSES.find((s) => s.toLowerCase() === clean.toLowerCase());
  return known ?? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function canonicalPlatform(value: unknown): SourcePlatform | null {
  if (typeof value !== "string") return null;
  for (const { platform, detect } of SOURCE_PATTERNS) {
    if (value.toLowerCase() === platform || detect.test(value)) return platform;
  }
  return null;
}

function canonicalYear(value: unknown): string | null {
  const m = String(value ?? "").match(/\b(20\d{2})\b/);
  return m ? m[1] : null;
}

function canonicalScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Coerces untrusted filter JSON (e.g. from the Sarvam parser) into LeadSearchFilters. */
export function normalizeFilters(raw: any, vocab: SearchVocabulary = DEFAULT_VOCABULARY): LeadSearchFilters {
  const src = raw && typeof raw === "object" ? raw : {};
  const keywords = Array.isArray(src.keywords)
    ? Array.from(
        new Set(
          src.keywords
            .filter((k: unknown): k is string => typeof k === "string")
            .map((k: string) => sanitizeFilterValue(k).toLowerCase())
            .filter((k: string) => k.length >= 2 && !STOPWORDS.has(k))
        )
      ).slice(0, 10) as string[]
    : [];
  return {
    course_interest: canonicalCourse(src.course_interest ?? src.course, vocab),
    city: canonicalCity(src.city ?? src.location, vocab),
    exam_year: canonicalYear(src.exam_year),
    source_platform: canonicalPlatform(src.source_platform),
    status: canonicalStatus(src.status),
    min_score: canonicalScore(src.min_score),
    keywords,
  };
}

/** Deterministic parser used when Sarvam is unavailable (and to fill gaps in its output). */
export function parseQueryKeywords(query: string, vocab: SearchVocabulary = DEFAULT_VOCABULARY): LeadSearchFilters {
  const filters = emptyFilters();
  let rest = ` ${String(query || "")} `;
  const consume = (match: string) => {
    rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRegExp(match)}(?![\\p{L}\\p{M}\\p{N}])`, "iu"), " ");
  };

  const course = findCourse(rest, vocab);
  if (course) {
    filters.course_interest = course.course.label;
    consume(course.match);
  }

  const city = findCity(rest, vocab);
  if (city) {
    filters.city = city.city.label;
    consume(city.match);
  }

  const year = rest.match(/\b20\d{2}\b/);
  if (year) {
    filters.exam_year = year[0];
    consume(year[0]);
  }

  for (const { platform, detect } of SOURCE_PATTERNS) {
    const m = rest.match(detect);
    if (m) {
      filters.source_platform = platform;
      consume(m[0]);
      break;
    }
  }

  const status = rest.match(/\b(hot|warm|cold)\b/i);
  if (status) {
    filters.status = canonicalStatus(status[1]);
    consume(status[0]);
  }

  const score = rest.match(/\bscore\s*(?:>=|>|=>|of|above|over|at\s+least|min(?:imum)?)?\s*(\d{1,3})\b/i);
  if (score) {
    filters.min_score = canonicalScore(score[1]);
    consume(score[0]);
  }

  filters.keywords = Array.from(
    new Set(
      rest
        .toLowerCase()
        .split(/[^\p{L}\p{M}\p{N}+#.]+/u)
        .map((t) => t.replace(/^\.+|\.+$/g, ""))
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    )
  ).slice(0, 10);

  return filters;
}

/** Fills null fields of `primary` from `fallback`; keywords are merged. */
export function mergeFilters(primary: LeadSearchFilters, fallback: LeadSearchFilters): LeadSearchFilters {
  return {
    course_interest: primary.course_interest ?? fallback.course_interest,
    city: primary.city ?? fallback.city,
    exam_year: primary.exam_year ?? fallback.exam_year,
    source_platform: primary.source_platform ?? fallback.source_platform,
    status: primary.status ?? fallback.status,
    min_score: primary.min_score ?? fallback.min_score,
    keywords: Array.from(new Set([...primary.keywords, ...fallback.keywords])).slice(0, 10),
  };
}

export function hasStructuredFilter(f: LeadSearchFilters): boolean {
  return !!(f.course_interest || f.city || f.exam_year || f.source_platform || f.status || f.min_score !== null);
}
