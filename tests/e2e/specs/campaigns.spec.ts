import { api, expect, signIn, test, unique } from "../support/fixtures";

const emailStep = { delayMinutes: 0, subject: "Hello {{first_name}}", body: "A quick note about {{company}}" };

test.describe("campaigns", () => {
  test("launch is blocked until the email channel is configured", async ({ page, request }) => {
    const name = unique("E2E Campaign");
    const campaign = await api(request, "admin", "post", "/campaigns", { name, channel: "email", steps: [emailStep] });

    await signIn(page, "admin", `/campaigns/${campaign.id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /email is not configured/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Integrations" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch" })).toBeDisabled();
    expect((await api(request, "admin", "get", `/campaigns/${campaign.id}`)).status).toBe("draft");
  });

  test("the campaign list shows drafts and members get a read-only view", async ({ page, request }) => {
    const name = unique("E2E Read Only");
    const campaign = await api(request, "admin", "post", "/campaigns", { name, channel: "email", steps: [emailStep] });

    await signIn(page, "member", "/campaigns");
    await expect(page.getByText(name)).toBeVisible();
    await page.goto(`/campaigns/${campaign.id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete campaign" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Edit/ })).toHaveCount(0);
  });

  test("the new-campaign wizard saves a draft", async ({ page, request }) => {
    const name = unique("E2E Wizard");
    await signIn(page, "admin", "/campaigns/new");
    await page.getByLabel("Campaign name").fill(name);
    await page.getByRole("button", { name: "Next" }).click(); // -> Audience
    await page.getByRole("button", { name: "Next" }).click(); // -> Messages
    await page.getByLabel("Subject").first().fill("Hello {{first_name|there}}");
    await page.getByLabel("Body (plain text)").first().fill("Wanted to share something useful for {{company}}.");
    await page.getByRole("button", { name: "Next" }).click(); // -> Schedule
    await page.getByRole("button", { name: "Next" }).click(); // -> Review
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect.poll(async () => (await api(request, "admin", "get", `/campaigns?q=${encodeURIComponent(name)}`)).length).toBe(1);
    const [saved] = await api(request, "admin", "get", `/campaigns?q=${encodeURIComponent(name)}`);
    expect(saved).toMatchObject({ status: "draft", channel: "email" });
  });
});
