import { api, apiBody, expect, signIn, test, unique } from "../support/fixtures";

test.describe("workflows", () => {
  test("turning a workflow on makes new leads trigger it", async ({ page, request }) => {
    const name = unique("E2E Workflow");
    const tag = `e2e-${Date.now().toString(36)}`;
    const source = unique("E2E Source");
    const wf = await api(request, "admin", "post", "/workflows", {
      name,
      trigger: { type: "lead.created", source },
      actions: [{ type: "add_tag", params: { tag } }],
    });
    expect(wf.enabled).toBe(false);

    await signIn(page, "admin", "/workflows");
    const toggle = page.getByRole("switch", { name: `Turn on ${name}` });
    await toggle.click();
    await expect(page.getByRole("switch", { name: `Pause ${name}` })).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await api(request, "admin", "get", `/workflows/${wf.id}`)).enabled).toBe(true);

    const lead = await api(request, "admin", "post", "/leads", { name: unique("E2E WF Lead"), source });
    await expect.poll(async () => (await api(request, "admin", "get", `/leads/${lead.id}`)).tags, { timeout: 20_000 }).toContain(tag);
    const runs = await apiBody(request, "admin", "get", `/workflows/${wf.id}/runs`);
    expect(runs.data[0]).toMatchObject({ status: "succeeded", leadId: lead.id });

    await page.reload();
    await page.getByText(name).first().click();
    await expect(page.getByRole("button", { name: /^Succeeded lead\.created/ }).first()).toBeVisible();
  });

  test("members can see workflows but not change them", async ({ page, request }) => {
    const name = unique("E2E Locked Workflow");
    await api(request, "admin", "post", "/workflows", {
      name,
      trigger: { type: "lead.status_changed", to: "Hot" },
      actions: [{ type: "notify", params: { recipients: "owner", title: "Hot lead" } }],
    });
    await signIn(page, "member", "/workflows");
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "New workflow" })).toHaveCount(0);
    const toggle = page.getByRole("switch", { name: `Turn on ${name}` });
    if (await toggle.count()) await expect(toggle).toBeDisabled();
  });
});
