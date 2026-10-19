import { z } from "zod";
import type { CampaignChannel, CampaignLeadRow, LeadCriteria } from "@ai-lead-gen/database";

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

const textList = z.array(z.string().trim().min(1).max(100)).max(50);

/**
 * Stored in campaigns.audience_filter.
 * type "filter": every lead matching the criteria (no criteria = all leads) plus leads added manually.
 * type "manual": only leads added with POST /api/campaigns/:id/leads.
 */
export const audienceFilterSchema = z
  .object({
    type: z.enum(["filter", "manual"]).default("filter"),
    statuses: textList.optional(),
    sources: textList.optional(),
    tags: textList.optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    maxScore: z.number().int().min(0).max(100).optional(),
    ownerId: z.string().uuid().nullable().optional(),
    createdAfter: isoDate.optional(),
    createdBefore: isoDate.optional(),
    courseInterest: z.string().trim().max(100).optional(),
    location: z.string().trim().max(100).optional(),
    q: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((f) => f.minScore == null || f.maxScore == null || f.minScore <= f.maxScore, {
    message: "Minimum score must not exceed the maximum score",
    path: ["minScore"],
  });

export type AudienceFilter = z.output<typeof audienceFilterSchema>;

/** Reads a stored filter, tolerating rows written before the schema existed. */
export function readAudienceFilter(raw: unknown): AudienceFilter {
  const parsed = audienceFilterSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { type: "manual" };
}

export function toLeadCriteria(filter: AudienceFilter): LeadCriteria {
  return {
    statuses: filter.statuses,
    sources: filter.sources,
    tags: filter.tags,
    minScore: filter.minScore,
    maxScore: filter.maxScore,
    ownerId: filter.ownerId,
    createdAfter: filter.createdAfter,
    createdBefore: filter.createdBefore,
    courseInterest: filter.courseInterest,
    location: filter.location,
    q: filter.q,
  };
}

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

/** Lowercased email, or null for placeholders like "Not available". */
export function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value || "").trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

/**
 * WhatsApp address: digits with country code, no "+". A bare 10-digit number gets
 * `defaultCountryCode` (India by default); a leading 0 trunk prefix is dropped.
 */
export function normalizePhone(value: string | null | undefined, defaultCountryCode = "91"): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  else if (!raw.startsWith("+")) {
    digits = digits.replace(/^0+/, "");
    if (digits.length === 10) digits = `${defaultCountryCode}${digits}`;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function addressFor(
  lead: Pick<CampaignLeadRow, "email" | "phone">,
  channel: CampaignChannel,
  defaultCountryCode?: string
): string | null {
  return channel === "email" ? normalizeEmail(lead.email) : normalizePhone(lead.phone, defaultCountryCode);
}

export type ExclusionReason = "do_not_contact" | "no_consent" | "unsubscribed" | "missing_address";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  do_not_contact: "Marked do not contact",
  no_consent: "No consent for this channel",
  unsubscribed: "Unsubscribed",
  missing_address: "No valid email / phone",
};

/**
 * Consent for a channel: the lead's consent_channel lists it, or the lead submitted a lead form
 * with a consent timestamp (Meta / Google lead ads).
 */
export function hasConsent(lead: Pick<CampaignLeadRow, "consent_channel" | "consent_at">, channel: CampaignChannel): boolean {
  if ((lead.consent_channel || []).map((c) => c.toLowerCase()).includes(channel)) return true;
  return !!lead.consent_at;
}

export type Eligibility = { eligible: true; address: string } | { eligible: false; reason: ExclusionReason; address: string | null };

export function evaluateLead(
  lead: Pick<CampaignLeadRow, "email" | "phone" | "do_not_contact" | "consent_channel" | "consent_at">,
  channel: CampaignChannel,
  unsubscribed: ReadonlySet<string>,
  defaultCountryCode?: string
): Eligibility {
  const address = addressFor(lead, channel, defaultCountryCode);
  if (lead.do_not_contact) return { eligible: false, reason: "do_not_contact", address };
  if (!address) return { eligible: false, reason: "missing_address", address: null };
  if (unsubscribed.has(address.toLowerCase())) return { eligible: false, reason: "unsubscribed", address };
  if (!hasConsent(lead, channel)) return { eligible: false, reason: "no_consent", address };
  return { eligible: true, address };
}

export interface ResolvedAudience<L extends { id: string }> {
  total: number;
  eligible: { lead: L; address: string }[];
  excluded: { lead: L; reason: ExclusionReason }[];
  excludedCounts: Record<ExclusionReason, number>;
}

/** Splits leads into eligible recipients and exclusions; duplicate lead ids are counted once. */
export function resolveAudience<L extends CampaignLeadRow>(
  leads: L[],
  channel: CampaignChannel,
  unsubscribed: ReadonlySet<string>,
  defaultCountryCode?: string
): ResolvedAudience<L> {
  const seen = new Set<string>();
  const result: ResolvedAudience<L> = {
    total: 0,
    eligible: [],
    excluded: [],
    excludedCounts: { do_not_contact: 0, no_consent: 0, unsubscribed: 0, missing_address: 0 },
  };
  for (const lead of leads) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    result.total += 1;
    const verdict = evaluateLead(lead, channel, unsubscribed, defaultCountryCode);
    if (verdict.eligible) result.eligible.push({ lead, address: verdict.address });
    else {
      result.excluded.push({ lead, reason: verdict.reason });
      result.excludedCounts[verdict.reason] += 1;
    }
  }
  return result;
}

/** Candidate addresses to check against unsubscribes. */
export function candidateAddresses(leads: CampaignLeadRow[], channel: CampaignChannel, defaultCountryCode?: string): string[] {
  const out: string[] = [];
  for (const lead of leads) {
    const address = addressFor(lead, channel, defaultCountryCode);
    if (address) out.push(address);
  }
  return out;
}
