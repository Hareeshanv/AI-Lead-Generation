export type Platform = "meta" | "google";

export interface FormAnswer {
  key: string;
  value: string;
}

export interface RawAdLead {
  platform: Platform;
  externalLeadId: string;
  formId: string | null;
  campaignName: string | null;
  adName: string | null;
  submittedAt: string;
  answers: FormAnswer[];
  isTest: boolean;
  academyId: string | null;
  academyName: string | null;
  extra?: Record<string, unknown>;
}

export interface LeadRow {
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  status: string;
  score: number;
  scored_at: null;
  source: string;
  tags: string[];
  academy_id: string | null;
  source_platform: Platform;
  external_lead_id: string;
  form_id: string | null;
  campaign_name: string | null;
  ad_name: string | null;
  course_interest: string | null;
  exam_year: string | null;
  is_guardian: boolean | null;
  needs_guardian_consent: boolean;
  consent_at: string;
  raw_answers: Record<string, unknown>;
}

const SOURCE_LABEL: Record<Platform, string> = {
  meta: "Meta Lead Ads",
  google: "Google Ads Lead Form",
};

function keyOf(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]/.test(digits.slice(1))) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.slice(2))) {
    return `+${digits}`;
  }
  if (digits.length === 13 && digits.startsWith("091")) return `+${digits.slice(1)}`;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

function normalizeEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

function normalizeTimestamp(raw: string): string {
  // Meta sends "+0000" offsets; make them ISO-8601 ("+00:00") before parsing.
  const fixed = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(fixed);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

const NAME_KEYS = new Set(["full name", "name", "your name", "student name"]);
const FIRST_NAME_KEYS = new Set(["first name", "given name"]);
const LAST_NAME_KEYS = new Set(["last name", "surname", "family name"]);
const EMAIL_KEYS = new Set(["email", "email address", "work email"]);
const PHONE_KEYS = new Set(["phone", "phone number", "mobile", "mobile number", "whatsapp number"]);
const CITY_KEYS = new Set(["city", "location"]);

function isGuardianQuestion(key: string): boolean {
  return key.startsWith("i am a") || key.includes("guardian") || key.includes("parent") ||
    key.includes("who are you");
}

function looksLikeYear(value: string): boolean {
  return /\b20\d{2}\b/.test(value);
}

function indicatesUnder18(value: string): boolean {
  return /(under|below|less than)\s*18|<\s*18|\bminor\b/i.test(value);
}

export function normalizeLead(input: RawAdLead): LeadRow {
  let fullName: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  let city: string | null = null;
  let courseInterest: string | null = null;
  let examYear: string | null = null;
  let isGuardian: boolean | null = null;
  let needsGuardianConsent = false;
  const answers: Record<string, string> = {};

  for (const { key: rawKey, value: rawValue } of input.answers) {
    const value = (rawValue ?? "").trim();
    if (!rawKey || !value) continue;
    answers[rawKey] = value;
    const key = keyOf(rawKey);

    if (NAME_KEYS.has(key)) fullName ??= value;
    else if (FIRST_NAME_KEYS.has(key)) firstName ??= value;
    else if (LAST_NAME_KEYS.has(key)) lastName ??= value;
    else if (EMAIL_KEYS.has(key) || key.includes("email")) email ??= normalizeEmail(value);
    else if (PHONE_KEYS.has(key) || key.includes("phone") || key.includes("mobile")) {
      phone ??= normalizePhone(value);
    } else if (CITY_KEYS.has(key)) city ??= value;
    else if (isGuardianQuestion(key)) {
      const answer = value.toLowerCase();
      if (answer.includes("parent") || answer.includes("guardian")) {
        isGuardian = true;
      } else if (answer.includes("student") || indicatesUnder18(answer) || /18\s*\+/.test(answer)) {
        isGuardian = false;
        if (indicatesUnder18(answer)) needsGuardianConsent = true;
      }
    } else if (key.includes("year")) examYear ??= value;
    else if (key.includes("course") || key.includes("program")) courseInterest ??= value;
    else if (key.includes("exam")) {
      if (looksLikeYear(value)) examYear ??= value;
      else courseInterest ??= value;
    }
  }

  const name = fullName ?? ([firstName, lastName].filter(Boolean).join(" ") || "Unknown");
  const tags: string[] = [input.platform];
  if (input.isTest) tags.push("test");

  return {
    name,
    company: input.academyName ?? "",
    email,
    phone,
    location: city,
    status: "New",
    score: 0,
    scored_at: null,
    source: SOURCE_LABEL[input.platform],
    tags,
    academy_id: input.academyId,
    source_platform: input.platform,
    external_lead_id: input.externalLeadId,
    form_id: input.formId,
    campaign_name: input.campaignName,
    ad_name: input.adName,
    course_interest: courseInterest,
    exam_year: examYear,
    is_guardian: isGuardian,
    needs_guardian_consent: needsGuardianConsent,
    consent_at: normalizeTimestamp(input.submittedAt),
    raw_answers: { answers, ...(input.extra ?? {}) },
  };
}
