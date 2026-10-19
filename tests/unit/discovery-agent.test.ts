import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agentsDb: {
    log: vi.fn(),
    logExecution: vi.fn(),
    listLeadContacts: vi.fn(),
    insertLeads: vi.fn(),
  },
  dbQueries: { upsertIntentSignals: vi.fn() },
}));
const callAgent = vi.hoisted(() => vi.fn());
const serper = vi.hoisted(() => ({ searchSerper: vi.fn(), searchPlaces: vi.fn() }));

vi.mock("@ai-lead-gen/database", () => db);
vi.mock("../../services/sarvam", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/sarvam")>()),
  sarvamClient: { callAgent },
}));
vi.mock("../../services/discovery/serper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/discovery/serper")>()),
  searchSerper: serper.searchSerper,
  searchPlaces: serper.searchPlaces,
}));

import { runLeadDiscovery, STEPS, type LeadDiscoveryParams } from "../../services/discovery/agent";
import type { SerperPlace } from "../../services/discovery/serper";

const ORG = "11111111-1111-4111-8111-111111111111";

function params(overrides: Partial<LeadDiscoveryParams> = {}): LeadDiscoveryParams {
  return {
    orgId: ORG,
    runId: "run-1",
    query: "dental clinics",
    location: "Pune",
    sources: ["places"],
    maxResults: 10,
    serperApiKey: "serper-key",
    sarvam: { apiKey: "sarvam-key" },
    thresholds: { hot: 80, warm: 50 },
    ...overrides,
  };
}

function place(title: string, overrides: Partial<SerperPlace> = {}): SerperPlace {
  return {
    title,
    address: `${title} Road, Pune`,
    category: "Dental clinic",
    phoneNumber: null,
    website: null,
    rating: 4.5,
    ratingCount: 120,
    cid: `cid-${title}`,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

const sarvamOk = (output: Record<string, any>, tokensUsed = 0) => ({
  success: true,
  agentId: "x",
  output,
  executionId: "e",
  tokensUsed,
  durationMs: 1,
  modelUsed: "m",
});

const stepStatus = (agentId: string) =>
  db.agentsDb.logExecution.mock.calls.find(([, row]) => row.agent_id === agentId)?.[1].status;

beforeEach(() => {
  vi.clearAllMocks();
  db.agentsDb.log.mockResolvedValue(undefined);
  db.agentsDb.logExecution.mockResolvedValue(undefined);
  db.agentsDb.listLeadContacts.mockResolvedValue([]);
  db.agentsDb.insertLeads.mockImplementation(async (_org: string, rows: Record<string, any>[]) => ({
    inserted: rows.map((row, i) => ({ ...row, id: `lead-${i + 1}` })),
    conflicts: 0,
  }));
  db.dbQueries.upsertIntentSignals.mockImplementation(async (_org: string, rows: Record<string, any>[]) =>
    rows.map((row, i) => ({ ...row, id: `signal-${i + 1}` }))
  );
  serper.searchSerper.mockResolvedValue([]);
  serper.searchPlaces.mockResolvedValue([]);
});

describe("runLeadDiscovery: places", () => {
  it("scores listings with Sarvam, skips irrelevant ones and duplicates, and saves the rest as leads", async () => {
    serper.searchPlaces
      .mockResolvedValueOnce([place("Smile Dental"), place("Pet Grooming"), place("City Dental", { phoneNumber: "+91 98450 12345" })])
      .mockResolvedValueOnce([]);
    callAgent.mockResolvedValue(
      sarvamOk(
        {
          results: [
            { index: 0, fit_score: 88, reason: "Dental clinic in Pune" },
            { index: 1, is_relevant: false, fit_score: 5 },
            { index: 2, fit_score: 60 },
          ],
        },
        120
      )
    );
    // City Dental is already a lead (same phone number).
    db.agentsDb.listLeadContacts.mockResolvedValue([{ phone: "098450-12345" }]);
    const scoreRow = vi.fn((row: Record<string, any>) => ({ ...row, scored_by_workspace_rules: true }));

    const result = await runLeadDiscovery(params({ scoreRow }));

    expect(serper.searchPlaces).toHaveBeenCalledTimes(2);
    expect(serper.searchPlaces.mock.calls[0]).toEqual(["serper-key", expect.stringContaining("dental clinics"), 1, expect.any(Object)]);
    expect(callAgent).toHaveBeenCalledTimes(1);
    expect(callAgent.mock.calls[0][0].input.businesses).toHaveLength(3);

    const [orgId, inserted] = db.agentsDb.insertLeads.mock.calls[0];
    expect(orgId).toBe(ORG);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      name: "Smile Dental",
      source: "AI Agent",
      source_channel: "Google Maps",
      score: 88,
      status: "Hot",
      scored_by_workspace_rules: true,
    });
    expect(inserted[0].tags).toContain("agent-run:run-1");
    expect(scoreRow).toHaveBeenCalledTimes(2);

    expect(result).toMatchObject({
      status: "completed",
      searched: { web: 0, places: 3 },
      leadsCreated: 1,
      duplicates: 1,
      highScore: 1,
      tokensUsed: 120,
      leads: [{ id: "lead-1", source: "AI Agent" }],
      errors: [],
    });
    expect(stepStatus(STEPS.placesSearch)).toBe("completed");
    expect(stepStatus(STEPS.placesScore)).toBe("completed");
    expect(stepStatus(STEPS.save)).toBe("completed");
  });

  it("stops paging when a page adds no new listings", async () => {
    const page = [place("Smile Dental"), place("City Dental")];
    serper.searchPlaces.mockResolvedValue(page);
    callAgent.mockResolvedValue(sarvamOk({ results: [] }));
    await runLeadDiscovery(params());
    expect(serper.searchPlaces).toHaveBeenCalledTimes(2);
  });

  it("falls back to rule-based scores when Sarvam fails, and reports the run as completed with errors", async () => {
    serper.searchPlaces.mockResolvedValueOnce([place("Smile Dental", { website: "https://smile.example", phoneNumber: "9845000000" })]);
    callAgent.mockResolvedValue({ ...sarvamOk({}), success: false, error: "Sarvam timed out" });

    const result = await runLeadDiscovery(params());

    expect(result.status).toBe("completed_with_errors");
    expect(result.leadsCreated).toBe(1);
    expect(result.errors.join(" ")).toMatch(/Sarvam timed out; used rule-based scores/);
    const row = db.agentsDb.insertLeads.mock.calls[0][1][0];
    expect(row.raw_answers.scored_by).toBe("rules");
    expect(stepStatus(STEPS.placesScore)).toBe("completed_with_errors");
  });

  it("caps saved leads at maxResults", async () => {
    serper.searchPlaces.mockResolvedValueOnce([place("A Dental"), place("B Dental"), place("C Dental")]).mockResolvedValueOnce([]);
    callAgent.mockResolvedValue(
      sarvamOk({ results: [0, 1, 2].map((index) => ({ index, fit_score: 70 })) })
    );
    const result = await runLeadDiscovery(params({ maxResults: 2 }));
    expect(db.agentsDb.insertLeads.mock.calls[0][1]).toHaveLength(2);
    expect(result.leadsCreated).toBe(2);
  });
});

describe("runLeadDiscovery: web", () => {
  const post = {
    title: "Looking for a good dental clinic in Pune",
    link: "https://www.reddit.com/r/pune/comments/abc123/dentist",
    snippet: "Need a dentist near Kothrud this week, please suggest. Call 9845012345",
    date: null,
  };

  it("classifies redacted posts with Sarvam and saves intent signals", async () => {
    serper.searchSerper.mockResolvedValueOnce([post]).mockRejectedValueOnce(new Error("Serper rate limit")).mockResolvedValue([]);
    callAgent.mockResolvedValue(
      sarvamOk({ results: [{ index: 0, is_prospective_customer: true, intent_score: 75, location_match: "exact" }] }, 40)
    );

    const result = await runLeadDiscovery(params({ sources: ["web"] }));

    const sent = callAgent.mock.calls[0][0].input.results[0];
    expect(sent.platform).toBe("reddit");
    expect(JSON.stringify(sent)).not.toContain("9845012345");

    const [orgId, rows] = db.dbQueries.upsertIntentSignals.mock.calls[0];
    expect(orgId).toBe(ORG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ post_url: post.link, platform: "reddit", search_query: "dental clinics" });
    expect(rows[0].intent_score).toBeGreaterThanOrEqual(75);

    // One failed query out of several is reported but does not fail the run.
    expect(result.status).toBe("completed_with_errors");
    expect(result.errors.some((e) => e.includes("Serper rate limit"))).toBe(true);
    expect(result).toMatchObject({ signalsSaved: 1, signalIds: ["signal-1"], leadsCreated: 0, tokensUsed: 40 });
    expect(db.agentsDb.insertLeads).not.toHaveBeenCalled();
  });

  it("drops results Sarvam does not classify as prospective customers", async () => {
    serper.searchSerper.mockResolvedValueOnce([post]);
    callAgent.mockResolvedValue(sarvamOk({ results: [{ index: 0, is_prospective_customer: false, intent_score: 90 }] }));
    const result = await runLeadDiscovery(params({ sources: ["web"] }));
    expect(db.dbQueries.upsertIntentSignals).not.toHaveBeenCalled();
    expect(result.signalsSaved).toBe(0);
  });

  it("fails the run when every web search fails", async () => {
    serper.searchSerper.mockRejectedValue(new Error("Serper rejected the API key"));
    const result = await runLeadDiscovery(params({ sources: ["web"] }));

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toMatch(/Serper rejected the API key/);
    expect(callAgent).not.toHaveBeenCalled();
    expect(stepStatus(STEPS.webSearch)).toBe("failed");
  });

  it("fails without searching when the query has no usable words", async () => {
    const result = await runLeadDiscovery(params({ sources: ["web", "places"], query: ' "*" () ', location: "" }));
    expect(result.status).toBe("failed");
    expect(serper.searchSerper).not.toHaveBeenCalled();
    expect(serper.searchPlaces).not.toHaveBeenCalled();
  });

  it("keeps running when recording a step fails", async () => {
    db.agentsDb.logExecution.mockRejectedValue(new Error("db down"));
    serper.searchPlaces.mockResolvedValueOnce([place("Smile Dental")]);
    callAgent.mockResolvedValue(sarvamOk({ results: [{ index: 0, fit_score: 70 }] }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runLeadDiscovery(params());
    warn.mockRestore();
    expect(result.status).toBe("completed");
    expect(result.leadsCreated).toBe(1);
  });
});
