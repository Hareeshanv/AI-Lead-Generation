/**
 * Workspace search vocabulary: which interests (products, services, courses) and cities the keyword
 * parser and the discovery agent recognise, plus the market (country, language) and a short business
 * description for the AI prompts. Stored per workspace in org_settings.discovery; everything here is
 * pure so it can be unit tested.
 */

export interface TermDef {
  label: string;
  aliases: string[];
}

export interface InterestDef {
  label: string;
  detect: RegExp;
  /** ilike fragments (without surrounding %); "%" inside acts as a wildcard. */
  patterns: string[];
}

export interface CityDef {
  label: string;
  /** Lowercase spellings, the label first. */
  aliases: string[];
  detect: RegExp;
}

export interface SearchVocabulary {
  interests: InterestDef[];
  cities: CityDef[];
}

export const INTEREST_PRESETS = ["none", "education"] as const;
export type InterestPreset = (typeof INTEREST_PRESETS)[number];

export interface DiscoverySettings {
  /** What the workspace sells, used in AI prompts (e.g. "dental clinics"); null for a generic prompt. */
  businessDescription: string | null;
  /** ISO 3166-1 alpha-2 country code (lowercase) for Google results and the built-in city list. */
  country: string;
  /** Google interface language, e.g. "en". */
  language: string;
  /** Built-in interest vocabulary added after the workspace's own interests. */
  interestPreset: InterestPreset;
  interests: TermDef[];
  cities: TermDef[];
}

export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = {
  businessDescription: null,
  country: "in",
  language: "en",
  interestPreset: "none",
  interests: [],
  cities: [],
};

export const MAX_CUSTOM_TERMS = 100;
const MAX_ALIASES = 20;
const MAX_TERM_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 300;

// Letters (any script), combining marks and digits; used instead of \b so non-Latin aliases match.
const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase, NFKC-normalised, single-spaced. */
export function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Matches any alias as a whole word in any script; spaces and hyphens inside an alias are interchangeable. */
export function aliasRegex(aliases: string[]): RegExp {
  const alternatives = aliases
    .map(normalizeTerm)
    .filter(Boolean)
    .map((alias) => alias.split(/[\s-]+/).map(escapeRegExp).join("[\\s-]*"));
  if (alternatives.length === 0) return /(?!)/;
  return new RegExp(`(?<!${WORD_CHAR})(?:${alternatives.join("|")})(?!${WORD_CHAR})`, "iu");
}

/** True when `text` mentions `alias` as a whole word (any script); empty aliases never match. */
export function mentionsTerm(text: string, alias: string): boolean {
  if (!normalizeTerm(alias)) return false;
  return aliasRegex([alias]).test(text.normalize("NFKC"));
}

// Characters that break PostgREST filter syntax or act as ilike wildcards (see sanitizeFilterValue).
const FILTER_SPECIAL = /[,()"\\%*:{}]/g;

function interestFromTerm(term: TermDef): InterestDef {
  const spellings = Array.from(new Set([term.label, ...term.aliases].map(normalizeTerm).filter(Boolean)));
  const patterns = spellings
    .map((s) => s.replace(FILTER_SPECIAL, " ").trim().split(/[\s-]+/).filter(Boolean).join("%"))
    .filter(Boolean);
  return { label: term.label, detect: aliasRegex(spellings), patterns: Array.from(new Set(patterns)) };
}

function cityFromTerm(term: TermDef): CityDef {
  const aliases = Array.from(new Set([term.label, ...term.aliases].map(normalizeTerm).filter(Boolean)));
  return { label: term.label, aliases, detect: aliasRegex(aliases) };
}

// ---- Built-in lists ---------------------------------------------------------------------------

/** Courses and exams for coaching institutes / training academies (the "education" preset). */
const EDUCATION_INTERESTS: InterestDef[] = [
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

/** Indian cities and their common spellings; used when the workspace country is "in". */
const INDIA_CITIES: CityDef[] = [
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
].map((c) => ({ ...c, detect: aliasRegex(c.aliases) }));

const PRESET_INTERESTS: Record<InterestPreset, InterestDef[]> = { none: [], education: EDUCATION_INTERESTS };
const COUNTRY_CITIES: Record<string, CityDef[]> = { in: INDIA_CITIES };

// ---- Settings ---------------------------------------------------------------------------------

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}

function cleanTerms(value: unknown): TermDef[] {
  if (!Array.isArray(value)) return [];
  const out: TermDef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = cleanText(item.label, MAX_TERM_LENGTH);
    if (!label || seen.has(normalizeTerm(label))) continue;
    seen.add(normalizeTerm(label));
    const aliases = Array.isArray(item.aliases)
      ? Array.from(
          new Set(item.aliases.map((a) => cleanText(a, MAX_TERM_LENGTH)).filter((a): a is string => Boolean(a)))
        ).slice(0, MAX_ALIASES)
      : [];
    out.push({ label, aliases });
    if (out.length >= MAX_CUSTOM_TERMS) break;
  }
  return out;
}

/** Coerces stored (untrusted) org_settings.discovery JSON into complete settings. */
export function normalizeDiscoverySettings(raw: unknown): DiscoverySettings {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const country = typeof src.country === "string" && /^[a-z]{2}$/i.test(src.country.trim()) ? src.country.trim().toLowerCase() : null;
  const language =
    typeof src.language === "string" && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(src.language.trim()) ? src.language.trim() : null;
  const preset = (INTEREST_PRESETS as readonly string[]).includes(src.interestPreset as string)
    ? (src.interestPreset as InterestPreset)
    : null;
  return {
    businessDescription: cleanText(src.businessDescription, MAX_DESCRIPTION_LENGTH),
    country: country ?? DEFAULT_DISCOVERY_SETTINGS.country,
    language: language ?? DEFAULT_DISCOVERY_SETTINGS.language,
    interestPreset: preset ?? DEFAULT_DISCOVERY_SETTINGS.interestPreset,
    interests: cleanTerms(src.interests),
    cities: cleanTerms(src.cities),
  };
}

/** Workspace terms first (they win ties), then the preset interests and the country's built-in cities. */
export function buildVocabulary(settings: DiscoverySettings = DEFAULT_DISCOVERY_SETTINGS): SearchVocabulary {
  return {
    interests: [...settings.interests.map(interestFromTerm), ...PRESET_INTERESTS[settings.interestPreset]],
    cities: [...settings.cities.map(cityFromTerm), ...(COUNTRY_CITIES[settings.country] ?? [])],
  };
}

/** Generic interests and Indian cities (the default market). */
export const DEFAULT_VOCABULARY: SearchVocabulary = buildVocabulary(DEFAULT_DISCOVERY_SETTINGS);

/** The "education" preset with the default market; mainly for tests and existing coaching workspaces. */
export const EDUCATION_VOCABULARY: SearchVocabulary = buildVocabulary({ ...DEFAULT_DISCOVERY_SETTINGS, interestPreset: "education" });
