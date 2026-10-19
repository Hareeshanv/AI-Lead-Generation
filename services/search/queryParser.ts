/**
 * Turns a free-text lead search ("NEET students in Bengaluru") into structured filters.
 * Pure module (no DB / network) so it can be unit-tested directly.
 */

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

interface CourseDef {
  label: string;
  detect: RegExp;
  /** ilike fragments (without surrounding %); "%" inside acts as a wildcard. */
  patterns: string[];
}

// Order matters only for ties at the same position in the query.
const COURSES: CourseDef[] = [
  { label: "NEET", detect: /\bneet(?:[\s-]?(?:ug|pg))?\b/i, patterns: ["neet"] },
  { label: "JEE", detect: /\b(?:iit[\s-]?)?jee(?:\s+(?:main|mains|advanced))?\b/i, patterns: ["jee"] },
  { label: "Full Stack", detect: /\bfull[\s-]?stack\b|\bmern\b|\bmean\s+stack\b/i, patterns: ["full%stack", "fullstack", "mern"] },
  { label: "Java", detect: /\bjava\b(?!\s*script)/i, patterns: ["java"] },
  { label: "Python", detect: /\bpython\b/i, patterns: ["python"] },
  {
    label: "Software Testing",
    detect: /\b(?:software\s+|manual\s+|automation\s+)?testing\b|\bselenium\b|\bqa\s+(?:training|course|engineer)s?\b/i,
    patterns: ["testing", "selenium"],
  },
  { label: "Data Science", detect: /\bdata\s+scien(?:ce|tists?)\b/i, patterns: ["data scien"] },
  { label: "Data Analytics", detect: /\bdata\s+analy(?:tics|st|sts)\b/i, patterns: ["data analy"] },
  { label: "SAP", detect: /\bsap(?:\s+(?:fico|mm|sd|abap|hana|basis))?\b/i, patterns: ["sap"] },
  { label: "Digital Marketing", detect: /\bdigital\s+marketing\b/i, patterns: ["digital marketing"] },
  { label: "UPSC", detect: /\bupsc\b|\bias\s+(?:coaching|exam)\b/i, patterns: ["upsc"] },
  { label: "CUET", detect: /\bcuet\b/i, patterns: ["cuet"] },
  { label: "KCET", detect: /\bkcet\b/i, patterns: ["kcet"] },
];

interface CityDef {
  label: string;
  aliases: string[];
}

const CITIES: CityDef[] = [
  { label: "Bengaluru", aliases: ["bengaluru", "bangalore", "blr", "bengalooru"] },
  { label: "Mysuru", aliases: ["mysuru", "mysore"] },
  { label: "Mangaluru", aliases: ["mangaluru", "mangalore"] },
  { label: "Hubballi", aliases: ["hubballi", "hubli", "dharwad"] },
  { label: "Belagavi", aliases: ["belagavi", "belgaum"] },
  { label: "Hyderabad", aliases: ["hyderabad", "secunderabad", "hyd"] },
  { label: "Chennai", aliases: ["chennai", "madras"] },
  { label: "Mumbai", aliases: ["mumbai", "bombay", "navi mumbai", "thane"] },
  { label: "Pune", aliases: ["pune", "poona"] },
  { label: "Delhi", aliases: ["delhi", "new delhi"] },
  { label: "Gurugram", aliases: ["gurugram", "gurgaon"] },
  { label: "Noida", aliases: ["noida", "greater noida"] },
  { label: "Kolkata", aliases: ["kolkata", "calcutta"] },
  { label: "Ahmedabad", aliases: ["ahmedabad", "amdavad"] },
  { label: "Jaipur", aliases: ["jaipur"] },
  { label: "Kota", aliases: ["kota"] },
  { label: "Lucknow", aliases: ["lucknow"] },
  { label: "Chandigarh", aliases: ["chandigarh", "mohali", "panchkula"] },
  { label: "Indore", aliases: ["indore"] },
  { label: "Bhopal", aliases: ["bhopal"] },
  { label: "Nagpur", aliases: ["nagpur"] },
  { label: "Surat", aliases: ["surat"] },
  { label: "Vadodara", aliases: ["vadodara", "baroda"] },
  { label: "Patna", aliases: ["patna"] },
  { label: "Ranchi", aliases: ["ranchi"] },
  { label: "Bhubaneswar", aliases: ["bhubaneswar", "bhubaneshwar"] },
  { label: "Guwahati", aliases: ["guwahati", "gauhati"] },
  { label: "Kochi", aliases: ["kochi", "cochin", "ernakulam"] },
  { label: "Thiruvananthapuram", aliases: ["thiruvananthapuram", "trivandrum"] },
  { label: "Coimbatore", aliases: ["coimbatore", "kovai"] },
  { label: "Madurai", aliases: ["madurai"] },
  { label: "Tiruchirappalli", aliases: ["tiruchirappalli", "trichy"] },
  { label: "Visakhapatnam", aliases: ["visakhapatnam", "vizag"] },
  { label: "Vijayawada", aliases: ["vijayawada"] },
  { label: "Dehradun", aliases: ["dehradun"] },
  { label: "Varanasi", aliases: ["varanasi", "banaras", "benares"] },
  { label: "Prayagraj", aliases: ["prayagraj", "allahabad"] },
  { label: "Puducherry", aliases: ["puducherry", "pondicherry"] },
];

const KNOWN_STATUSES = ["Hot", "Warm", "Cold", "New", "Contacted", "Qualified", "Converted", "Lost"];

const STOPWORDS = new Set([
  "a", "an", "the", "in", "at", "on", "of", "for", "from", "to", "and", "or", "with", "near", "around",
  "me", "my", "show", "find", "get", "list", "search", "all", "any", "who", "are", "is", "want", "wants",
  "looking", "interested", "students", "student", "aspirants", "aspirant", "leads", "lead", "people",
  "training", "course", "courses", "class", "classes", "coaching", "developers", "developer", "learners",
  "candidates", "parents", "batch", "year", "exam", "city", "based", "score", "above", "over", "least",
  "minimum", "min", "ads", "ad", "form", "forms", "from", "via",
]);

const SOURCE_PATTERNS: { platform: SourcePlatform; detect: RegExp }[] = [
  { platform: "meta", detect: /\b(?:meta|facebook|fb|instagram|insta|ig)\b/i },
  { platform: "google", detect: /\b(?:google(?:\s+ads)?|adwords)\b/i },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasRegex(aliases: string[]): RegExp {
  return new RegExp(`\\b(?:${aliases.map(escapeRegExp).join("|")})\\b`, "i");
}

const CITY_REGEXES = CITIES.map((c) => ({ city: c, re: aliasRegex(c.aliases) }));

/** Strips characters that break PostgREST filter syntax or act as ilike wildcards. */
export function sanitizeFilterValue(value: string): string {
  return value.replace(/[,()"\\%*:{}]/g, " ").replace(/\s+/g, " ").trim();
}

function findCourse(text: string): { course: CourseDef; index: number; match: string } | null {
  let best: { course: CourseDef; index: number; match: string } | null = null;
  for (const course of COURSES) {
    const m = course.detect.exec(text);
    if (m && (best === null || m.index < best.index)) best = { course, index: m.index, match: m[0] };
  }
  return best;
}

function findCity(text: string): { city: CityDef; match: string } | null {
  let best: { city: CityDef; index: number; match: string } | null = null;
  for (const { city, re } of CITY_REGEXES) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { city, index: m.index, match: m[0] };
  }
  return best ? { city: best.city, match: best.match } : null;
}

/** Canonical course label ("neet ug" -> "NEET"); unknown courses are returned trimmed. */
export function canonicalCourse(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = sanitizeFilterValue(value);
  if (!trimmed) return null;
  return findCourse(trimmed)?.course.label ?? trimmed;
}

/** Canonical city label ("Bangalore" -> "Bengaluru"); unknown cities are returned trimmed. */
export function canonicalCity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = sanitizeFilterValue(value);
  if (!trimmed) return null;
  return findCity(trimmed)?.city.label ?? trimmed;
}

/** All spellings that should match a city in an ilike search. */
export function cityAliases(city: string): string[] {
  const clean = sanitizeFilterValue(city).toLowerCase();
  if (!clean) return [];
  const def = CITIES.find((c) => c.label.toLowerCase() === clean || c.aliases.includes(clean));
  return def ? def.aliases : [clean];
}

/** ilike fragments that should match a course (without surrounding %). */
export function coursePatterns(course: string): string[] {
  const clean = sanitizeFilterValue(course);
  if (!clean) return [];
  const def = COURSES.find((c) => c.label.toLowerCase() === clean.toLowerCase());
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
export function normalizeFilters(raw: any): LeadSearchFilters {
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
    course_interest: canonicalCourse(src.course_interest ?? src.course),
    city: canonicalCity(src.city ?? src.location),
    exam_year: canonicalYear(src.exam_year),
    source_platform: canonicalPlatform(src.source_platform),
    status: canonicalStatus(src.status),
    min_score: canonicalScore(src.min_score),
    keywords,
  };
}

/** Deterministic parser used when Sarvam is unavailable (and to fill gaps in its output). */
export function parseQueryKeywords(query: string): LeadSearchFilters {
  const filters = emptyFilters();
  let rest = ` ${String(query || "")} `;
  const consume = (match: string) => {
    rest = rest.replace(new RegExp(`\\b${escapeRegExp(match)}\\b`, "i"), " ");
  };

  const course = findCourse(rest);
  if (course) {
    filters.course_interest = course.course.label;
    consume(course.match);
  }

  const city = findCity(rest);
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
        .split(/[^a-z0-9+#.]+/)
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
