import { describe, expect, it } from "vitest";
import {
  BAND_STATUSES,
  DEFAULT_THRESHOLDS,
  SCORING_FIELDS,
  bandFor,
  isValidEmail,
  isValidPhone,
  scoreLead,
  statusAfterScoring,
  type ScorableLead,
} from "../../apps/api/src/services/leads/scoring";

const NOW = new Date("2026-06-15T12:00:00Z");
const rules = (lead: ScorableLead, now = NOW) => scoreLead(lead, DEFAULT_THRESHOLDS, now).reasons.map((r) => r.rule);

describe("isValidEmail", () => {
  it.each(["a@b.co", "first.last+tag@example.com", "  user@domain.io  "])("accepts %s", (v) => {
    expect(isValidEmail(v)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "plain",
    "a@b",
    "a@b.c",
    "a b@c.com",
    "@example.com",
    "Not available",
    "N/A",
    "na",
    "none",
    "unknown",
    "---",
    null,
    undefined,
    42,
  ])("rejects %s", (v) => {
    expect(isValidEmail(v)).toBe(false);
  });
});

describe("isValidPhone", () => {
  it.each(["+91 98450 12345", "1234567", "(080) 2345-6789"])("accepts %s", (v) => {
    expect(isValidPhone(v)).toBe(true);
  });

  it.each(["123456", "abc", "", "N/A", "Not available", null, undefined, 9845012345])("rejects %s", (v) => {
    expect(isValidPhone(v)).toBe(false);
  });
});

describe("bandFor", () => {
  it("uses default thresholds with inclusive boundaries", () => {
    expect(bandFor(100)).toBe("Hot");
    expect(bandFor(80)).toBe("Hot");
    expect(bandFor(79)).toBe("Warm");
    expect(bandFor(50)).toBe("Warm");
    expect(bandFor(49)).toBe("Cold");
    expect(bandFor(0)).toBe("Cold");
  });

  it("honours custom thresholds", () => {
    const t = { hot: 60, warm: 30 };
    expect(bandFor(60, t)).toBe("Hot");
    expect(bandFor(59, t)).toBe("Warm");
    expect(bandFor(30, t)).toBe("Warm");
    expect(bandFor(29, t)).toBe("Cold");
  });
});

describe("scoreLead", () => {
  it("scores an empty lead as 0 / Cold with no reasons", () => {
    expect(scoreLead({}, DEFAULT_THRESHOLDS, NOW)).toEqual({ score: 0, band: "Cold", reasons: [] });
  });

  it("awards points per rule and sums them", () => {
    const result = scoreLead(
      {
        email: "lead@example.com",
        phone: "+91 98450 12345",
        company: "Acme",
        title: "Engineer",
        location: "Bengaluru",
        industry: "Software",
        source: "Manual",
      },
      DEFAULT_THRESHOLDS,
      NOW
    );
    expect(result.reasons).toEqual([
      { rule: "Has a valid email", points: 20 },
      { rule: "Has a phone number", points: 15 },
      { rule: "Company known", points: 10 },
      { rule: "Job title known", points: 5 },
      { rule: "Location known", points: 5 },
      { rule: "Interest or industry known", points: 5 },
      { rule: "Source recorded", points: 5 },
    ]);
    expect(result.score).toBe(65);
    expect(result.band).toBe("Warm");
  });

  it("caps the score at 100 for a perfect lead", () => {
    const result = scoreLead(
      {
        email: "ceo@acme.com",
        phone: "9845012345",
        company: "Acme",
        title: "CEO",
        location: "Pune",
        course_interest: "NEET",
        source_platform: "meta",
        consent_at: "2026-06-01T00:00:00Z",
        last_contacted_at: "2026-06-10T00:00:00Z",
        exam_year: 2026,
      },
      DEFAULT_THRESHOLDS,
      NOW
    );
    expect(result.reasons.reduce((s, r) => s + r.points, 0)).toBe(110);
    expect(result.score).toBe(100);
    expect(result.band).toBe("Hot");
  });

  it("never goes below 0", () => {
    const result = scoreLead({ do_not_contact: true, needs_guardian_consent: true }, DEFAULT_THRESHOLDS, NOW);
    expect(result.score).toBe(0);
    expect(result.reasons.map((r) => r.points)).toEqual([-10, -40]);
  });

  it("applies penalties to an otherwise good lead", () => {
    const base = { email: "a@b.com", phone: "9845012345", company: "Acme", title: "Founder", source: "Referral" };
    expect(scoreLead(base, DEFAULT_THRESHOLDS, NOW).score).toBe(75);
    expect(scoreLead({ ...base, needs_guardian_consent: true }, DEFAULT_THRESHOLDS, NOW).score).toBe(65);
    expect(scoreLead({ ...base, do_not_contact: true }, DEFAULT_THRESHOLDS, NOW).score).toBe(35);
  });

  it("ignores placeholder values", () => {
    expect(rules({ email: "Not available", phone: "N/A", company: "none", title: "-", location: "unknown" })).toEqual([]);
  });

  it("detects decision-maker titles", () => {
    for (const title of ["Co-founder", "cofounder", "VP Sales", "Head of Growth", "Director", "Chief of Staff", "Owner"]) {
      expect(rules({ title })).toContain("Decision-maker title");
    }
    for (const title of ["Engineer", "Student", "Headmaster"]) {
      expect(rules({ title })).not.toContain("Decision-maker title");
    }
  });

  it("counts either industry or course interest once", () => {
    expect(rules({ industry: "Edtech", course_interest: "JEE" }).filter((r) => r === "Interest or industry known")).toHaveLength(1);
    expect(rules({ course_interest: "JEE" })).toContain("Interest or industry known");
  });

  describe("source", () => {
    it("ad lead forms win over the source text", () => {
      expect(rules({ source_platform: "google", source: "Manual" })).toEqual(["Submitted an ad lead form"]);
      expect(rules({ source_platform: "meta" })).toEqual(["Submitted an ad lead form"]);
    });

    it.each(["Referral", "Website", "Inbound call", "Landing page", "Webinar", "Event", "Google Ads", "Facebook ad", "Contact form"])(
      "treats %s as high intent",
      (source) => {
        expect(rules({ source })).toEqual(["High-intent source"]);
      }
    );

    it.each(["Manual", "CSV import", "Purchased leads list", "Bulk uploads", "Partner platform", "Cold call"])(
      "treats %s as a plain recorded source",
      (source) => {
        expect(rules({ source })).toEqual(["Source recorded"]);
      }
    );

    it("ignores unknown platforms and empty sources", () => {
      expect(rules({ source_platform: "linkedin" })).toEqual([]);
      expect(rules({ source: "  " })).toEqual([]);
    });
  });

  describe("consent", () => {
    it("accepts a consent timestamp or a non-empty channel list", () => {
      expect(rules({ consent_at: "2026-01-01T00:00:00Z" })).toEqual(["Consent to contact"]);
      expect(rules({ consent_channel: ["email"] })).toEqual(["Consent to contact"]);
    });

    it("ignores empty consent", () => {
      expect(rules({ consent_at: "", consent_channel: [] })).toEqual([]);
      expect(rules({ consent_at: null, consent_channel: null })).toEqual([]);
    });
  });

  describe("recent contact", () => {
    it("counts contacts within the last 14 days, inclusive", () => {
      expect(rules({ last_contacted_at: NOW.toISOString() })).toEqual(["Contacted in the last 14 days"]);
      expect(rules({ last_contacted_at: "2026-06-01T12:00:00Z" })).toEqual(["Contacted in the last 14 days"]);
    });

    it("ignores older, future and invalid dates", () => {
      expect(rules({ last_contacted_at: "2026-06-01T11:59:59Z" })).toEqual([]);
      expect(rules({ last_contacted_at: "2026-06-16T00:00:00Z" })).toEqual([]);
      expect(rules({ last_contacted_at: "not a date" })).toEqual([]);
    });
  });

  describe("exam year", () => {
    it("counts this year and next year", () => {
      expect(rules({ exam_year: 2026 })).toEqual(["Exam within a year"]);
      expect(rules({ exam_year: " 2027 " })).toEqual(["Exam within a year"]);
    });

    it("ignores past, far-future, blank and non-numeric years", () => {
      for (const exam_year of [2025, 2028, "", "  ", "next year", null]) {
        expect(rules({ exam_year })).toEqual([]);
      }
    });
  });

  it("uses custom thresholds for the band", () => {
    const result = scoreLead({ email: "a@b.com", phone: "9845012345" }, { hot: 30, warm: 10 }, NOW);
    expect(result.score).toBe(35);
    expect(result.band).toBe("Hot");
  });
});

describe("statusAfterScoring", () => {
  it("replaces band statuses with the new band", () => {
    for (const status of BAND_STATUSES) expect(statusAfterScoring(status, "Hot")).toBe("Hot");
  });

  it("treats a missing status as New", () => {
    expect(statusAfterScoring(null, "Warm")).toBe("Warm");
    expect(statusAfterScoring(undefined, "Cold")).toBe("Cold");
    expect(statusAfterScoring("", "Cold")).toBe("Cold");
  });

  it("never overwrites pipeline statuses", () => {
    for (const status of ["Contacted", "Qualified", "Closed"]) expect(statusAfterScoring(status, "Hot")).toBe(status);
  });
});

describe("SCORING_FIELDS", () => {
  it("lists every field the scorer reads, once", () => {
    expect(new Set(SCORING_FIELDS).size).toBe(SCORING_FIELDS.length);
    expect(SCORING_FIELDS).toEqual(
      expect.arrayContaining(["email", "phone", "source", "source_platform", "exam_year", "do_not_contact", "last_contacted_at"])
    );
  });
});
