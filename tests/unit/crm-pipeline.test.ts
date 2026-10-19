import { describe, expect, it } from "vitest";
import {
  DEAL_STAGES,
  STAGE_PROBABILITY,
  isClosedStage,
  leadStatusForDealStage,
  pipelineTotals,
  probabilityAfterStageChange,
  stageChangePatch,
} from "../../apps/api/src/services/crm/pipeline";

const NOW = new Date("2026-03-01T10:00:00.000Z");

describe("STAGE_PROBABILITY", () => {
  it("has a default for every stage, increasing until the closed stages", () => {
    expect(Object.keys(STAGE_PROBABILITY).sort()).toEqual([...DEAL_STAGES].sort());
    expect(STAGE_PROBABILITY["Closed Won"]).toBe(100);
    expect(STAGE_PROBABILITY["Closed Lost"]).toBe(0);
    const open = ["New", "Qualified", "Proposal", "Negotiation"] as const;
    for (let i = 1; i < open.length; i++) expect(STAGE_PROBABILITY[open[i]]).toBeGreaterThan(STAGE_PROBABILITY[open[i - 1]]);
  });
});

describe("isClosedStage", () => {
  it("is true only for the two closed stages", () => {
    expect(isClosedStage("Closed Won")).toBe(true);
    expect(isClosedStage("Closed Lost")).toBe(true);
    for (const s of ["New", "Qualified", "Proposal", "Negotiation", "closed won", "", "Closed"]) expect(isClosedStage(s)).toBe(false);
  });
});

describe("leadStatusForDealStage", () => {
  it("maps open stages past New to Qualified", () => {
    expect(leadStatusForDealStage("Qualified")).toBe("Qualified");
    expect(leadStatusForDealStage("Proposal")).toBe("Qualified");
    expect(leadStatusForDealStage("Negotiation")).toBe("Qualified");
  });

  it("maps closed stages", () => {
    expect(leadStatusForDealStage("Closed Won")).toBe("Closed");
    expect(leadStatusForDealStage("Closed Lost")).toBe("Cold");
  });

  it("leaves the lead alone for New and unknown stages", () => {
    expect(leadStatusForDealStage("New")).toBeNull();
    expect(leadStatusForDealStage("Unknown")).toBeNull();
    expect(leadStatusForDealStage("")).toBeNull();
  });
});

describe("probabilityAfterStageChange", () => {
  it("uses the stage default when the probability was the previous default", () => {
    expect(probabilityAfterStageChange("New", "Proposal", 10)).toBe(50);
    expect(probabilityAfterStageChange("Proposal", "Qualified", 50)).toBe(25);
  });

  it("keeps a customised probability", () => {
    expect(probabilityAfterStageChange("New", "Proposal", 33)).toBe(33);
    expect(probabilityAfterStageChange("Proposal", "Negotiation", 0)).toBe(0);
  });

  it("uses the default when there is no current probability", () => {
    expect(probabilityAfterStageChange("Proposal", "Negotiation", null)).toBe(75);
    expect(probabilityAfterStageChange("Proposal", "Negotiation", undefined)).toBe(75);
  });

  it("uses the default for a new deal (no previous stage)", () => {
    expect(probabilityAfterStageChange(null, "Qualified", null)).toBe(25);
    expect(probabilityAfterStageChange(null, "Qualified", 40)).toBe(40);
  });

  it("forces 100 / 0 for closed stages", () => {
    expect(probabilityAfterStageChange("Negotiation", "Closed Won", 60)).toBe(100);
    expect(probabilityAfterStageChange("Negotiation", "Closed Lost", 60)).toBe(0);
  });

  it("resets to the stage default when reopening a closed deal", () => {
    expect(probabilityAfterStageChange("Closed Won", "Negotiation", 100)).toBe(75);
    expect(probabilityAfterStageChange("Closed Lost", "Qualified", 0)).toBe(25);
    expect(probabilityAfterStageChange("Closed Lost", "Qualified", 55)).toBe(25);
  });

  it("keeps the current probability for unknown target stages", () => {
    expect(probabilityAfterStageChange("New", "Mystery", 42)).toBe(42);
    expect(probabilityAfterStageChange("New", "Mystery", null)).toBe(0);
  });
});

describe("stageChangePatch", () => {
  it("moves between open stages and clears closed_at", () => {
    expect(stageChangePatch({ stage: "New", probability: 10 }, "Qualified", { now: NOW })).toEqual({
      stage: "Qualified",
      probability: 25,
      closed_at: null,
    });
  });

  it("stamps closed_at when a deal is won", () => {
    expect(stageChangePatch({ stage: "Negotiation", probability: 75 }, "Closed Won", { now: NOW })).toEqual({
      stage: "Closed Won",
      probability: 100,
      closed_at: NOW.toISOString(),
    });
  });

  it("records the lost reason, defaulting to null", () => {
    expect(stageChangePatch({ stage: "Proposal" }, "Closed Lost", { now: NOW, lostReason: "Budget" })).toEqual({
      stage: "Closed Lost",
      probability: 0,
      closed_at: NOW.toISOString(),
      lost_reason: "Budget",
    });
    expect(stageChangePatch({ stage: "Proposal" }, "Closed Lost", { now: NOW }).lost_reason).toBeNull();
  });

  it("keeps the original closed_at when moving between closed stages", () => {
    const patch = stageChangePatch({ stage: "Closed Won", probability: 100 }, "Closed Lost", { now: NOW, lostReason: "Churned" });
    expect(patch).not.toHaveProperty("closed_at");
    expect(patch).toMatchObject({ stage: "Closed Lost", probability: 0, lost_reason: "Churned" });
  });

  it("clears the lost reason when a lost deal is reopened or won", () => {
    expect(stageChangePatch({ stage: "Closed Lost", probability: 0 }, "Proposal", { now: NOW })).toEqual({
      stage: "Proposal",
      probability: 50,
      closed_at: null,
      lost_reason: null,
    });
    const won = stageChangePatch({ stage: "Closed Lost", probability: 0 }, "Closed Won", { now: NOW });
    expect(won.lost_reason).toBeNull();
    expect(won).not.toHaveProperty("closed_at");
  });

  it("stamps closed_at for a deal with no stage", () => {
    expect(stageChangePatch({ stage: null }, "Closed Won", { now: NOW }).closed_at).toBe(NOW.toISOString());
  });

  it("defaults now to the current time", () => {
    const before = Date.now();
    const closedAt = Date.parse(stageChangePatch({ stage: "New" }, "Closed Won").closed_at as string);
    expect(closedAt).toBeGreaterThanOrEqual(before);
    expect(closedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("pipelineTotals", () => {
  it("is zero for no deals", () => {
    expect(pipelineTotals([])).toEqual({ total: 0, weighted: 0 });
  });

  it("sums values and probability-weighted values", () => {
    expect(
      pipelineTotals([
        { value: 1000, probability: 50 },
        { value: "2000", probability: 25 },
        { value: 400, probability: 100 },
      ])
    ).toEqual({ total: 3400, weighted: 1400 });
  });

  it("treats missing or invalid values and probabilities as 0", () => {
    expect(
      pipelineTotals([
        { value: null, probability: 50 },
        { value: "abc", probability: 50 },
        { value: 500, probability: null },
        { value: 500 },
        {},
      ])
    ).toEqual({ total: 1000, weighted: 0 });
  });

  it("rounds the weighted total to cents", () => {
    expect(pipelineTotals([{ value: 10, probability: 33 }, { value: 0.1, probability: 33 }]).weighted).toBe(3.33);
    expect(pipelineTotals([{ value: 1, probability: 1 }]).weighted).toBe(0.01);
  });
});
