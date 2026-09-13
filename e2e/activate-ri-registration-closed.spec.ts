import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("the local Worker rejects direct new-plan requests at the registration deadline", async ({ request }) => {
  const server = await startActivateRiServer({ registrationNow: "2026-09-14T00:00:00.000Z" });
  try {
    const response = await request.post(`${server.origin}/api/activate-ri-2026/plans`, {
      headers: { origin: server.origin }, data: {},
    });
    expect(response.status()).toBe(410);
    expect(await response.json()).toEqual({
      ok: false,
      errors: ["Activate All RI 2026 has ended, and new activation plans are closed. Existing activators can still open My Plan and share photos."],
    });
  } finally { await server.stop(); }
});

test("2026 registration gives returning visitors recap and existing activator links after closing", async ({ page }) => {
  const server = await startActivateRiServer();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.clock.install({ time: new Date("2026-09-14T00:00:00Z") });
    await page.goto(`${server.origin}/activate-ri-2026/volunteer/`);
    await expect(page.getByRole("heading", { name: "2026 registration is closed" })).toBeVisible();
    await expect(page.locator("[data-volunteer-registration-open]")).toBeHidden();
    await expect(page.locator("[data-activate-ri-volunteer]")).toBeHidden();
    const closed = page.locator("[data-volunteer-closed]");
    await expect(closed).toBeVisible();
    await expect(closed.getByRole("link", { name: "Explore the event recap" })).toHaveAttribute("href", "/activate-ri-2026/");
    await expect(closed.getByRole("link", { name: "Share photos" })).toHaveAttribute("href", "/activate-ri-2026/activator/media/");
    await expect(closed.getByRole("link", { name: "Open My Plan" })).toHaveAttribute("href", "/activate-ri-2026/activator/plan/");
    await expect(closed).toContainText("manage their account");
    expect(errors).toEqual([]);
  } finally { await server.stop(); }
});

test("an open registration form closes at the existing UTC event boundary without a reload", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-13T23:58:00Z") });
    await page.goto(`${server.origin}/activate-ri-2026/volunteer/`);
    await page.clock.pauseAt(new Date("2026-09-13T23:59:59Z"));
    await expect(page.getByRole("heading", { name: "Volunteer to activate" })).toBeVisible();
    await expect(page.locator("[data-volunteer-registration-open]")).toBeVisible();
    await expect(page.locator("[data-volunteer-closed]")).toBeHidden();
    await page.locator('[name="submitterCallsign"]').fill("N1TEST");
    await page.clock.runFor(1000);
    await expect(page.getByRole("heading", { name: "2026 registration is closed" })).toBeVisible();
    await expect(page.locator("[data-volunteer-registration-open]")).toBeHidden();
    await expect(page.locator("[data-volunteer-closed]")).toBeVisible();
    await expect(page.locator("#volunteer-title")).toBeFocused();
  } finally { await server.stop(); }
});
