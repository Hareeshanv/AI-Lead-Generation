import { api, apiBody, expect, signIn, test, unique } from "../support/fixtures";

test.describe("leads", () => {
  test("admin adds, finds, edits and deletes a lead", async ({ page, request }) => {
    const name = unique("E2E Lead");
    await signIn(page, "admin", "/leads");

    await page.getByRole("button", { name: "Add lead" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add lead" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("textbox", { name: "Email" }).fill(`${name.replace(/\W+/g, "-").toLowerCase()}@example.com`);
    await dialog.getByLabel("Company").fill("E2E Widgets");
    await dialog.getByLabel("Status").selectOption("Warm");
    await dialog.getByRole("button", { name: "Create lead" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("link", { name }).or(page.getByText(name)).first()).toBeVisible();

    // Header search routes to /leads?q= and filters the list.
    await page.goto("/dashboard");
    await page.getByRole("textbox", { name: "Search all leads" }).fill(name);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/leads\\?q=${encodeURIComponent(name).replace(/%20/g, "(%20|\\+)")}`));
    await expect(page.getByRole("textbox", { name: "Search leads", exact: true })).toHaveValue(name);
    await expect(page.getByRole("checkbox", { name: `Select ${name}` })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Select (?!all)/ })).toHaveCount(1);

    // Detail page: change status.
    await page.getByRole("link", { name: "View lead details" }).first().click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByLabel("Lead status").selectOption("Hot");
    await expect.poll(async () => (await api(request, "admin", "get", `/leads?q=${encodeURIComponent(name)}`))[0]?.status).toBe("Hot");

    // Delete from the list.
    await page.goto(`/leads?q=${encodeURIComponent(name)}`);
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("dialog", { name: "Delete lead" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("checkbox", { name: `Select ${name}` })).toHaveCount(0);
  });

  test("the sidebar lead count is the workspace total", async ({ page, request }) => {
    await api(request, "admin", "post", "/leads", { name: unique("E2E Count") });
    const { meta } = await apiBody(request, "admin", "get", "/leads?pageSize=1");
    expect(meta.total).toBeGreaterThan(0);
    await signIn(page, "admin", "/dashboard");
    await expect(page.getByRole("navigation").getByRole("link", { name: /^Leads/ })).toContainText(meta.total.toLocaleString());
  });

  test("members cannot delete leads or use manager-only bulk actions", async ({ page, request }) => {
    const name = unique("E2E Member View");
    await api(request, "admin", "post", "/leads", { name });
    await signIn(page, "member", `/leads?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("checkbox", { name: `Select ${name}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import signals" })).toHaveCount(0);

    await page.getByRole("checkbox", { name: `Select ${name}` }).check();
    const bulk = page.getByRole("toolbar", { name: "Bulk actions" }).or(page.getByLabel("Bulk actions"));
    await expect(bulk.getByRole("button", { name: "Tag", exact: true })).toBeVisible();
    await expect(bulk.getByRole("button", { name: "Add to campaign" })).toHaveCount(0);
    await expect(bulk.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });
});
