import { describe, expect, it } from "vitest";
import type { IntentSignalRow } from "../../services/signals";
import type { SerperPlace } from "../../services/discovery/serper";
import {
  AGENT_LEAD_SOURCE,
  DEFAULT_MAX_RESULTS,
  MAX_RESULTS_LIMIT,
  PLACES_CHANNEL,
  agentRunTag,
  buildExistingKeySet,
  buildPlaceLeadRow,
  buildSignalRows,
  byPriority,
  clampMaxResults,
  cleanHandle,
  cleanReply,
  cleanScore,
  cleanText,
  computeRunStats,
  dedupeLeadCandidates,
  domainKey,
  indexLeadsBySignalKeys,
  interleave,
  leadDedupeKeys,
  leadStatusForScore,
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
  parsePlaceScores,
  placeFitScore,
  requestedContact,
  scoreBand,
  selectRows,
  signalLeadKeys,
  signalToLeadRow,
  uniquePlaces,
  type Candidate,
  type RunTotals,
} from "../../services/discovery/postprocess";

const NOW = "2026-03-02T10:00:00.000Z";
const THRESHOLDS = { hot: 80, warm: 50 };

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  title: "Title",
  link: "https://example.com/post",
  snippet: "Snippet",
  date: null,
  platform: "web",
  ...overrides,
});

const place = (overrides: Partial<SerperPlace> = {}): SerperPlace => ({
  title: "Acme Academy",
  address: null,
  category: null,
  phoneNumber: null,
  website: null,
  rating: null,
  ratingCount: null,
  cid: null,
  latitude: null,
  longitude: null,
  ...overrides,
});

const signalRow = (overrides: Partial<IntentSignalRow> = {}): IntentSignalRow => ({
  post_url: "https://example.com/p",
  source_channel: null,
  post_excerpt: null,
  post_date: null,
  city: null,
  course_interest: null,
  urgency: null,
  budget: null,
  intent_score: 50,
  lead_routing_category: null,
  suggested_public_reply: null,
  updated_at: NOW,
  ...overrides,
});

describe("normalizeUrl", () => {
  it("drops the fragment and a trailing slash", () => {
    expect(normalizeUrl("https://example.com/a/#comments")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
  });

  it("returns invalid URLs unchanged", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("clampMaxResults", () => {
  it.each([undefined, null, "", "abc", Number.NaN, Number.POSITIVE_INFINITY])("defaults %j", (v) => {
    expect(clampMaxResults(v)).toBe(DEFAULT_MAX_RESULTS);
  });

  it("clamps and rounds", () => {
    expect(clampMaxResults(0)).toBe(1);
    expect(clampMaxResults(-5)).toBe(1);
    expect(clampMaxResults(50)).toBe(50);
    expect(clampMaxResults("12.6")).toBe(13);
    expect(clampMaxResults(1000)).toBe(MAX_RESULTS_LIMIT);
  });
});

describe("cleanText", () => {
  it("trims, redacts contacts and truncates", () => {
    expect(cleanText("  hello  ", 100)).toBe("hello");
    expect(cleanText("call 98450 12345 or a.b@example.com", 100)).toBe("call [contact removed] or [contact removed]");
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText(123, 10)).toBe("123");
  });

  it("returns null for empty values", () => {
    expect(cleanText(null, 10)).toBeNull();
    expect(cleanText(undefined, 10)).toBeNull();
    expect(cleanText("   ", 10)).toBeNull();
  });
});

describe("cleanHandle", () => {
  const c = candidate({ title: "Need help", snippet: "Posted by u/asha_r in r/neet", link: "https://reddit.com/r/neet/1" });

  it("keeps handles visible in the result", () => {
    expect(cleanHandle("u/asha_r", c)).toBe("u/asha_r");
    expect(cleanHandle("@Asha_R", c)).toBe("@Asha_R");
    expect(cleanHandle("neet", c)).toBe("neet");
  });

  it("drops invented, short, contact-like or non-string handles", () => {
    expect(cleanHandle("ravi_k", c)).toBeNull();
    expect(cleanHandle("u/a", c)).toBeNull();
    expect(cleanHandle("  ", c)).toBeNull();
    expect(cleanHandle("asha@example.com", candidate({ snippet: "asha@example.com" }))).toBeNull();
    expect(cleanHandle("9845012345", candidate({ snippet: "9845012345" }))).toBeNull();
    expect(cleanHandle(42, c)).toBeNull();
    expect(cleanHandle(null, c)).toBeNull();
  });
});

describe("cleanScore", () => {
  it("rounds and clamps to 0-100", () => {
    expect(cleanScore("85.4")).toBe(85);
    expect(cleanScore(150)).toBe(100);
    expect(cleanScore(-3)).toBe(0);
    expect(cleanScore("x")).toBe(0);
    expect(cleanScore(undefined)).toBe(0);
  });
});

describe("cleanReply", () => {
  it("keeps brand-free, link-free replies", () => {
    expect(cleanReply("  Good luck with your prep! Try mock tests weekly.  ")).toBe("Good luck with your prep! Try mock tests weekly.");
  });

  it.each([
    "Visit https://acme.test for details",
    "See www.acme.test",
    "Check acme.com",
    "Share your phone number",
    "Send your e-mail",
    "Ping us on WhatsApp",
    "DM me for details",
    "Call us at 98450 12345",
    "",
    null,
  ])("drops %j", (reply) => {
    expect(cleanReply(reply)).toBeNull();
  });
});

describe("requestedContact", () => {
  it("prefers the snippet, then falls back to the title", () => {
    expect(requestedContact(candidate({ title: "x", snippet: "Please call me on 98450 12345" }))).toMatchObject({
      contact_requested: true,
      published_contact: "98450 12345",
    });
    expect(requestedContact(candidate({ title: "Contact me at a.b@example.com", snippet: "nothing here" }))).toMatchObject({
      contact_requested: true,
      published_contact: "a.b@example.com",
    });
  });

  it("requires an explicit request next to the contact", () => {
    expect(requestedContact(candidate({ snippet: "My number is 98450 12345" }))).toEqual({
      contact_requested: false,
      published_contact: null,
      contact_request_quote: null,
    });
  });
});

describe("scoreBand", () => {
  it("bands at 80 and 50", () => {
    expect(scoreBand(100)).toEqual({ urgency: "high", routing: "hot" });
    expect(scoreBand(80)).toEqual({ urgency: "high", routing: "hot" });
    expect(scoreBand(79)).toEqual({ urgency: "medium", routing: "warm" });
    expect(scoreBand(50)).toEqual({ urgency: "medium", routing: "warm" });
    expect(scoreBand(49)).toEqual({ urgency: "low", routing: "nurture" });
  });
});

describe("byPriority / selectRows", () => {
  it("orders contact requests first, then by score", () => {
    const rows = [{ intent_score: 90 }, { intent_score: 40, contact_requested: true }, { intent_score: 95 }, {}];
    expect(rows.sort(byPriority).map((r) => r.intent_score ?? null)).toEqual([40, 95, 90, null]);
  });

  it("caps each platform at 5 and fills remaining slots with the overflow", () => {
    const reddit = [90, 80, 70, 60, 50, 40, 30].map((s) => signalRow({ platform: "reddit", intent_score: s, post_url: `r${s}` }));
    const quora = [20, 10].map((s) => signalRow({ platform: "quora", intent_score: s, post_url: `q${s}` }));
    const all = [...quora, ...reddit];

    expect(selectRows(all, 7).map((r) => r.post_url)).toEqual(["r90", "r80", "r70", "r60", "r50", "q20", "q10"]);
    expect(selectRows(all, 8).map((r) => r.post_url)).toEqual(["r90", "r80", "r70", "r60", "r50", "r40", "q20", "q10"]);
    expect(selectRows(all, 3).map((r) => r.post_url)).toEqual(["r90", "r80", "r70"]);
    expect(selectRows([], 5)).toEqual([]);
  });

  it("groups rows without a platform under web", () => {
    const rows = Array.from({ length: 6 }, (_, i) => signalRow({ platform: null, intent_score: 60 - i, post_url: `w${i}` }));
    rows.push(signalRow({ platform: "reddit", intent_score: 1, post_url: "r" }));
    expect(selectRows(rows, 6).map((r) => r.post_url)).toEqual(["w0", "w1", "w2", "w3", "w4", "r"]);
  });

  it("does not mutate its input", () => {
    const rows = [signalRow({ intent_score: 1 }), signalRow({ intent_score: 2 })];
    selectRows(rows, 2);
    expect(rows.map((r) => r.intent_score)).toEqual([1, 2]);
  });
});

describe("interleave", () => {
  const a = [candidate({ link: "https://a.test/1" }), candidate({ link: "https://a.test/2" }), candidate({ link: "https://a.test/3" })];
  const b = [candidate({ link: "https://a.test/1#dup" })];
  const c = [candidate({ link: "https://c.test/1" }), candidate({ link: "https://c.test/2/" })];

  it("round-robins across lists and skips duplicate URLs", () => {
    expect(interleave([a, b, c], 10).map((x) => x.link)).toEqual([
      "https://a.test/1",
      "https://c.test/1",
      "https://a.test/2",
      "https://c.test/2/",
      "https://a.test/3",
    ]);
  });

  it("stops at the limit", () => {
    expect(interleave([a, c], 3).map((x) => x.link)).toEqual(["https://a.test/1", "https://c.test/1", "https://a.test/2"]);
    expect(interleave([a], 0)).toEqual([]);
  });

  it("handles no lists", () => {
    expect(interleave([], 5)).toEqual([]);
    expect(interleave([[], []], 5)).toEqual([]);
  });
});

describe("buildSignalRows", () => {
  const ctx = { query: "NEET coaching", city: "Bengaluru", cityAliases: ["bengaluru", "bangalore", "blr", "bengalooru"], now: NOW };
  const batch: Candidate[] = [
    candidate({
      title: "Looking for NEET coaching in Bangalore",
      link: "https://www.reddit.com/r/bangalore/comments/abc/neet/",
      snippet: "Any good NEET coaching near Jayanagar? Posted by u/asha_r",
      date: "2 days ago",
      platform: "reddit",
    }),
    candidate({
      title: "Java course",
      link: "https://www.quora.com/q/java",
      snippet: "Interested in Java training, please call me on 98450 12345",
      platform: "quora",
    }),
    candidate({ title: "My son in class 12 needs coaching", link: "https://forum.example.com/t/1", snippet: "Suggestions?", platform: "web" }),
    candidate({ title: "Low intent", link: "https://example.com/low", snippet: "meh", platform: "web" }),
    candidate({ title: "Seller", link: "https://example.com/seller", snippet: "We offer coaching", platform: "web" }),
  ];
  const items = [
    {
      index: 0,
      is_prospective_customer: true,
      intent_score: 65,
      author_handle: "u/asha_r",
      interest: "NEET",
      suggested_public_reply: "Check the reviews of coaching centres near you before joining.",
    },
    { index: 1, is_prospective_learner: "true", intent_score: 30, author_handle: "98450 12345", suggested_public_reply: "DM me" },
    { index: 2, is_prospective_customer: true, intent_score: "55", location_match: "nearby" },
    { index: 0, is_prospective_customer: true, intent_score: 99 },
    { index: 3, is_prospective_customer: true, intent_score: 19 },
    { index: 4, is_prospective_customer: false, intent_score: 90 },
    { index: "x", is_prospective_customer: true },
    { index: 9, is_prospective_customer: true, intent_score: 90 },
    null,
    "garbage",
  ];

  const rows = buildSignalRows(batch, items, ctx);

  it("keeps only prospective, sufficiently scored, first-seen items", () => {
    expect(rows.map((r) => r.post_url)).toEqual([batch[0].link, batch[1].link, batch[2].link]);
  });

  it("builds a full row", () => {
    expect(rows[0]).toEqual({
      post_url: "https://www.reddit.com/r/bangalore/comments/abc/neet/",
      source_channel: "Reddit r/bangalore",
      platform: "reddit",
      author_handle: "u/asha_r",
      post_excerpt: "Any good NEET coaching near Jayanagar? Posted by u/asha_r",
      post_date: "2 days ago",
      city: "Bengaluru",
      location_match: "exact",
      course_interest: "NEET",
      urgency: "medium",
      budget: null,
      intent_score: 65,
      lead_routing_category: "warm",
      suggested_public_reply: "Check the reviews of coaching centres near you before joining.",
      contact_requested: false,
      published_contact: null,
      contact_request_quote: null,
      search_query: "NEET coaching",
      search_city: "Bengaluru",
      discovered_at: NOW,
      updated_at: NOW,
    });
  });

  it("raises contact requests to hot and keeps the verified contact out of the excerpt", () => {
    expect(rows[1]).toMatchObject({
      intent_score: 80,
      urgency: "high",
      lead_routing_category: "hot",
      contact_requested: true,
      published_contact: "98450 12345",
      contact_request_quote: "Interested in Java training, please call me on 98450 12345",
      post_excerpt: "Interested in Java training, please call me on [contact removed]",
      author_handle: null,
      suggested_public_reply: null,
      location_match: null,
      course_interest: "NEET coaching",
      source_channel: "Quora",
    });
  });

  it("routes minors to guardian consent and keeps a valid model location match", () => {
    expect(rows[2]).toMatchObject({
      intent_score: 55,
      lead_routing_category: "guardian_consent_needed",
      location_match: "nearby",
      source_channel: "forum.example.com",
    });
  });

  it("flags minors from the model as well", () => {
    const [row] = buildSignalRows([candidate()], [{ index: 0, is_prospective_customer: true, intent_score: 90, is_minor: "true" }], ctx);
    expect(row.lead_routing_category).toBe("guardian_consent_needed");
  });

  it("ignores invalid model location matches", () => {
    const [row] = buildSignalRows([candidate()], [{ index: 0, is_prospective_customer: true, intent_score: 90, location_match: "far" }], ctx);
    expect(row.location_match).toBeNull();
  });

  it("returns nothing for an empty batch", () => {
    expect(buildSignalRows([], items, ctx)).toEqual([]);
    expect(buildSignalRows(batch, [], ctx)).toEqual([]);
  });
});

describe("normalizeEmail / normalizePhone", () => {
  it("normalises emails", () => {
    expect(normalizeEmail("  A.B@Example.COM ")).toBe("a.b@example.com");
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a b@c.com")).toBeNull();
    expect(normalizeEmail(5)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("keeps the last 10 digits of phone numbers", () => {
    expect(normalizePhone("+91 98450 12345")).toBe("9845012345");
    expect(normalizePhone("098450-12345")).toBe("9845012345");
    expect(normalizePhone(9845012345)).toBe("9845012345");
    expect(normalizePhone("12345678")).toBe("12345678");
    expect(normalizePhone("1234567")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone({})).toBeNull();
  });
});

describe("domainKey", () => {
  it.each([
    ["https://www.Example.com/about", "example.com"],
    ["example.com", "example.com"],
    ["http://shop.example.co.in/x", "shop.example.co.in"],
    ["https://www.instagram.com/Acme.Academy/?hl=en", "instagram.com/acme.academy"],
    ["facebook.com/AcmeAcademy", "facebook.com/acmeacademy"],
    ["https://wa.me/919845012345", "wa.me/919845012345"],
  ])("%s -> %s", (input, expected) => {
    expect(domainKey(input)).toBe(expected);
  });

  it.each(["https://facebook.com/", "https://www.linkedin.com", "localhost", "", "   ", "http://", 42, null])("returns null for %j", (input) => {
    expect(domainKey(input)).toBeNull();
  });
});

describe("leadDedupeKeys / dedupeLeadCandidates", () => {
  it("builds email, phone and domain keys", () => {
    expect(leadDedupeKeys({ email: "A@B.com", phone: "+91 98450 12345", profile_url: "https://www.acme.test/x" })).toEqual([
      "email:a@b.com",
      "phone:9845012345",
      "domain:acme.test",
    ]);
    expect(leadDedupeKeys({})).toEqual([]);
  });

  it("splits candidates into fresh leads and duplicates", () => {
    const existing = buildExistingKeySet([
      { email: "old@acme.test", phone: null, profile_url: null },
      { email: null, phone: "9845012345", profile_url: "https://instagram.com/oldacademy" },
    ]);
    const candidates = [
      { id: 1, email: "OLD@acme.test" },
      { id: 2, phone: "+91 98450-12345" },
      { id: 3, profile_url: "https://www.instagram.com/OldAcademy/" },
      { id: 4, profile_url: "https://www.instagram.com/newacademy" },
      { id: 5, profile_url: "https://instagram.com/newacademy?igsh=1" },
      { id: 6, email: "new@acme.test", phone: "9000000001" },
      { id: 7, phone: "9000000001" },
      { id: 8 },
      { id: 9 },
    ];
    const { fresh, duplicates } = dedupeLeadCandidates(candidates, existing);
    expect(fresh.map((c) => c.id)).toEqual([4, 6, 8, 9]);
    expect(duplicates.map((c) => c.id)).toEqual([1, 2, 3, 5, 7]);
  });

  it("does not modify the existing key set", () => {
    const existing = new Set<string>();
    dedupeLeadCandidates([{ email: "a@b.com" }], existing);
    expect(existing.size).toBe(0);
  });
});

describe("placeFitScore / leadStatusForScore", () => {
  it("scores listings from public signals", () => {
    expect(placeFitScore(place())).toBe(35);
    expect(placeFitScore(place({ website: "https://acme.test", phoneNumber: "080 1234 5678", rating: 4.5, ratingCount: 150 }))).toBe(93);
    expect(placeFitScore(place({ rating: 7, ratingCount: 100 }))).toBe(35 + 20 + 10);
    expect(placeFitScore(place({ rating: -1, ratingCount: 20 }))).toBe(35 + 0 + 5);
    expect(placeFitScore(place({ rating: 0, ratingCount: 19 }))).toBe(35);
  });

  it("maps scores to lead statuses", () => {
    expect(leadStatusForScore(80, THRESHOLDS)).toBe("Hot");
    expect(leadStatusForScore(79, THRESHOLDS)).toBe("Warm");
    expect(leadStatusForScore(50, THRESHOLDS)).toBe("Warm");
    expect(leadStatusForScore(49, THRESHOLDS)).toBe("Cold");
  });
});

describe("buildPlaceLeadRow", () => {
  const ctx = { runId: "run-1", query: "NEET coaching", city: "Bengaluru", thresholds: THRESHOLDS, now: NOW };

  it("maps a listing to a lead row", () => {
    const p = place({
      title: "Acme Academy",
      address: "12 MG Road, Bengaluru",
      category: "Coaching center",
      phoneNumber: "080 1234 5678",
      website: "https://acme.test",
      rating: 4.6,
      ratingCount: 210,
      cid: "123",
      latitude: 12.97,
      longitude: 77.59,
    });
    expect(buildPlaceLeadRow(p, { score: 85, reason: "Strong fit", scoredBy: "sarvam" }, ctx)).toEqual({
      name: "Acme Academy",
      company: "Acme Academy",
      title: "Coaching center",
      email: null,
      phone: "080 1234 5678",
      phone_source: "google_places",
      location: "12 MG Road, Bengaluru",
      industry: "Coaching center",
      profile_url: "https://acme.test",
      profile_url_source: "google_places",
      source: AGENT_LEAD_SOURCE,
      source_channel: PLACES_CHANNEL,
      score: 85,
      status: "Hot",
      scored_at: NOW,
      tags: ["ai-agent", "agent-run:run-1"],
      raw_answers: {
        pipeline_run_id: "run-1",
        discovery_query: "NEET coaching",
        discovery_location: "Bengaluru",
        fit_reason: "Strong fit",
        scored_by: "sarvam",
        place: {
          rating: 4.6,
          rating_count: 210,
          address: "12 MG Road, Bengaluru",
          category: "Coaching center",
          website: "https://acme.test",
          cid: "123",
          latitude: 12.97,
          longitude: 77.59,
        },
      },
    });
  });

  it("falls back to the city and nulls for missing details, and truncates long names", () => {
    const row = buildPlaceLeadRow(place({ title: "x".repeat(300) }), { score: 40, reason: null, scoredBy: "rules" }, ctx);
    expect(row).toMatchObject({
      title: null,
      industry: null,
      phone: null,
      phone_source: null,
      profile_url: null,
      profile_url_source: null,
      location: "Bengaluru",
      status: "Cold",
    });
    expect(row.name).toHaveLength(200);
  });

  it("tags runs consistently", () => {
    expect(agentRunTag("abc")).toBe("agent-run:abc");
  });
});

describe("parsePlaceScores", () => {
  it("maps valid indexes to scores or null", () => {
    const scores = parsePlaceScores(
      [
        { index: 0, fit_score: 72, reason: "Good fit" },
        { index: 1, score: "15" },
        { index: 2, fit_score: 90, is_relevant: false },
        { index: 3, fit_score: 90, is_relevant: "true" },
        { index: 0, fit_score: 10 },
        { index: 9, fit_score: 90 },
        { index: -1, fit_score: 90 },
        { index: 1.5, fit_score: 90 },
        null,
        { index: "4", fit_score: 20 },
      ],
      5
    );
    expect([...scores.entries()]).toEqual([
      [0, { score: 72, reason: "Good fit", scoredBy: "sarvam" }],
      [1, null],
      [2, null],
      [3, { score: 90, reason: null, scoredBy: "sarvam" }],
      [4, { score: 20, reason: null, scoredBy: "sarvam" }],
    ]);
  });
});

describe("uniquePlaces", () => {
  it("drops repeated cids and repeated name + address pairs", () => {
    const places = [
      place({ cid: "1", title: "A" }),
      place({ cid: "1", title: "A (duplicate)" }),
      place({ title: "Acme", address: "MG Road" }),
      place({ title: "ACME", address: "mg road" }),
      place({ title: "Acme", address: "Brigade Road" }),
      place({ title: "Acme" }),
    ];
    expect(uniquePlaces(places).map((p) => `${p.title}|${p.address}`)).toEqual(["A|null", "Acme|MG Road", "Acme|Brigade Road", "Acme|null"]);
  });
});

describe("signalLeadKeys / indexLeadsBySignalKeys", () => {
  it("uses the exact post URL plus email and phone", () => {
    expect(signalLeadKeys({ profile_url: " https://reddit.com/r/x/1/#c ", email: "A@b.com", phone: "98450 12345" })).toEqual([
      "url:https://reddit.com/r/x/1",
      "email:a@b.com",
      "phone:9845012345",
    ]);
    expect(signalLeadKeys({ profile_url: "  " })).toEqual([]);
  });

  it("indexes keys to the first lead that has them", () => {
    const index = indexLeadsBySignalKeys([
      { id: "l1", email: "a@b.com", profile_url: "https://reddit.com/r/x/1" },
      { id: "l2", email: "a@b.com", phone: "9845012345" },
    ]);
    expect(Object.fromEntries(index)).toEqual({
      "url:https://reddit.com/r/x/1": "l1",
      "email:a@b.com": "l1",
      "phone:9845012345": "l2",
    });
  });
});

describe("signalToLeadRow", () => {
  const signal = {
    id: "sig-1",
    post_url: "https://www.reddit.com/r/bangalore/1",
    platform: "reddit",
    source_channel: "Reddit r/bangalore",
    author_handle: "u/asha_r",
    city: "Bengaluru",
    course_interest: "NEET",
    intent_score: 85,
    contact_requested: true,
    published_contact: " 98450 12345 ",
    contact_request_quote: "please call me on 98450 12345",
    post_excerpt: "Need NEET coaching",
    search_query: "NEET coaching",
    search_city: "Bengaluru",
    lead_routing_category: "hot",
  };

  it("copies a published phone number", () => {
    expect(signalToLeadRow(signal, THRESHOLDS, NOW)).toEqual({
      name: "u/asha_r",
      company: "",
      title: null,
      email: null,
      phone: "98450 12345",
      phone_source: "author_published",
      verified_email_source: null,
      location: "Bengaluru",
      course_interest: "NEET",
      profile_url: "https://www.reddit.com/r/bangalore/1",
      profile_url_source: "public_post",
      source: AGENT_LEAD_SOURCE,
      source_channel: "Reddit r/bangalore",
      score: 85,
      status: "Hot",
      scored_at: NOW,
      needs_guardian_consent: false,
      tags: ["ai-agent", "intent-signal"],
      raw_answers: {
        intent_signal_id: "sig-1",
        post_excerpt: "Need NEET coaching",
        contact_request_quote: "please call me on 98450 12345",
        discovery_query: "NEET coaching",
        discovery_location: "Bengaluru",
      },
    });
  });

  it("copies a published email", () => {
    const row = signalToLeadRow({ ...signal, published_contact: "Asha.R@Example.com" }, THRESHOLDS, NOW);
    expect(row).toMatchObject({ email: "asha.r@example.com", verified_email_source: "author_published", phone: null, phone_source: null });
  });

  it("copies no contact without an explicit request", () => {
    for (const s of [{ ...signal, contact_requested: false }, { ...signal, contact_requested: "true" }, { ...signal, published_contact: null }]) {
      expect(signalToLeadRow(s, THRESHOLDS, NOW)).toMatchObject({ email: null, phone: null });
    }
  });

  it("falls back for missing fields", () => {
    const row = signalToLeadRow({ intent_score: "x", lead_routing_category: "guardian_consent_needed" }, THRESHOLDS, NOW);
    expect(row).toMatchObject({
      name: "web user",
      location: null,
      course_interest: null,
      profile_url: null,
      source_channel: "web",
      score: 0,
      status: "Cold",
      needs_guardian_consent: true,
      raw_answers: { intent_signal_id: null, post_excerpt: null, contact_request_quote: null, discovery_query: null, discovery_location: null },
    });
    expect(signalToLeadRow({ platform: "quora", author_handle: "  " }, THRESHOLDS, NOW)).toMatchObject({
      name: "quora user",
      source_channel: "quora",
    });
  });
});

describe("computeRunStats", () => {
  it("summarises runs", () => {
    const runs = [
      { id: "r1", status: "completed", duration_ms: 1000, total_leads_found: 99, created_at: "2026-03-01T10:00:00Z" },
      { id: "r2", status: "failed", duration_ms: 3000, total_leads_found: 4, created_at: "2026-03-03T10:00:00Z" },
      { id: "r3", status: "running", duration_ms: null, total_leads_found: null, created_at: "2026-03-04T10:00:00Z" },
      { id: "r4", status: "completed_with_errors", duration_ms: null, total_leads_found: null, created_at: "2026-03-02T10:00:00Z" },
      { id: "r5", status: "queued", duration_ms: 50, total_leads_found: 7, created_at: "2026-02-01T10:00:00Z" },
      { id: "r6", status: "completed", duration_ms: -5, total_leads_found: 0, created_at: "2026-02-02T10:00:00Z" },
    ];
    const totals = new Map<string, RunTotals>([["r1", { leadsCreated: 5, signalsSaved: 2 }]]);
    expect(computeRunStats(runs, totals)).toEqual({
      runs: 6,
      active: 2,
      succeeded: 3,
      failed: 1,
      successRate: 75,
      avgDurationMs: 2000,
      leadsFound: 5,
      signalsFound: 6,
      lastRunAt: "2026-03-04T10:00:00Z",
    });
  });

  it("rounds the success rate to one decimal", () => {
    const runs = ["completed", "completed", "failed"].map((status, i) => ({
      id: `r${i}`,
      status,
      duration_ms: 1,
      total_leads_found: 0,
      created_at: `2026-03-0${i + 1}T00:00:00Z`,
    }));
    expect(computeRunStats(runs, new Map()).successRate).toBe(66.7);
  });

  it("returns nulls before any finished run", () => {
    expect(computeRunStats([], new Map())).toEqual({
      runs: 0,
      active: 0,
      succeeded: 0,
      failed: 0,
      successRate: null,
      avgDurationMs: null,
      leadsFound: 0,
      signalsFound: 0,
      lastRunAt: null,
    });
    expect(
      computeRunStats([{ id: "q", status: "queued", duration_ms: null, total_leads_found: null, created_at: NOW }], new Map())
    ).toMatchObject({ active: 1, successRate: null, avgDurationMs: null, lastRunAt: NOW });
  });
});
