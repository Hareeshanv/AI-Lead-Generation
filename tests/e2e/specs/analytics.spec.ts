import { api, expect, signIn, test, unique } from "../support/fixtures";

test.describe("analytics", () => {
  test("dashboard KPIs show the same totals as the analytics API", async ({ page, request }) => {
    for (const score of [92, 35]) await api(request, "admin", "post", "/leads", { name: unique("E2E KPI"), score });
    const summary = await api(request, "admin", "get", "/analytics/summary");
    expect(summary.current.leads).toBeGreaterThanOrEqual(2);

    await signIn(page, "admin", "/dashboard");
    const card = (title: string) => page.getByText(title, { exact: true }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
    await expect(card("New leads")).toContainText(summary.current.leads.toLocaleString());
    await expect(card("Hot leads")).toContainText(summary.current.hotLeads.toLocaleString());
  });

  test("the analytics page renders reports for the selected range", async ({ page }) => {
    await signIn(page, "admin", "/analytics");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/source|funnel|status/i).first()).toBeVisible();
  });
});
