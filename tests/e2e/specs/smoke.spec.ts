import { expect, signIn, test } from "../support/fixtures";

const PAGES: Array<[path: string, heading: RegExp]> = [
  ["/dashboard", /dashboard/i],
  ["/leads", /^leads$/i],
  ["/crm", /pipeline|crm/i],
  ["/campaigns", /campaigns/i],
  ["/campaigns/new", /campaign/i],
  ["/agents", /lead discovery/i],
  ["/workflows", /workflows/i],
  ["/analytics", /analytics|reports/i],
  ["/integrations", /integrations/i],
  ["/notifications", /notifications/i],
  ["/settings", /settings/i],
];

for (const role of ["admin", "member"] as const) {
  test.describe(`every page renders for the ${role}`, () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, role);
    });

    for (const [path, heading] of PAGES) {
      test(path, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await expect(page.getByText(/something went wrong|couldn't load|application error/i)).toHaveCount(0);
      });
    }
  });
}

test("unknown routes show the not-found page", async ({ page }) => {
  await signIn(page, "admin");
  const res = await page.goto("/definitely-not-a-page");
  expect(res?.status()).toBe(404);
});
