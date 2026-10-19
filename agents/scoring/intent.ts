import { dbQueries } from "@ai-lead-gen/database";

export type IntentStatus = "Hot" | "Warm" | "Cold";

export interface IntentScore {
  score: number;
  status: IntentStatus;
}

const HOUR_MS = 60 * 60 * 1000;

function hasText(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function parseExamYear(value: unknown): number | null {
  const match = String(value ?? "").match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Deterministic intent score for a lead submitted through an ad lead form.
 * Signals: contactability, course interest, exam proximity, guardian answering and consent recency.
 */
export function scoreAdLeadIntent(lead: Record<string, any>, now: Date = new Date()): IntentScore {
  let score = 20;

  if (hasText(lead.phone)) score += 20;
  if (hasText(lead.email) && lead.email !== "Not available") score += 5;
  if (hasText(lead.course_interest)) score += 15;

  const examYear = parseExamYear(lead.exam_year);
  if (examYear !== null) {
    const yearsAway = examYear - now.getFullYear();
    if (yearsAway >= 0 && yearsAway <= 1) score += 20;
    else if (yearsAway === 2) score += 10;
  }

  if (lead.is_guardian === true) score += 10;

  const consentMs = lead.consent_at ? new Date(lead.consent_at).getTime() : NaN;
  if (!Number.isNaN(consentMs)) {
    const ageMs = now.getTime() - consentMs;
    if (ageMs <= 24 * HOUR_MS) score += 10;
    else if (ageMs <= 7 * 24 * HOUR_MS) score += 5;
  }

  if (lead.needs_guardian_consent === true) score -= 15;

  score = Math.min(100, Math.max(0, score));
  const status: IntentStatus = score >= 70 ? "Hot" : score >= 45 ? "Warm" : "Cold";
  return { score, status };
}

/** Scores ad-form leads that have no scored_at yet. Returns how many were scored. */
export async function scorePendingAdLeads(limit: number = 50): Promise<number> {
  const leads = await dbQueries.getUnscoredAdLeads(limit);
  const now = new Date();
  let scored = 0;
  for (const lead of leads) {
    const { score, status } = scoreAdLeadIntent(lead, now);
    await dbQueries.updateLeadScore(lead.id, score, status, now.toISOString());
    scored++;
  }
  return scored;
}
