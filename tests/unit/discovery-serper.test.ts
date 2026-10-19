import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_WORDS,
  buildQueries,
  cityExpression,
  composeQuery,
  placesQuery,
  queryWordCount,
  serperLocale,
  topicWords,
} from "../../services/discovery/serper";
import { buildVocabulary, normalizeDiscoverySettings } from "../../services/search/vocabulary";

const allQueries = (query: string, city: string, country?: string) => buildQueries(query, city, { country }).map((q) => q.q);

describe("topicWords", () => {
  it("uses the query as plain words: no quotes or search operators", () => {
    expect(topicWords('"NEET coaching" -site:justdial.com OR (Bangalore)')).toBe("NEET coaching site justdial.com Bangalore");
    expect(topicWords("  ")).toBe("");
  });

  it("caps long queries at 8 words", () => {
    expect(topicWords("one two three four five six seven eight nine ten").split(" ")).toHaveLength(8);
  });
});

describe("buildQueries", () => {
  it("never wraps the whole query in quotes", () => {
    for (const q of allQueries("NEET coaching", "Bengaluru")) {
      expect(q).not.toContain('"NEET coaching"');
      expect(q).toContain("NEET coaching");
    }
  });

  it("keeps every query within Google's 32-word limit, even for long queries and many city aliases", () => {
    const queries = allQueries("best affordable weekend digital marketing course for working professionals near me", "Bengaluru");
    expect(queries.length).toBeGreaterThan(5);
    for (const q of queries) expect(queryWordCount(q)).toBeLessThanOrEqual(MAX_QUERY_WORDS);
  });

  it("cuts intent phrases before the city and listing-site exclusions", () => {
    const contact = buildQueries("best affordable weekend digital marketing course for working professionals", "Bengaluru").find(
      (q) => q.platform === "contact"
    )!.q;
    expect(contact).toContain("(Bengaluru OR Bangalore OR Blr)");
    expect(contact).toContain("-site:justdial.com");
    expect(contact).toContain('"call me"');
    expect(contact).not.toContain("whatsapp me");
    expect(queryWordCount(contact)).toBeLessThanOrEqual(MAX_QUERY_WORDS);
  });

  it("uses country-specific listing sites and subreddits", () => {
    const india = allQueries("dentists", "Bengaluru", "in");
    expect(india.some((q) => q.includes("-site:justdial.com"))).toBe(true);
    expect(india.some((q) => q.includes("site:reddit.com/r/bangalore OR site:reddit.com/r/india"))).toBe(true);

    const us = allQueries("dentists", "Austin", "us");
    expect(us.some((q) => q.includes("justdial"))).toBe(false);
    expect(us.some((q) => q.includes("-site:yelp.com"))).toBe(true);
    expect(us.some((q) => q.includes("r/india"))).toBe(false);
  });

  it("builds location-free queries when there is no location", () => {
    const queries = buildQueries("dentists", "", { country: "us" });
    expect(queries.length).toBeGreaterThan(0);
    for (const { q } of queries) {
      expect(q).not.toMatch(/\bin\s*$/);
      expect(q).not.toContain("()");
    }
    // No city and no national subreddit for "us": the subreddit query is skipped.
    expect(queries.filter((q) => q.platform === "reddit")).toHaveLength(1);
  });

  it("returns nothing for an empty topic", () => {
    expect(buildQueries("  ", "Bengaluru")).toEqual([]);
  });

  it("uses workspace city aliases", () => {
    const vocab = buildVocabulary(normalizeDiscoverySettings({ country: "us", cities: [{ label: "Austin", aliases: ["ATX"] }] }));
    expect(cityExpression("atx", vocab)).toBe("(Austin OR Atx)");
    expect(cityExpression("", vocab)).toBe("");
    expect(cityExpression("New Braunfels", vocab)).toBe('"New Braunfels"');
  });
});

describe("composeQuery", () => {
  it("drops terms from the last shrinkable part first and keeps each part's minimum", () => {
    const q = composeQuery(
      [
        { terms: ["topic"], min: 1, join: "and" },
        { terms: ["a", "b", "c"], min: 1, join: "or" },
        { terms: ["-site:x.com", "-site:y.com"], min: 0, join: "and" },
      ],
      5
    );
    expect(q).toBe("topic (a OR b)");
    expect(queryWordCount(q)).toBe(4);
    expect(composeQuery([{ terms: ["one two three"], min: 1, join: "and" }], 1)).toBe("one two three");
  });
});

describe("placesQuery", () => {
  it("adds the city only when there is one", () => {
    expect(placesQuery("dentists", "Austin")).toBe("dentists in Austin");
    expect(placesQuery("dentists", "")).toBe("dentists");
    expect(placesQuery("dentists", "  ")).toBe("dentists");
  });
});

describe("serperLocale", () => {
  it("uses the configured country and language, defaulting to India / English", () => {
    expect(serperLocale({})).toEqual({ gl: "in", hl: "en" });
    expect(serperLocale({ country: "US", language: "es" })).toEqual({ gl: "us", hl: "es" });
    expect(serperLocale({ country: "usa", language: "<script>" })).toEqual({ gl: "in", hl: "en" });
  });
});
