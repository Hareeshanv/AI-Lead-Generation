import { beforeAll, describe, expect, it } from "vitest";
import { as, hasDb, leadInput } from "./support/helpers";

/**
 * Org C is empty apart from these fixtures, so every KPI can be checked exactly:
 *   leads: scores 90, 85, 40, 10        -> 4 leads, 2 hot (>= 80), avg 56.3
 *   deals: Closed Won 1000 (lead 1), Closed Lost 500 (lead 2), Proposal 2000 (no lead)
 */
describe.skipIf(!hasDb())("analytics API vs seeded fixtures", () => {
  const today = new Date();
  const day = (offset: number) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const range = { from: day(-1), to: day(1) };

  beforeAll(async () => {
    const settings = await as("adminC").patch("/api/settings", { scoring: { hot: 80, warm: 50 } });
    expect(settings.status).toBe(200);

    const leads = [];
    for (const score of [90, 85, 40, 10]) {
      const res = await as("adminC").post("/api/leads", leadInput({ score }));
      expect(res.status).toBe(201);
      leads.push(res.body.data);
    }
    for (const deal of [
      { title: "Won deal", value: 1000, stage: "Closed Won", leadId: leads[0].id },
      { title: "Lost deal", value: 500, stage: "Closed Lost", leadId: leads[1].id },
      { title: "Open deal", value: 2000, stage: "Proposal" },
    ]) {
      expect((await as("adminC").post("/api/deals", deal)).status).toBe(201);
    }
  });

  it("summary KPIs match the fixtures", async () => {
    const res = await as("adminC").get("/api/analytics/summary").query(range);
    expect(res.status).toBe(200);
    const { current, previous, pipeline, recentLeads, timeseries } = res.body.data;
    expect(current).toMatchObject({
      leads: 4,
      hotLeads: 2,
      avgScore: 56.3,
      leadsWithDeal: 2,
      leadsWon: 1,
      dealsCreated: 3,
      dealsCreatedValue: 3500,
      dealsWon: 1,
      dealsLost: 1,
      wonValue: 1000,
      winRate: 0.5,
      leadToDealRate: 0.5,
      messagesSent: 0,
      openRate: null,
    });
    expect(previous.leads).toBe(0);
    expect(pipeline).toMatchObject({ openDeals: 1, openValue: 2000 });
    expect(pipeline.byStage.find((s: any) => s.stage === "Proposal")).toMatchObject({ count: 1, value: 2000 });
    expect(recentLeads).toHaveLength(4);
    const seriesLeads = timeseries.reduce((sum: number, b: any) => sum + (Number(b.leads) || 0), 0);
    expect(seriesLeads).toBe(4);
  });

  it("reports breakdowns match the fixtures", async () => {
    const res = await as("adminC").get("/api/analytics/reports").query(range);
    expect(res.status).toBe(200);
    const { funnel, bySource, scoreDistribution } = res.body.data;
    expect(Number(funnel.leads)).toBe(4);
    expect(Number(funnel.deals)).toBe(2);
    expect(Number(funnel.won)).toBe(1);
    expect(bySource.reduce((s: number, r: any) => s + Number(r.leads), 0)).toBe(4);
    const buckets = Object.fromEntries(scoreDistribution.map((r: any) => [r.range, Number(r.leads)]));
    expect(buckets).toEqual({ "0-19": 1, "20-39": 0, "40-59": 1, "60-79": 0, "80-100": 2 });
  });

  it("analytics are scoped to the caller's workspace", async () => {
    const res = await as("adminB").get("/api/analytics/summary").query(range);
    expect(res.body.data.current.dealsWon).toBe(0);
    expect(res.body.data.current.wonValue).toBe(0);
  });

  it("validates the range", async () => {
    expect((await as("adminC").get("/api/analytics/summary").query({ from: day(1), to: day(-1) })).status).toBe(400);
    expect((await as("adminC").get("/api/analytics/summary").query({ from: "2000-01-01", to: day(0) })).status).toBe(400);
    expect((await as("adminC").get("/api/analytics/summary").query({ from: "yesterday" })).status).toBe(400);
    expect((await as("adminC").get("/api/analytics/summary").query({ bucket: "hour" })).status).toBe(400);
  });
});
