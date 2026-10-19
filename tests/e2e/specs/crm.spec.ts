import { api, expect, signIn, test, unique } from "../support/fixtures";

test.describe("CRM pipeline", () => {
  test("dragging a deal to Qualified moves it and syncs the lead status", async ({ page, request }) => {
    const leadName = unique("E2E Pipeline Lead");
    const lead = await api(request, "admin", "post", "/leads", { name: leadName, status: "Contacted" });
    const title = unique("E2E Deal");
    const deal = await api(request, "admin", "post", "/deals", { title, leadId: lead.id, value: 25000 });
    expect(deal.stage).toBe("New");

    await signIn(page, "member", "/crm");
    const fromColumn = page.getByRole("region", { name: "New stage" });
    const toColumn = page.getByRole("region", { name: "Qualified stage" });
    const handle = fromColumn.getByRole("button", { name: `Drag ${title}` });
    await handle.scrollIntoViewIfNeeded();
    await expect(handle).toBeVisible();

    const from = (await handle.boundingBox())!;
    const to = (await toColumn.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, from.y + from.height / 2, { steps: 20 });
    await page.mouse.up();

    await expect(toColumn.getByRole("button", { name: `Drag ${title}` })).toBeVisible();
    await expect.poll(async () => (await api(request, "admin", "get", `/deals/${deal.id}`)).stage).toBe("Qualified");
    await expect.poll(async () => (await api(request, "admin", "get", `/leads/${lead.id}`)).status).toBe("Qualified");

    const activities = await api(request, "admin", "get", `/deals/${deal.id}/activities`);
    expect(activities.some((a: { type: string }) => a.type === "stage_change")).toBe(true);

    // The move survives a reload.
    await page.reload();
    await expect(page.getByRole("region", { name: "Qualified stage" }).getByRole("button", { name: `Drag ${title}` })).toBeVisible();
  });

  test("a deal can be added from the board", async ({ page, request }) => {
    const title = unique("E2E Board Deal");
    await signIn(page, "admin", "/crm");
    await page.getByRole("button", { name: "Add deal" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add deal" });
    await dialog.getByLabel("Deal title").fill(title);
    await dialog.getByRole("button", { name: "Create deal" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Drag ${title}` })).toBeAttached();
    const deals = await api(request, "admin", "get", `/deals?q=${encodeURIComponent(title)}`);
    expect(deals).toHaveLength(1);
  });
});
