import { describe, expect, it } from "vitest";
import type { CampaignLeadRow } from "@ai-lead-gen/database";
import {
  EXCLUSION_LABELS,
  addressFor,
  audienceFilterSchema,
  candidateAddresses,
  evaluateLead,
  hasConsent,
  normalizeEmail,
  normalizePhone,
  readAudienceFilter,
  resolveAudience,
  toLeadCriteria,
} from "../../apps/api/src/campaigns/audience";

const OWNER = "3f6c2b1e-8d4a-4c7e-9b1a-2e5f6a7b8c9d";

function lead(overrides: Partial<CampaignLeadRow> = {}): CampaignLeadRow {
  return {
    id: "lead-1",
    name: "Asha Rao",
    title: null,
    company: null,
    email: "asha@example.com",
    phone: "9845012345",
    location: null,
    status: "New",
    source: null,
    score: 50,
    tags: null,
    course_interest: null,
    owner_id: null,
    do_not_contact: false,
    consent_channel: ["email", "whatsapp"],
    consent_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("audienceFilterSchema", () => {
  it("defaults to a filter audience", () => {
    expect(audienceFilterSchema.parse({})).toEqual({ type: "filter" });
  });

  it("accepts a full filter and trims text", () => {
    const parsed = audienceFilterSchema.parse({
      type: "filter",
      statuses: [" Hot ", "Warm"],
      sources: ["AI Agent"],
      tags: ["neet"],
      minScore: 0,
      maxScore: 100,
      ownerId: OWNER,
      createdAfter: "2026-01-01",
      createdBefore: "2026-02-01T00:00:00Z",
      courseInterest: " NEET ",
      location: "Bengaluru",
      q: "asha",
    });
    expect(parsed.statuses).toEqual(["Hot", "Warm"]);
    expect(parsed.courseInterest).toBe("NEET");
    expect(parsed.ownerId).toBe(OWNER);
  });

  it("accepts a null owner and equal min/max scores", () => {
    expect(audienceFilterSchema.safeParse({ ownerId: null, minScore: 60, maxScore: 60 }).success).toBe(true);
  });

  it.each([
    [{ type: "everyone" }],
    [{ minScore: -1 }],
    [{ maxScore: 101 }],
    [{ minScore: 50.5 }],
    [{ minScore: 80, maxScore: 20 }],
    [{ ownerId: "not-a-uuid" }],
    [{ createdAfter: "yesterday-ish" }],
    [{ statuses: [""] }],
    [{ statuses: Array.from({ length: 51 }, (_, i) => `s${i}`) }],
    [{ q: "x".repeat(201) }],
    [{ unknownKey: true }],
  ])("rejects %j", (input) => {
    expect(audienceFilterSchema.safeParse(input).success).toBe(false);
  });

  it("reports the score range error on minScore", () => {
    const result = audienceFilterSchema.safeParse({ minScore: 80, maxScore: 20 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["minScore"]);
  });
});

describe("readAudienceFilter", () => {
  it("parses valid stored filters", () => {
    expect(readAudienceFilter({ type: "manual" })).toEqual({ type: "manual" });
    expect(readAudienceFilter({ statuses: ["Hot"] })).toEqual({ type: "filter", statuses: ["Hot"] });
  });

  it("treats a missing filter as all leads", () => {
    expect(readAudienceFilter(null)).toEqual({ type: "filter" });
    expect(readAudienceFilter(undefined)).toEqual({ type: "filter" });
  });

  it("falls back to manual for invalid legacy rows", () => {
    expect(readAudienceFilter({ legacy: "x" })).toEqual({ type: "manual" });
    expect(readAudienceFilter("garbage")).toEqual({ type: "manual" });
  });
});

describe("toLeadCriteria", () => {
  it("copies every criterion and drops the type", () => {
    const filter = readAudienceFilter({ type: "filter", statuses: ["Hot"], minScore: 10, q: "x", ownerId: null });
    const criteria = toLeadCriteria(filter);
    expect(criteria).toMatchObject({ statuses: ["Hot"], minScore: 10, q: "x", ownerId: null });
    expect(criteria).not.toHaveProperty("type");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Asha.Rao@Example.COM ")).toBe("asha.rao@example.com");
  });

  it.each([null, undefined, "", "Not available", "asha@", "asha@example", "a b@example.com", "<a@b.com>", "a@b.c"])(
    "rejects %s",
    (v) => {
      expect(normalizeEmail(v)).toBeNull();
    }
  );
});

describe("normalizePhone", () => {
  it.each([
    ["9845012345", "919845012345"],
    ["98450 12345", "919845012345"],
    ["09845012345", "919845012345"],
    ["+91 98450-12345", "919845012345"],
    ["0091 98450 12345", "919845012345"],
    ["+1 (415) 555-0100", "14155550100"],
    ["919845012345", "919845012345"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("uses the given default country code for bare 10-digit numbers", () => {
    expect(normalizePhone("4155550100", "1")).toBe("14155550100");
  });

  it.each([null, undefined, "", "   ", "12345", "+1234567", "1234567890123456", "Not available"])("rejects %s", (v) => {
    expect(normalizePhone(v)).toBeNull();
  });

  it("accepts the 8 and 15 digit boundaries", () => {
    expect(normalizePhone("+12345678")).toBe("12345678");
    expect(normalizePhone("+123456789012345")).toBe("123456789012345");
  });
});

describe("addressFor", () => {
  it("picks the channel's address", () => {
    expect(addressFor(lead(), "email")).toBe("asha@example.com");
    expect(addressFor(lead(), "whatsapp")).toBe("919845012345");
    expect(addressFor(lead(), "whatsapp", "1")).toBe("19845012345");
    expect(addressFor(lead({ email: null }), "email")).toBeNull();
  });
});

describe("hasConsent", () => {
  it("accepts a matching consent channel, case-insensitively", () => {
    expect(hasConsent({ consent_channel: ["Email"], consent_at: null }, "email")).toBe(true);
    expect(hasConsent({ consent_channel: ["WHATSAPP"], consent_at: null }, "whatsapp")).toBe(true);
  });

  it("rejects other channels without a consent timestamp", () => {
    expect(hasConsent({ consent_channel: ["email"], consent_at: null }, "whatsapp")).toBe(false);
    expect(hasConsent({ consent_channel: null, consent_at: null }, "email")).toBe(false);
  });

  it("accepts any channel with a lead-form consent timestamp", () => {
    expect(hasConsent({ consent_channel: null, consent_at: "2026-01-01T00:00:00Z" }, "whatsapp")).toBe(true);
  });
});

describe("evaluateLead", () => {
  const none = new Set<string>();

  it("accepts an eligible lead", () => {
    expect(evaluateLead(lead(), "email", none)).toEqual({ eligible: true, address: "asha@example.com" });
  });

  it("checks do-not-contact first and still reports the address", () => {
    expect(evaluateLead(lead({ do_not_contact: true, consent_channel: null }), "email", none)).toEqual({
      eligible: false,
      reason: "do_not_contact",
      address: "asha@example.com",
    });
  });

  it("reports a missing address before consent", () => {
    expect(evaluateLead(lead({ email: "Not available", consent_channel: null }), "email", none)).toEqual({
      eligible: false,
      reason: "missing_address",
      address: null,
    });
  });

  it("excludes unsubscribed addresses", () => {
    expect(evaluateLead(lead({ email: "ASHA@example.com" }), "email", new Set(["asha@example.com"]))).toEqual({
      eligible: false,
      reason: "unsubscribed",
      address: "asha@example.com",
    });
    expect(evaluateLead(lead(), "whatsapp", new Set(["919845012345"]))).toMatchObject({ reason: "unsubscribed" });
  });

  it("excludes leads without consent", () => {
    expect(evaluateLead(lead({ consent_channel: ["email"] }), "whatsapp", none)).toEqual({
      eligible: false,
      reason: "no_consent",
      address: "919845012345",
    });
  });
});

describe("resolveAudience", () => {
  it("splits leads, counts exclusions and de-duplicates ids", () => {
    const leads = [
      lead({ id: "a" }),
      lead({ id: "a" }),
      lead({ id: "b", do_not_contact: true }),
      lead({ id: "c", email: null }),
      lead({ id: "d", email: "gone@example.com" }),
      lead({ id: "e", email: "e@example.com", consent_channel: [] }),
      lead({ id: "f", email: "f@example.com" }),
    ];
    const result = resolveAudience(leads, "email", new Set(["gone@example.com"]));
    expect(result.total).toBe(6);
    expect(result.eligible.map((e) => [e.lead.id, e.address])).toEqual([
      ["a", "asha@example.com"],
      ["f", "f@example.com"],
    ]);
    expect(result.excluded.map((e) => [e.lead.id, e.reason])).toEqual([
      ["b", "do_not_contact"],
      ["c", "missing_address"],
      ["d", "unsubscribed"],
      ["e", "no_consent"],
    ]);
    expect(result.excludedCounts).toEqual({ do_not_contact: 1, no_consent: 1, unsubscribed: 1, missing_address: 1 });
  });

  it("handles an empty audience", () => {
    expect(resolveAudience([], "whatsapp", new Set())).toEqual({
      total: 0,
      eligible: [],
      excluded: [],
      excludedCounts: { do_not_contact: 0, no_consent: 0, unsubscribed: 0, missing_address: 0 },
    });
  });

  it("has a label for every exclusion reason", () => {
    expect(Object.keys(EXCLUSION_LABELS).sort()).toEqual(["do_not_contact", "missing_address", "no_consent", "unsubscribed"]);
  });
});

describe("candidateAddresses", () => {
  it("returns only valid addresses for the channel", () => {
    const leads = [lead({ id: "a" }), lead({ id: "b", email: "bad", phone: "123" }), lead({ id: "c", phone: "+1 415 555 0100" })];
    expect(candidateAddresses(leads, "email")).toEqual(["asha@example.com", "asha@example.com"]);
    expect(candidateAddresses(leads, "whatsapp")).toEqual(["919845012345", "14155550100"]);
  });
});
