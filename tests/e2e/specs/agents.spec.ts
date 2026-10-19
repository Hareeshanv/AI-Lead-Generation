import { expect, signIn, test } from "../support/fixtures";

test.describe("AI agents", () => {
  test("a discovery run is gated on the Serper and Sarvam keys", async ({ page }) => {
    await signIn(page, "admin", "/agents");
    await expect(page.getByText(/Serper \(search\) and Sarvam \(AI scoring\) are not configured/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Add the API keys under Integrations" })).toHaveAttribute("href", "/integrations");
    await page.getByRole("textbox", { name: "What to search for" }).fill("dental clinic");
    await page.getByRole("textbox", { name: "Location" }).fill("Pune");
    const run = page.getByRole("button", { name: /run|start|discover/i }).filter({ hasNotText: /history/i }).last();
    await expect(run).toBeDisabled();
  });
});
