import { expect, test as base } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

const test = base.extend<{}, { parksOrigin: string }>({
  parksOrigin: [async ({}, use) => {
    if (process.env.RIPOTA_PARKS_BASE_URL) {
      await use(process.env.RIPOTA_PARKS_BASE_URL.replace(/\/$/, ""));
      return;
    }
    const server = await startActivateRiServer();
    try { await use(server.origin); } finally { await server.stop(); }
  }, { scope: "worker" }],
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime("2026-09-12T12:00:00-04:00");
  await page.route("**/api/analytics/events", (route) => route.fulfill({
    status: 202, contentType: "application/json", body: JSON.stringify({ ok: true }),
  }));
});

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport });

    test("park metadata filters survive a shared link and clear together", async ({ page, parksOrigin }, testInfo) => {
      await page.goto(`${parksOrigin}/parks/?type=park&amenity=picnic-tables&query=Lincoln`);
      const rows = page.locator("[data-park-row]:visible");
      await expect(page.getByRole("combobox", { name: "Park type", exact: true })).toHaveValue("park");
      await expect(page.getByRole("combobox", { name: "Amenity", exact: true })).toHaveValue("picnic-tables");
      await expect(rows).not.toHaveCount(0);
      for (const row of await rows.all()) {
        await expect(row).toHaveAttribute("data-type", "park");
        await expect(row).toHaveAttribute("data-amenities", /picnic-tables/);
        await expect(row).toContainText(/Lincoln/i);
      }
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(rows).toHaveCount(61);
      await expect(page.getByLabel("Search parks")).toHaveValue("");
      await expect(page).toHaveURL(`${parksOrigin}/parks/`);
      await page.getByLabel("Search parks").fill("all");
      await expect(page).toHaveURL(`${parksOrigin}/parks/?query=all`);
      await page.reload();
      await expect(page.getByLabel("Search parks")).toHaveValue("all");
      await page.getByLabel("Search parks").fill("this park does not exist");
      await expect(page.locator("[data-park-directory-empty]")).toBeVisible();
      await page.getByRole("button", { name: "Clear filters" }).click();
      await page.getByRole("heading", { name: "Browse all references" }).scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await testInfo.attach(`park-directory-${viewport.name}`, { body: await page.screenshot(), contentType: "image/png" });
    });

    test("park guides explain orange scope and useful visit information", async ({ page, parksOrigin }, testInfo) => {
      await page.goto(`${parksOrigin}/parks/us-2871/`);
      const visit = page.locator("#plan-your-visit");
      await expect(visit.getByRole("heading", { name: "Plan your visit" })).toBeVisible();
      await expect(visit.locator("[data-orange-status]")).toHaveAttribute("data-orange-status", "area-dependent");
      await expect(visit).toContainText(/North Camp/i);
      await expect(visit.getByRole("link", { name: "Park website" })).toHaveAttribute("href", /^https:\/\//);
      await visit.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await testInfo.attach(`park-visit-${viewport.name}`, { body: await page.screenshot(), contentType: "image/png" });
      await page.goto(`${parksOrigin}/parks/us-2878/`);
      await expect(page.locator("#plan-your-visit")).toContainText("Picnic tables");
      await expect(page.locator("#plan-your-visit [data-orange-status]")).toHaveAttribute("data-orange-status", "not-required");
      await expect(page.locator("[data-orange-guidance]")).toHaveAttribute("data-orange-prominent", "false");
      await expect(page.locator("[data-orange-guidance]")).not.toHaveAttribute("open");
    });

    test("summer keeps orange guidance available without prominent reminders", async ({ page, parksOrigin }, testInfo) => {
      await page.clock.setFixedTime("2026-06-15T12:00:00-04:00");
      await page.goto(`${parksOrigin}/parks/`);
      await expect(page.locator(".parks-directory__orange")).toBeHidden();
      await expect(page.locator('[data-variant="orange"]:visible')).toHaveCount(0);

      await page.goto(`${parksOrigin}/parks/us-6979/`);
      const guidance = page.locator("[data-orange-guidance]");
      await expect(guidance).toHaveAttribute("data-orange-prominent", "false");
      await expect(guidance).not.toHaveAttribute("open");
      await page.locator("#plan-your-visit").scrollIntoViewIfNeeded();
      await testInfo.attach(`orange-summer-${viewport.name}`, { body: await page.screenshot(), contentType: "image/png" });
      await guidance.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(guidance.getByRole("link", { name: "Orange guidance" })).toBeVisible();
      await expect(guidance).toContainText("200 square inches");
      await expect(guidance).toHaveAttribute("data-orange-prominent", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test("orange reminders follow the current season without resetting manual toggles", async ({ page, parksOrigin }, testInfo) => {
      await page.clock.setFixedTime("2026-05-31T23:59:59-04:00");
      await page.goto(`${parksOrigin}/parks/us-6979/`);
      const guidance = page.locator("[data-orange-guidance]");
      await expect(guidance).toHaveAttribute("data-orange-prominent", "true");
      await expect(guidance).toHaveAttribute("open");

      await page.clock.setFixedTime("2026-06-01T00:00:00-04:00");
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(guidance).toHaveAttribute("data-orange-prominent", "false");
      await expect(guidance).not.toHaveAttribute("open");
      await guidance.locator("summary").click();
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(guidance).toHaveAttribute("open");

      await page.clock.setFixedTime("2026-08-15T00:00:00-04:00");
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(guidance).toHaveAttribute("data-orange-prominent", "true");
      await page.locator("#plan-your-visit").scrollIntoViewIfNeeded();
      await testInfo.attach(`orange-season-${viewport.name}`, { body: await page.screenshot(), contentType: "image/png" });
      await guidance.locator("summary").click();
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(guidance).not.toHaveAttribute("open");

      await page.goto(`${parksOrigin}/parks/`);
      await expect(page.locator(".parks-directory__orange")).toBeVisible();
      await expect(page.locator('[data-variant="orange"]:visible')).not.toHaveCount(0);
    });
  });
}

test("orange guidance remains expandable without JavaScript", async ({ browser, parksOrigin }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${parksOrigin}/parks/us-6979/`);
    const guidance = page.locator("[data-orange-guidance]");
    await expect(guidance).not.toHaveAttribute("open");
    await guidance.locator("summary").click();
    await expect(guidance.getByRole("link", { name: "Orange guidance" })).toBeVisible();
  } finally {
    await context.close();
  }
});
