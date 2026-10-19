import { describe, expect, it } from "vitest";
import { prepareSignalImport } from "../../services/signals";
import {
  canonicalCity,
  canonicalCourse,
  cityAliases,
  coursePatterns,
  courseTags,
  emptyFilters,
  hasStructuredFilter,
  mergeFilters,
  normalizeFilters,
  parseQueryKeywords,
  sanitizeFilterValue,
  type LeadSearchFilters,
} from "../../services/search/queryParser";
import {
  aliasRegex,
  buildVocabulary,
  DEFAULT_DISCOVERY_SETTINGS,
  EDUCATION_VOCABULARY as edu,
  mentionsTerm,
  normalizeDiscoverySettings,
} from "../../services/search/vocabulary";

const filters = (overrides: Partial<LeadSearchFilters> = {}): LeadSearchFilters => ({ ...emptyFilters(), ...overrides });

describe("parseQueryKeywords (ported from queryParser.check.ts)", () => {
  it.each<[string, Partial<LeadSearchFilters>]>([
    ["NEET students in Bengaluru", { course_interest: "NEET", city: "Bengaluru", exam_year: null }],
    ["Java Bangalore", { course_interest: "Java", city: "Bengaluru" }],
    ["Python training in Mysuru 2027", { course_interest: "Python", city: "Mysuru", exam_year: "2027" }],
    ["Full stack developers Hyderabad", { course_interest: "Full Stack", city: "Hyderabad" }],
  ])("%s (education vocabulary)", (query, expected) => {
    expect(parseQueryKeywords(query, edu)).toMatchObject(expected);
  });

  it("returns the Bengaluru aliases for Bangalore", () => {
    expect(cityAliases("Bangalore")).toEqual(["bengaluru", "bangalore", "blr", "bengalooru"]);
  });
});

describe("parseQueryKeywords", () => {
  it("returns empty filters for empty input", () => {
    expect(parseQueryKeywords("")).toEqual(emptyFilters());
    expect(parseQueryKeywords(undefined as unknown as string)).toEqual(emptyFilters());
  });

  it("extracts every structured filter and leaves stopwords out of keywords", () => {
    expect(parseQueryKeywords("Show me hot NEET aspirants from Instagram in Bangalore 2026 with score above 70", edu)).toEqual({
      course_interest: "NEET",
      city: "Bengaluru",
      exam_year: "2026",
      source_platform: "meta",
      status: "Hot",
      min_score: 70,
      keywords: [],
    });
  });

  it.each<[string, Partial<LeadSearchFilters>]>([
    ["neet-ug aspirants", { course_interest: "NEET" }],
    ["IIT JEE Mains coaching", { course_interest: "JEE" }],
    ["MERN developers", { course_interest: "Full Stack" }],
    ["selenium testers", { course_interest: "Software Testing" }],
    ["data scientists in Pune", { course_interest: "Data Science", city: "Pune" }],
    ["data analyst Gurgaon", { course_interest: "Data Analytics", city: "Gurugram" }],
    ["SAP FICO Chennai", { course_interest: "SAP", city: "Chennai" }],
    ["digital marketing Navi Mumbai", { course_interest: "Digital Marketing", city: "Mumbai" }],
    ["IAS coaching Delhi", { course_interest: "UPSC", city: "Delhi" }],
    ["google ads leads", { source_platform: "google" }],
    ["fb leads", { source_platform: "meta" }],
    ["warm leads", { status: "Warm" }],
    ["score >= 85", { min_score: 85 }],
    ["score at least 40", { min_score: 40 }],
    ["score 250", { min_score: 100 }],
  ])("%s", (query, expected) => {
    expect(parseQueryKeywords(query, edu)).toMatchObject(expected);
  });

  it("does not mistake JavaScript for Java", () => {
    const result = parseQueryKeywords("javascript developers", edu);
    expect(result.course_interest).toBeNull();
    expect(result.keywords).toEqual(["javascript"]);
  });

  it("picks the earliest course and city in the query", () => {
    expect(parseQueryKeywords("python or java in Mysore and Bangalore", edu)).toMatchObject({
      course_interest: "Python",
      city: "Mysuru",
    });
  });

  it("has no education interests by default: course words stay keywords", () => {
    expect(parseQueryKeywords("NEET aspirants in Bangalore")).toMatchObject({
      course_interest: null,
      city: "Bengaluru",
      keywords: ["neet"],
    });
  });

  it("recognises workspace interests and cities, including non-Latin aliases", () => {
    const vocab = buildVocabulary(
      normalizeDiscoverySettings({
        country: "us",
        interests: [{ label: "Dental Implants", aliases: ["implant dentistry", "दंत प्रत्यारोपण"] }],
        cities: [{ label: "Austin", aliases: ["atx"] }, { label: "मुंबई", aliases: ["mumbai"] }],
      })
    );
    expect(parseQueryKeywords("implant dentistry clinics in ATX", vocab)).toMatchObject({
      course_interest: "Dental Implants",
      city: "Austin",
    });
    expect(parseQueryKeywords("दंत प्रत्यारोपण मुंबई", vocab)).toMatchObject({ course_interest: "Dental Implants", city: "मुंबई" });
    // "us" has no built-in city list, so an Indian city is not recognised.
    expect(parseQueryKeywords("dentists in Bangalore", vocab).city).toBeNull();
  });

  it("keeps remaining words as unique lowercase keywords", () => {
    expect(parseQueryKeywords("React React native c++ c# node.js 12345 ab").keywords).toEqual(["react", "native", "c++", "node.js"]);
  });

  it("caps keywords at 10", () => {
    const words = Array.from({ length: 15 }, (_, i) => `word${String.fromCharCode(97 + i)}`).join(" ");
    expect(parseQueryKeywords(words).keywords).toHaveLength(10);
  });

  it("removes the matched word itself, not an earlier substring", () => {
    expect(parseQueryKeywords("Kotak employees in Kota")).toMatchObject({ city: "Kota", keywords: ["kotak", "employees"] });
    expect(parseQueryKeywords("asap SAP training", edu)).toMatchObject({ course_interest: "SAP", keywords: ["asap"] });
  });
});

describe("vocabulary matching", () => {
  it("matches whole words in any script", () => {
    expect(mentionsTerm("कोचिंग बेंगलुरु में", "बेंगलुरु")).toBe(true);
    expect(mentionsTerm("बेंगलुरुवाला", "बेंगलुरु")).toBe(false);
    expect(mentionsTerm("Need a tutor in Bangalore!", "bangalore")).toBe(true);
    expect(mentionsTerm("Bangalorean food", "bangalore")).toBe(false);
    expect(mentionsTerm("anything", "")).toBe(false);
    expect(aliasRegex([]).test("anything")).toBe(false);
  });

  it("normalises stored settings and falls back to defaults", () => {
    expect(normalizeDiscoverySettings(null)).toEqual(DEFAULT_DISCOVERY_SETTINGS);
    expect(
      normalizeDiscoverySettings({
        country: "US",
        language: "en-US",
        interestPreset: "unknown",
        businessDescription: "  dental   clinics ",
        interests: [{ label: "Implants" }, { label: "implants" }, { aliases: ["x"] }, "junk"],
      })
    ).toEqual({
      businessDescription: "dental clinics",
      country: "us",
      language: "en-US",
      interestPreset: "none",
      interests: [{ label: "Implants", aliases: [] }],
      cities: [],
    });
  });
});

describe("normalizeFilters", () => {
  it("coerces untrusted model output", () => {
    expect(
      normalizeFilters(
        {
          course: "neet ug",
          location: "bangalore",
          exam_year: "NEET 2027 batch",
          source_platform: "Facebook Lead Ads",
          status: "hot",
          min_score: "72.6",
          keywords: ["Biology", "the", "biology", "a", 42, "x,y(z)", "Physics"],
        },
        edu
      )
    ).toEqual({
      course_interest: "NEET",
      city: "Bengaluru",
      exam_year: "2027",
      source_platform: "meta",
      status: "Hot",
      min_score: 73,
      keywords: ["biology", "x y z", "physics"],
    });
  });

  it("returns empty filters for non-objects", () => {
    expect(normalizeFilters(null)).toEqual(emptyFilters());
    expect(normalizeFilters("NEET")).toEqual(emptyFilters());
    expect(normalizeFilters({ keywords: "not an array" })).toEqual(emptyFilters());
  });

  it("keeps unknown courses and cities trimmed and capitalises unknown statuses", () => {
    expect(normalizeFilters({ course_interest: " Blockchain ", city: " Shivamogga ", status: "FOLLOW-UP" })).toMatchObject({
      course_interest: "Blockchain",
      city: "Shivamogga",
      status: "Follow-up",
    });
  });

  it("matches known statuses case-insensitively", () => {
    expect(normalizeFilters({ status: "qualified" }).status).toBe("Qualified");
  });

  it("handles platform, year and score edge cases", () => {
    expect(normalizeFilters({ source_platform: "google" }).source_platform).toBe("google");
    expect(normalizeFilters({ source_platform: "linkedin" }).source_platform).toBeNull();
    expect(normalizeFilters({ exam_year: 2026 }).exam_year).toBe("2026");
    expect(normalizeFilters({ exam_year: "1999" }).exam_year).toBeNull();
    expect(normalizeFilters({ min_score: -5 }).min_score).toBe(0);
    expect(normalizeFilters({ min_score: 500 }).min_score).toBe(100);
    expect(normalizeFilters({ min_score: "" }).min_score).toBeNull();
    expect(normalizeFilters({ min_score: "high" }).min_score).toBeNull();
    expect(normalizeFilters({ min_score: 0 }).min_score).toBe(0);
  });

  it("caps keywords at 10", () => {
    const keywords = Array.from({ length: 20 }, (_, i) => `kw${i}`);
    expect(normalizeFilters({ keywords }).keywords).toHaveLength(10);
  });
});

describe("sanitizeFilterValue", () => {
  it("strips PostgREST syntax and wildcards and collapses spaces", () => {
    expect(sanitizeFilterValue(' a,b (c) "d" \\e %f* g:h {i} ')).toBe("a b c d e f g h i");
    expect(sanitizeFilterValue("%%%")).toBe("");
  });
});

describe("canonicalCourse / canonicalCity", () => {
  it("maps known spellings to labels", () => {
    expect(canonicalCourse("NEET PG", edu)).toBe("NEET");
    expect(canonicalCourse("full-stack", edu)).toBe("Full Stack");
    expect(canonicalCourse("NEET PG")).toBe("NEET PG");
    expect(canonicalCity("Bombay")).toBe("Mumbai");
    expect(canonicalCity("new delhi")).toBe("Delhi");
  });

  it("returns null for empty or non-string input", () => {
    expect(canonicalCourse("")).toBeNull();
    expect(canonicalCourse("%%")).toBeNull();
    expect(canonicalCourse(42)).toBeNull();
    expect(canonicalCity(null)).toBeNull();
    expect(canonicalCity("  ")).toBeNull();
  });
});

describe("cityAliases / coursePatterns / courseTags", () => {
  it("returns aliases by label or alias, or the cleaned city", () => {
    expect(cityAliases("Mysuru")).toEqual(["mysuru", "mysore"]);
    expect(cityAliases("trichy")).toEqual(["tiruchirappalli", "trichy"]);
    expect(cityAliases("Shivamogga")).toEqual(["shivamogga"]);
    expect(cityAliases("%")).toEqual([]);
  });

  it("returns course ilike fragments", () => {
    expect(coursePatterns("Full Stack", edu)).toEqual(["full%stack", "fullstack", "mern"]);
    expect(coursePatterns("Full Stack")).toEqual(["full stack"]);
    expect(coursePatterns("neet", edu)).toEqual(["neet"]);
    expect(coursePatterns("Blockchain")).toEqual(["blockchain"]);
    expect(coursePatterns("")).toEqual([]);
  });

  it("returns unique tag spellings", () => {
    expect(courseTags("Neet")).toEqual(["Neet", "neet", "NEET"]);
    expect(courseTags("NEET")).toEqual(["NEET", "neet"]);
    expect(courseTags(" ")).toEqual([]);
  });
});

describe("mergeFilters / hasStructuredFilter", () => {
  it("fills gaps from the fallback and merges keywords", () => {
    const primary = filters({ course_interest: "NEET", keywords: ["biology", "physics"] });
    const fallback = filters({ course_interest: "JEE", city: "Pune", min_score: 0, keywords: ["physics", "chemistry"] });
    expect(mergeFilters(primary, fallback)).toEqual({
      course_interest: "NEET",
      city: "Pune",
      exam_year: null,
      source_platform: null,
      status: null,
      min_score: 0,
      keywords: ["biology", "physics", "chemistry"],
    });
  });

  it("caps merged keywords at 10", () => {
    const a = filters({ keywords: Array.from({ length: 8 }, (_, i) => `a${i}`) });
    const b = filters({ keywords: Array.from({ length: 8 }, (_, i) => `b${i}`) });
    expect(mergeFilters(a, b).keywords).toHaveLength(10);
  });

  it("detects structured filters, counting a zero minimum score", () => {
    expect(hasStructuredFilter(emptyFilters())).toBe(false);
    expect(hasStructuredFilter(filters({ keywords: ["x"] }))).toBe(false);
    expect(hasStructuredFilter(filters({ min_score: 0 }))).toBe(true);
    expect(hasStructuredFilter(filters({ city: "Pune" }))).toBe(true);
    expect(hasStructuredFilter(filters({ source_platform: "meta" }))).toBe(true);
  });
});

describe("prepareSignalImport (ported from queryParser.check.ts)", () => {
  it("keeps valid signals, drops items without a URL and scrubs contact details", () => {
    const imported = prepareSignalImport({
      signals: [
        {
          post_url: "https://www.quora.com/q/java-bangalore",
          post_excerpt: "Need Java trainer, call 9845012345 or mail me at a.b@example.com",
          suggested_public_reply: "DM us or WhatsApp +91 98450 12345",
          name: "Should be dropped",
          phone: "9845012345",
        },
        { post_excerpt: "no url" },
      ],
    });
    expect(imported.rows).toHaveLength(1);
    expect(imported.skipped).toBe(1);
    expect(JSON.stringify(imported.rows)).not.toMatch(/\d{10}|@/);
    expect(imported.rows[0]).not.toHaveProperty("name");
    expect(imported.rows[0]).not.toHaveProperty("phone");
  });
});
