/**
 * Lead scoring: rule-based signals blended with the AI fit / intent score Sarvam stored on the lead
 * (raw_answers.fit_score / raw_answers.intent_score), which is kept as an input and never
 * overwritten. Pure functions only (no I/O) so they can be unit tested; the Leads routes, the
 * discovery agent and the background scorer load org thresholds and persist the result.
 */

export interface ScoringThresholds {
  hot: number;
  warm: number;
}

export const DEFAULT_THRESHOLDS: ScoringThresholds = { hot: 80, warm: 50 };

export type ScoreBand = "Hot" | "Warm" | "Cold";

/** Lead fields the scorer reads (DB column names). Every field is optional. */
export interface ScorableLead {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  industry?: string | null;
  course_interest?: string | null;
  exam_year?: string | number | null;
  source?: string | null;
  source_platform?: string | null;
  consent_at?: string | null;
  consent_channel?: string[] | null;
  do_not_contact?: boolean | null;
  needs_guardian_consent?: boolean | null;
  is_guardian?: boolean | null;
  last_contacted_at?: string | null;
  /** Reads fit_score / intent_score (0-100) and scored_by ("sarvam" | "rules"). */
  raw_answers?: Record<string, any> | null;
}

export interface ScoreReason {
  rule: string;
  points: number;
}

export interface ScoreResult {
  score: number;
  band: ScoreBand;
  reasons: ScoreReason[];
}

/** Columns that change the score; a PATCH touching one of them triggers a rescore. */
export const SCORING_FIELDS: (keyof ScorableLead)[] = [
  "email",
  "phone",
  "company",
  "title",
  "location",
  "industry",
  "course_interest",
  "exam_year",
  "source",
  "source_platform",
  "consent_at",
  "consent_channel",
  "do_not_contact",
  "needs_guardian_consent",
  "is_guardian",
  "last_contacted_at",
  "raw_answers",
];

const DECISION_MAKER = /\b(founder|co-?founder|owner|ceo|cto|cfo|coo|cmo|chief|president|vp|vice president|director|head|principal|partner|manager)\b/i;
const HIGH_INTENT_SOURCE = /\b(referral|website|inbound|form|landing|webinar|event|ads?\b)/i;
const PLACEHOLDER = /^(not available|n\/?a|none|unknown|-+)$/i;
const RECENT_CONTACT_DAYS = 14;
const RECENT_CONSENT_DAYS = 7;
/** Share of the final score taken from the AI score when the lead has one; rules supply the rest. */
export const AI_SCORE_WEIGHT = 0.7;

const present = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && !PLACEHOLDER.test(value.trim());

export const isValidEmail = (value: unknown): boolean =>
  present(value) && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

export const isValidPhone = (value: unknown): boolean =>
  present(value) && value.replace(/\D/g, "").length >= 7;

export function bandFor(score: number, thresholds: ScoringThresholds = DEFAULT_THRESHOLDS): ScoreBand {
  if (score >= thresholds.hot) return "Hot";
  if (score >= thresholds.warm) return "Warm";
  return "Cold";
}

const daysSince = (value: string, now: Date) => (now.getTime() - new Date(value).getTime()) / 86_400_000;

function parseExamYear(value: unknown): number | null {
  const match = String(value ?? "").match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function cleanAiScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

/** The AI score stored on the lead (place fit score, else post intent score), or null. */
export function aiScoreOf(lead: ScorableLead): { score: number; rule: string } | null {
  const raw = lead.raw_answers && typeof lead.raw_answers === "object" ? lead.raw_answers : null;
  if (!raw) return null;
  const fit = cleanAiScore(raw.fit_score);
  if (fit !== null) return { score: fit, rule: raw.scored_by === "rules" ? "Listing fit score" : "AI fit score" };
  const intent = cleanAiScore(raw.intent_score);
  if (intent !== null) return { score: intent, rule: "AI intent score" };
  return null;
}

/**
 * Scores 0-100 from contact completeness, fit, source quality, consent and recent engagement.
 * With an AI score, positive signals are blended in at (1 - AI_SCORE_WEIGHT); penalties always
 * apply in full. Reasons always add up to the score before clamping.
 */
export function scoreLead(
  lead: ScorableLead,
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date()
): ScoreResult {
  const reasons: ScoreReason[] = [];
  const penalties: ScoreReason[] = [];
  const add = (rule: string, points: number) => (points < 0 ? penalties : reasons).push({ rule, points });

  if (isValidEmail(lead.email)) add("Has a valid email", 20);
  if (isValidPhone(lead.phone)) add("Has a phone number", 15);
  if (present(lead.company)) add("Company known", 10);
  if (present(lead.title)) {
    add("Job title known", 5);
    if (DECISION_MAKER.test(lead.title)) add("Decision-maker title", 10);
  }
  if (present(lead.location)) add("Location known", 5);
  if (present(lead.industry) || present(lead.course_interest)) add("Interest or industry known", 5);

  if (lead.source_platform === "meta" || lead.source_platform === "google") add("Submitted an ad lead form", 15);
  else if (present(lead.source) && HIGH_INTENT_SOURCE.test(lead.source)) add("High-intent source", 15);
  else if (present(lead.source)) add("Source recorded", 5);

  if (present(lead.consent_at) || (Array.isArray(lead.consent_channel) && lead.consent_channel.length > 0)) {
    add("Consent to contact", 10);
  }
  if (present(lead.consent_at)) {
    const days = daysSince(lead.consent_at, now);
    if (Number.isFinite(days) && days >= 0 && days <= RECENT_CONSENT_DAYS) add("Consented in the last 7 days", 5);
  }

  if (present(lead.last_contacted_at)) {
    const days = daysSince(lead.last_contacted_at, now);
    if (Number.isFinite(days) && days >= 0 && days <= RECENT_CONTACT_DAYS) add("Contacted in the last 14 days", 10);
  }

  const examYear = parseExamYear(lead.exam_year);
  if (examYear !== null && examYear >= now.getFullYear() && examYear <= now.getFullYear() + 1) add("Exam within a year", 5);
  if (lead.is_guardian === true) add("Parent or guardian enquiring", 5);

  if (lead.needs_guardian_consent) add("Needs guardian consent", -10);
  if (lead.do_not_contact) add("Do not contact", -40);

  const positives = reasons.reduce((sum, r) => sum + r.points, 0);
  const ai = aiScoreOf(lead);
  if (ai) {
    const blended = Math.round(AI_SCORE_WEIGHT * ai.score + (1 - AI_SCORE_WEIGHT) * Math.min(100, positives));
    reasons.unshift({ rule: ai.rule, points: blended - positives });
  }
  reasons.push(...penalties);

  const raw = reasons.reduce((sum, r) => sum + r.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, band: bandFor(score, thresholds), reasons };
}

/** Statuses that follow the score band. Pipeline statuses (Contacted, Qualified, Closed) are never overwritten. */
export const BAND_STATUSES = new Set(["New", "Hot", "Warm", "Cold"]);

/** The status a lead should have after scoring, given its current status. */
export function statusAfterScoring(currentStatus: string | null | undefined, band: ScoreBand): string {
  const status = currentStatus || "New";
  return BAND_STATUSES.has(status) ? band : status;
}
