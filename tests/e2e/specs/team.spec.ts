import { api, expect, loadFixtures, signIn, test, unique } from "../support/fixtures";

test.describe("team and permissions", () => {
  // Supabase's invite creates the auth user right away; the signup trigger adds them as a *pending* member
  // until they accept (first sign-in), so the row shows Pending with Resend invite / Revoke.
  test("admin invites a teammate, sees them pending, changes their role and revokes the invite", async ({ page, request }) => {
    const email = `qa-e2e-invitee-${loadFixtures().runId}@example.com`;
    await signIn(page, "admin", "/settings");
    await page.getByRole("tab", { name: "Members" }).click();
    await page.getByRole("textbox", { name: "Email address" }).fill(email);
    await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("manager");
    await page.getByRole("button", { name: "Send invite" }).click();

    const row = page.getByRole("listitem").filter({ hasText: email });
    await expect(row.getByText("Pending", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: `Resend invite to ${email}` })).toBeVisible();
    await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);
    const roleSelect = row.getByRole("combobox", { name: `Role for ${email}` });
    await expect(roleSelect).toHaveValue("manager");
    await roleSelect.selectOption("member");
    await expect
      .poll(async () => ((await api(request, "admin", "get", "/members")) as { email: string; role: string; status: string }[]).find((m) => m.email === email))
      .toMatchObject({ role: "member", status: "pending" });

    page.once("dialog", (d) => void d.accept());
    await row.getByRole("button", { name: `Revoke invitation for ${email}` }).click();
    await expect(row).toHaveCount(0);
  });

  test("members see the team but cannot invite, change roles or edit the workspace", async ({ page }) => {
    await signIn(page, "member", "/settings");
    await page.getByRole("tab", { name: "Members" }).click();
    await expect(page.getByText(loadFixtures().users.admin.email)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send invite" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /^Role for/ })).toHaveCount(0);

    await page.getByRole("tab", { name: "Workspace" }).click();
    const save = page.getByRole("button", { name: /save/i });
    if (await save.count()) await expect(save.first()).toBeDisabled();
  });

  test("assigning a lead notifies the new owner", async ({ page, request }) => {
    const { member } = loadFixtures().users;
    const name = unique("E2E Assigned");
    await api(request, "admin", "post", "/leads", { name, ownerId: member.id });

    await signIn(page, "member", "/dashboard");
    await expect(page.getByRole("link", { name: /Notifications \(\d+ unread\)/ })).toBeVisible({ timeout: 20_000 });
    await page.goto("/notifications");
    await expect(page.getByText(name).first()).toBeVisible();
  });
});
