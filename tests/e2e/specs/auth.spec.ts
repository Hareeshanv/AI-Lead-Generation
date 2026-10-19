import { expect, loadFixtures, PASSWORD, signIn, test } from "../support/fixtures";

test.describe("auth", () => {
  test("signed-out visitors are sent to login and come back after signing in", async ({ page }) => {
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/login\?next=%2Fleads/);
    const { admin } = loadFixtures().users;
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await expect(page.getByRole("heading", { name: "Leads", level: 1 })).toBeVisible();
  });

  test("a wrong password shows an error and stays on login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(loadFixtures().users.admin.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("register creates an account and its own workspace", async ({ page }) => {
    const { runId } = loadFixtures();
    await page.goto("/register");
    await page.getByLabel("Full name").fill("QA Registered");
    await page.getByLabel("Email").fill(`qa-e2e-register-${runId}@example.com`);
    await page.getByLabel("Company").fill(`QA Registered Co ${runId}`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("tab", { name: "Workspace" }).or(page.getByRole("button", { name: "Workspace" })).first().click();
    await expect(page.locator(`input[value="QA Registered Co ${runId}"]`)).toBeVisible();
  });

  test("log out ends the session", async ({ page }) => {
    await signIn(page, "member");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
