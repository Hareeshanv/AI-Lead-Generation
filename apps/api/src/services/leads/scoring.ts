/**
 * Rule-based lead scoring. Pure functions only (no I/O) so they can be unit tested; the Leads
 * routes and the lead.rescore job load org thresholds and persist the result.
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
  last_contacted_at?: string | null;
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
  "last_contacted_at",
];

const DECISION_MAKER = /\b(founder|co-?founder|owner|ceo|cto|cfo|coo|cmo|chief|president|vp|vice president|director|head|principal|partner|manager)\b/i;
const HIGH_INTENT_SOURCE = /\b(referral|website|inbound|form|landing|webinar|event|ads?\b)/i;
const PLACEHOLDER = /^(not available|n\/?a|none|unknown|-+)$/i;
const RECENT_CONTACT_DAYS = 14;

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

/** Scores 0-100 from contact completeness, fit, source quality, consent and recent engagement. */
export function scoreLead(
  lead: ScorableLead,
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date()
): ScoreResult {
  const reasons: ScoreReason[] = [];
  const add = (rule: string, points: number) => reasons.push({ rule, points });

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

  if (present(lead.last_contacted_at)) {
    const days = (now.getTime() - new Date(lead.last_contacted_at).getTime()) / 86_400_000;
    if (Number.isFinite(days) && days >= 0 && days <= RECENT_CONTACT_DAYS) add("Contacted in the last 14 days", 10);
  }

  if (lead.exam_year != null && String(lead.exam_year).trim() !== "") {
    const year = Number(String(lead.exam_year).trim());
    const current = now.getFullYear();
    if (Number.isFinite(year) && year >= current && year <= current + 1) add("Exam within a year", 5);
  }

  if (lead.needs_guardian_consent) add("Needs guardian consent", -10);
  if (lead.do_not_contact) add("Do not contact", -40);

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
