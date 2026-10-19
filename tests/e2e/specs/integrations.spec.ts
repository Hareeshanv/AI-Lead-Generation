import { api, expect, signIn, test } from "../support/fixtures";

test.describe("integrations", () => {
  test("admin saves credentials, sees the live check result, and disconnects", async ({ page, request }) => {
    await signIn(page, "admin", "/integrations");
    const card = page
      .getByRole("heading", { name: "Outbound webhook", level: 3 })
      .locator("xpath=ancestor::div[.//button][1]");
    await card.getByRole("button", { name: "Configure" }).click();

    const dialog = page.getByRole("dialog", { name: "Configure Outbound webhook" });
    // Internal addresses are refused before anything is saved (SSRF guard).
    await dialog.getByLabel(/Endpoint URL/).fill("https://127.0.0.1:9/e2e-hook");
    await dialog.getByRole("button", { name: "Save & test" }).click();
    await expect(dialog.getByText(/private, loopback, link-local or other internal address/)).toBeVisible();

    // A public IP on a closed port (no DNS, no payload delivered): saved, but the live check fails.
    await dialog.getByLabel(/Endpoint URL/).fill("https://1.1.1.1:9/e2e-hook");
    await dialog.getByRole("button", { name: "Save & test" }).click();
    await expect(dialog.getByText(/Saved, but the live check failed/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(card.getByText("Saved for this workspace")).toBeVisible();
    const integrations = await api(request, "admin", "get", "/integrations");
    expect(JSON.stringify(integrations)).not.toContain("1.1.1.1:9/e2e-hook");

    page.once("dialog", (d) => void d.accept());
    await card.getByRole("button", { name: "Disconnect Outbound webhook" }).click();
    await expect(card.getByRole("button", { name: "Configure" })).toBeVisible();
  });

  test("members cannot configure or test providers", async ({ page }) => {
    await signIn(page, "member", "/integrations");
    await expect(page.getByRole("heading", { name: "Resend", level: 3 })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Configure|Edit)$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Test", exact: true })).toHaveCount(0);
  });
});
