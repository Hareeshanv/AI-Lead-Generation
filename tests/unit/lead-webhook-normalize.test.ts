import { describe, expect, it } from "vitest";
import { normalizeLead, normalizePhone, type RawAdLead } from "../../supabase/functions/lead-webhook/normalize";

function raw(overrides: Partial<RawAdLead> = {}): RawAdLead {
  return {
    platform: "meta",
    externalLeadId: "lead-123",
    formId: "form-1",
    campaignName: "Spring intake",
    adName: "Ad A",
    submittedAt: "2026-03-01T10:15:00+0000",
    answers: [],
    isTest: false,
    academyId: "academy-1",
    academyName: "Acme Academy",
    ...overrides,
  };
}

describe("normalizePhone", () => {
  it("adds the +91 prefix to Indian mobile numbers in common formats", () => {
    expect(normalizePhone("98450 12345")).toBe("+919845012345");
    expect(normalizePhone("098450-12345")).toBe("+919845012345");
    expect(normalizePhone("91 98450 12345")).toBe("+919845012345");
    expect(normalizePhone("+91-98450-12345")).toBe("+919845012345");
    expect(normalizePhone("0919845012345")).toBe("+919845012345");
  });

  it("keeps other numbers as digits (with + when given)", () => {
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizePhone("020 1234 5678")).toBe("02012345678");
  });

  it("returns null for empty input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("n/a")).toBeNull();
  });
});

describe("normalizeLead", () => {
  it("maps standard form answers to a lead row", () => {
    const row = normalizeLead(
      raw({
        answers: [
          { key: "full_name", value: " Asha Rao " },
          { key: "email", value: "Asha@Example.COM " },
          { key: "phone_number", value: "98450 12345" },
          { key: "city", value: "Pune" },
          { key: "Which course are you interested in?", value: "NEET" },
          { key: "exam_year", value: "2027" },
        ],
      })
    );
    expect(row).toMatchObject({
      name: "Asha Rao",
      company: "Acme Academy",
      email: "asha@example.com",
      phone: "+919845012345",
      location: "Pune",
      course_interest: "NEET",
      exam_year: "2027",
      status: "New",
      score: 0,
      scored_at: null,
      source: "Meta Lead Ads",
      source_platform: "meta",
      external_lead_id: "lead-123",
      tags: ["meta"],
      consent_at: "2026-03-01T10:15:00.000Z",
    });
    expect(row.raw_answers).toEqual({
      answers: {
        full_name: "Asha Rao",
        email: "Asha@Example.COM",
        phone_number: "98450 12345",
        city: "Pune",
        "Which course are you interested in?": "NEET",
        exam_year: "2027",
      },
    });
  });

  it("joins first and last names and falls back to Unknown", () => {
    expect(normalizeLead(raw({ answers: [{ key: "first_name", value: "Asha" }, { key: "last_name", value: "Rao" }] })).name).toBe("Asha Rao");
    expect(normalizeLead(raw()).name).toBe("Unknown");
  });

  it("drops invalid emails and ignores blank answers", () => {
    const row = normalizeLead(raw({ answers: [{ key: "email", value: "not-an-email" }, { key: "city", value: "   " }] }));
    expect(row.email).toBeNull();
    expect(row.location).toBeNull();
    expect(row.raw_answers).toEqual({ answers: { email: "not-an-email" } });
  });

  it("flags guardians and minors who need guardian consent", () => {
    const parent = normalizeLead(raw({ answers: [{ key: "I am a", value: "Parent / Guardian" }] }));
    expect(parent).toMatchObject({ is_guardian: true, needs_guardian_consent: false });

    const minor = normalizeLead(raw({ answers: [{ key: "Who are you?", value: "Student (under 18)" }] }));
    expect(minor).toMatchObject({ is_guardian: false, needs_guardian_consent: true });

    const adult = normalizeLead(raw({ answers: [{ key: "Who are you?", value: "Student 18+" }] }));
    expect(adult).toMatchObject({ is_guardian: false, needs_guardian_consent: false });
  });

  it("reads an exam answer as a year or as the course", () => {
    expect(normalizeLead(raw({ answers: [{ key: "target exam", value: "JEE Main 2027" }] })).exam_year).toBe("JEE Main 2027");
    expect(normalizeLead(raw({ answers: [{ key: "target exam", value: "JEE Main" }] })).course_interest).toBe("JEE Main");
  });

  it("labels Google leads, tags test submissions and keeps extra metadata", () => {
    const row = normalizeLead(raw({ platform: "google", isTest: true, academyName: null, extra: { gcl_id: "abc" } }));
    expect(row.source).toBe("Google Ads Lead Form");
    expect(row.tags).toEqual(["google", "test"]);
    expect(row.company).toBe("");
    expect(row.raw_answers).toEqual({ answers: {}, gcl_id: "abc" });
  });

  it("uses the current time when the submission time is unparseable", () => {
    const before = Date.now();
    const consentAt = Date.parse(normalizeLead(raw({ submittedAt: "yesterday" })).consent_at);
    expect(consentAt).toBeGreaterThanOrEqual(before);
    expect(consentAt).toBeLessThanOrEqual(Date.now());
  });
});
