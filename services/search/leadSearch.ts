import { dbQueries } from "@ai-lead-gen/database";
import { sarvamClient, type SarvamConfig } from "../sarvam";
import { buildVocabulary, type DiscoverySettings, type SearchVocabulary } from "./vocabulary";
import {
  type LeadSearchFilters,
  cityAliases,
  coursePatterns,
  courseTags,
  hasStructuredFilter,
  mergeFilters,
  normalizeFilters,
  parseQueryKeywords,
} from "./queryParser";

export type ParsedBy = "sarvam" | "keywords";

export interface ParsedLeadQuery {
  filters: LeadSearchFilters;
  parsedBy: ParsedBy;
  /** Why Sarvam was not used, when parsedBy is "keywords". */
  parserWarning?: string;
}

export interface LeadSearchResult extends ParsedLeadQuery {
  leads: any[];
  signals: any[];
  warnings: string[];
}

/** Carries the parsed filters so callers can still report them when the DB query fails. */
export class LeadSearchError extends Error {
  constructor(message: string, readonly filters: LeadSearchFilters, readonly parsedBy: ParsedBy) {
    super(message);
    this.name = "LeadSearchError";
  }
}

const SARVAM_PARSER_TIMEOUT_MS = 30_000;
const MAX_KNOWN_INTERESTS = 40;

export interface LeadSearchOptions {
  /** Workspace discovery settings: business description and search vocabulary (interests, cities). */
  discovery?: DiscoverySettings;
  /** Workspace Sarvam credentials; the SARVAM_* env vars are used when absent. */
  sarvam?: SarvamConfig | null;
}

/** Sarvam turns the query into filters; the keyword parser is the fallback and fills gaps. */
export async function parseLeadQuery(query: string, options: LeadSearchOptions = {}): Promise<ParsedLeadQuery> {
  const vocab = buildVocabulary(options.discovery);
  const keywordFilters = parseQueryKeywords(query, vocab);

  if (!options.sarvam?.apiKey && !sarvamClient.isConfigured()) {
    return { filters: keywordFilters, parsedBy: "keywords", parserWarning: "Sarvam is not configured" };
  }

  try {
    const response = await sarvamClient.callAgent({
      agentId: "agt-query-parser",
      input: {
        query,
        business: options.discovery?.businessDescription ?? null,
        known_interests: vocab.interests.slice(0, MAX_KNOWN_INTERESTS).map((i) => i.label),
      },
      timeoutMs: SARVAM_PARSER_TIMEOUT_MS,
      maxAttempts: 2,
      config: options.sarvam ?? undefined,
    });
    if (!response.success) {
      const reason = response.error || "Sarvam returned no result";
      console.warn(`[LeadSearch] Sarvam query parser unavailable (${reason}); using keyword parser.`);
      return { filters: keywordFilters, parsedBy: "keywords", parserWarning: reason };
    }
    return { filters: mergeFilters(normalizeFilters(response.output, vocab), keywordFilters), parsedBy: "sarvam" };
  } catch (err: any) {
    const reason = err?.message || "Sarvam query parser failed";
    console.warn(`[LeadSearch] ${reason}; using keyword parser.`);
    return { filters: keywordFilters, parsedBy: "keywords", parserWarning: reason };
  }
}

/**
 * Searches stored leads (ad-form / consented leads and existing rows) and intent signals.
 * Never generates or inserts people. Throws LeadSearchError when the leads query fails.
 */
export async function runLeadSearch(orgId: string, query: string, options: LeadSearchOptions = {}): Promise<LeadSearchResult> {
  const parsed = await parseLeadQuery(query, options);
  const warnings: string[] = [];
  if (parsed.parserWarning) warnings.push(`Sarvam query parser unavailable: ${parsed.parserWarning}`);
  return searchWithFilters(orgId, parsed, buildVocabulary(options.discovery), warnings);
}

/**
 * Re-runs a search from filters a previous search returned (e.g. after the user removes a filter chip),
 * skipping query parsing. `rawFilters` is untrusted and normalized like parser output.
 */
export async function runFilteredLeadSearch(
  orgId: string,
  rawFilters: unknown,
  options: Pick<LeadSearchOptions, "discovery"> = {}
): Promise<LeadSearchResult> {
  const vocab = buildVocabulary(options.discovery);
  return searchWithFilters(orgId, { filters: normalizeFilters(rawFilters, vocab), parsedBy: "keywords" }, vocab, []);
}

async function searchWithFilters(
  orgId: string,
  parsed: ParsedLeadQuery,
  vocab: SearchVocabulary,
  warnings: string[]
): Promise<LeadSearchResult> {
  const { filters } = parsed;
  const structured = hasStructuredFilter(filters);
  const course = filters.course_interest ? coursePatterns(filters.course_interest, vocab) : [];
  const cities = filters.city ? cityAliases(filters.city, vocab) : [];

  let leads: any[] = [];
  if (structured || filters.keywords.length > 0) {
    try {
      leads = await dbQueries.searchLeads(orgId, {
        coursePatterns: course,
        courseTags: filters.course_interest ? courseTags(filters.course_interest) : [],
        cityAliases: cities,
        exam_year: filters.exam_year,
        source_platform: filters.source_platform,
        status: filters.status,
        min_score: filters.min_score,
        // Keywords are noisy next to structured filters; only use them when nothing else was recognised.
        keywords: structured ? [] : filters.keywords.slice(0, 5),
      });
    } catch (err: any) {
      throw new LeadSearchError(err?.message || "Lead search failed", filters, parsed.parsedBy);
    }
  } else {
    warnings.push("No interest, city, year, source, status or keyword was recognised in the query.");
  }

  let signals: any[] = [];
  if (course.length > 0 || cities.length > 0) {
    try {
      signals = await dbQueries.searchIntentSignals(orgId, {
        coursePatterns: course,
        cityAliases: cities,
        excludeDismissed: true,
        limit: 50,
      });
    } catch (err: any) {
      warnings.push(`Intent signals unavailable: ${err?.message}`);
    }
  }

  return { ...parsed, leads, signals, warnings };
}
