/**
 * Normalises intent-signal JSON produced by the Sarvam platform agent into intent_signals rows.
 * Signals are public posts showing course intent. Contact details inside free text are redacted
 * before storage; the only exception is published_contact, kept when the author explicitly asked
 * to be contacted and published that phone/email in the same text (see verifyRequestedContact).
 */

export const SIGNAL_STATUSES = ["new", "replied", "routed", "dismissed"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const LOCATION_MATCHES = ["exact", "nearby", "state"] as const;
export type LocationMatch = (typeof LOCATION_MATCHES)[number];

export interface IntentSignalRow {
  post_url: string;
  source_channel: string | null;
  post_excerpt: string | null;
  post_date: string | null;
  city: string | null;
  course_interest: string | null;
  urgency: string | null;
  budget: string | null;
  intent_score: number | null;
  lead_routing_category: string | null;
  suggested_public_reply: string | null;
  /** Public username or display name shown on the post; never a phone or email. */
  author_handle?: string | null;
  platform?: string | null;
  /** True only together with a verified published_contact. */
  contact_requested?: boolean;
  /** Phone/email exactly as the author published it next to an explicit contact request. */
  published_contact?: string | null;
  /** The author's sentence containing the contact request (max 300 chars). */
  contact_request_quote?: string | null;
  location_match?: LocationMatch | null;
  search_query?: string | null;
  search_city?: string | null;
  discovered_at?: string | null;
  status?: SignalStatus;
  updated_at: string;
}

export interface PreparedSignalImport {
  rows: IntentSignalRow[];
  skipped: number;
  reasons: string[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// +91 / 0091 / 91 prefixed numbers in any spacing, and bare Indian mobiles ([6-9] followed by 9 digits, optionally split 5+5).
const PHONE_PLUS91_RE = /(?:\+|\b00)\s*91[\s-]*\d(?:[\s-]*\d){7,10}/g;
const PHONE_MOBILE_RE = /(?<!\d)(?:91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const REDACTED = "[contact removed]";

const CONTACT_REQUEST_RE =
  /\b(?:call me|contact me|send (?:me )?details|dm me|whatsapp me|message me|share (?:the )?(?:details|info)|ping me|reach me)\b|\binterested.{0,20}contact/i;
export const MAX_CONTACT_QUOTE_LENGTH = 300;

export interface RequestedContact {
  contact_requested: boolean;
  published_contact: string | null;
  contact_request_quote: string | null;
}

const NO_REQUESTED_CONTACT: RequestedContact = {
  contact_requested: false,
  published_contact: null,
  contact_request_quote: null,
};

export function isSignalStatus(value: unknown): value is SignalStatus {
  return typeof value === "string" && (SIGNAL_STATUSES as readonly string[]).includes(value);
}

export function isLocationMatch(value: unknown): value is LocationMatch {
  return typeof value === "string" && (LOCATION_MATCHES as readonly string[]).includes(value);
}

export function containsContactDetails(text: string): boolean {
  return [EMAIL_RE, PHONE_PLUS91_RE, PHONE_MOBILE_RE].some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/** Lowercased email, or the last 10 digits of a phone number, so differently spaced copies compare equal. */
function contactKey(value: string): string {
  return value.includes("@") ? value.trim().toLowerCase() : value.replace(/\D/g, "").slice(-10);
}

/** Replaces emails and Indian phone numbers with a placeholder, except the one equal to `keep`. */
export function redactContactDetails(text: string, keep?: string | null): string {
  const keepKey = keep ? contactKey(keep) : null;
  const replace = (match: string) => (keepKey && contactKey(match) === keepKey ? match : REDACTED);
  return text.replace(EMAIL_RE, replace).replace(PHONE_PLUS91_RE, replace).replace(PHONE_MOBILE_RE, replace);
}

export function hasContactRequest(text: string): boolean {
  return CONTACT_REQUEST_RE.test(text);
}

/** Every email / Indian phone number in the text, exactly as written, in order of appearance. */
export function findContactDetails(text: string): string[] {
  const found: { start: number; end: number; value: string }[] = [];
  for (const re of [EMAIL_RE, PHONE_PLUS91_RE, PHONE_MOBILE_RE]) {
    const scan = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = scan.exec(text)) !== null) {
      found.push({ start: m.index, end: m.index + m[0].length, value: m[0].trim() });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof found = [];
  for (const f of found) {
    if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  }
  return kept.map((k) => k.value);
}

/** True when `contact` is a single phone/email that is also written in `text` (digit / case normalised). */
export function contactAppearsIn(contact: string, text: string): boolean {
  const own = findContactDetails(contact);
  if (own.length !== 1) return false;
  const key = contactKey(own[0]);
  return key.length >= 6 && findContactDetails(text).some((c) => contactKey(c) === key);
}

function clipQuote(sentence: string): string {
  if (sentence.length <= MAX_CONTACT_QUOTE_LENGTH) return sentence;
  const at = sentence.search(CONTACT_REQUEST_RE);
  const start = Math.max(0, Math.min(at - 100, sentence.length - MAX_CONTACT_QUOTE_LENGTH));
  return sentence.slice(start, start + MAX_CONTACT_QUOTE_LENGTH).trim();
}

/**
 * Finds a phone/email that the author published in `text` together with an explicit request to be
 * contacted (e.g. "interested, please call me on 98xxxxxxxx"). `proposed` (for example a model's
 * suggestion) is only used when it is one of the contacts written in the text; nothing else is trusted.
 */
export function requestedContactFromText(text: string, proposed?: unknown): RequestedContact {
  if (!text || !hasContactRequest(text)) return NO_REQUESTED_CONTACT;
  const contacts = findContactDetails(text);
  if (contacts.length === 0) return NO_REQUESTED_CONTACT;

  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && hasContactRequest(s));
  const wanted = typeof proposed === "string" ? contactKey(proposed) : "";
  const inRequest = sentences.flatMap(findContactDetails);
  const contact =
    (wanted && contacts.find((c) => contactKey(c) === wanted)) || inRequest[0] || contacts[0];
  const sentence = sentences.find((s) => contactAppearsIn(contact, s)) || sentences[0] || text;
  return {
    contact_requested: true,
    published_contact: contact,
    contact_request_quote: clipQuote(redactContactDetails(sentence, contact)),
  };
}

/**
 * Imported contacts are kept only when contact_requested === true and the quote both contains an
 * explicit contact request and the published phone/email itself. Returns why a contact was dropped.
 */
export function verifyImportedContact(src: Record<string, any>): { contact: RequestedContact; problem: string | null } {
  const contact = text(src.published_contact, 200);
  const quote = text(src.contact_request_quote, MAX_CONTACT_QUOTE_LENGTH);
  const requested = src.contact_requested === true;
  const drop = (problem: string | null) => ({ contact: NO_REQUESTED_CONTACT, problem });

  if (!contact) return drop(requested || quote ? "contact_requested ignored (no published_contact)" : null);
  if (!requested) return drop("dropped published_contact (contact_requested is not true)");
  if (findContactDetails(contact).length !== 1) return drop("dropped published_contact (not a single phone number or email)");
  if (!quote || !hasContactRequest(quote)) {
    return drop("dropped published_contact (contact_request_quote has no explicit contact request)");
  }
  if (!contactAppearsIn(contact, quote)) {
    return drop("dropped published_contact (it does not appear in contact_request_quote)");
  }
  return {
    contact: {
      contact_requested: true,
      published_contact: contact,
      contact_request_quote: redactContactDetails(quote, contact),
    },
    problem: null,
  };
}

function pick(item: Record<string, any>, keys: string[]): unknown {
  for (const key of keys) {
    const v = item[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function text(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const s = (Array.isArray(value) ? value.join(", ") : String(value)).trim();
  return s ? s.slice(0, maxLength) : null;
}

function score(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(typeof value === "string" ? value.replace(/[^\d.+-]/g, "") : value);
  return Number.isFinite(n) ? n : null;
}

function postUrl(value: unknown): string | null {
  const s = text(value, 2000);
  if (!s) return null;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Accepts {signals:[...]}, {leads:[...]}, {intent_signals:[...]}, {results:[...]} or a raw array. */
export function extractSignalItems(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const obj = body as Record<string, any>;
    for (const key of ["signals", "leads", "intent_signals", "results", "data"]) {
      if (Array.isArray(obj[key])) return obj[key];
    }
  }
  return null;
}

export function prepareSignalImport(body: unknown): PreparedSignalImport {
  const items = extractSignalItems(body);
  if (!items) {
    return {
      rows: [],
      skipped: 0,
      reasons: ["Expected a JSON array or an object with a signals/leads array"],
    };
  }

  const reasons: string[] = [];
  const byUrl = new Map<string, IntentSignalRow>();
  let skipped = 0;
  const now = new Date().toISOString();

  items.forEach((item, index) => {
    const label = `Item ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      skipped++;
      reasons.push(`${label}: not an object`);
      return;
    }
    const src = item as Record<string, any>;
    const url = postUrl(pick(src, ["post_url", "url", "source_url", "link", "post_link"]));
    if (!url) {
      skipped++;
      reasons.push(`${label}: missing or invalid post_url`);
      return;
    }

    const redactedFields: string[] = [];
    const clean = (field: string, value: string | null): string | null => {
      if (value === null || !containsContactDetails(value)) return value;
      redactedFields.push(field);
      return redactContactDetails(value);
    };

    const status = pick(src, ["status"]);
    const row: IntentSignalRow = {
      post_url: url,
      source_channel: clean("source_channel", text(pick(src, ["source_channel", "channel", "platform", "source"]), 200)),
      post_excerpt: clean("post_excerpt", text(pick(src, ["post_excerpt", "excerpt", "snippet", "post_text", "text"]), 2000)),
      post_date: text(pick(src, ["post_date", "date", "posted_at"]), 100),
      city: clean("city", text(pick(src, ["city", "location"]), 200)),
      course_interest: clean("course_interest", text(pick(src, ["course_interest", "course", "interest"]), 200)),
      urgency: clean("urgency", text(pick(src, ["urgency"]), 200)),
      budget: clean("budget", text(pick(src, ["budget"]), 200)),
      intent_score: score(pick(src, ["intent_score", "score"])),
      lead_routing_category: clean(
        "lead_routing_category",
        text(pick(src, ["lead_routing_category", "routing_category", "category"]), 200)
      ),
      suggested_public_reply: clean(
        "suggested_public_reply",
        text(pick(src, ["suggested_public_reply", "suggested_reply", "reply"]), 2000)
      ),
      author_handle: clean("author_handle", text(pick(src, ["author_handle", "author", "username", "handle"]), 200)),
      platform: clean("platform", text(pick(src, ["platform"]), 100)),
      location_match: isLocationMatch(src.location_match) ? src.location_match : null,
      updated_at: now,
    };
    if (isSignalStatus(status)) row.status = status;

    const { contact, problem } = verifyImportedContact(src);
    Object.assign(row, contact);
    if (problem) reasons.push(`${label}: ${problem}`);

    if (redactedFields.length > 0) {
      reasons.push(`${label}: removed phone/email from ${redactedFields.join(", ")}`);
    }
    if (byUrl.has(url)) {
      skipped++;
      reasons.push(`${label}: duplicate post_url in this file (last one kept)`);
    }
    byUrl.set(url, row);
  });

  return { rows: Array.from(byUrl.values()), skipped, reasons };
}
