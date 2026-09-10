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

    test("directory filter changes restore controls and results through history and a fresh shared visit", async ({ page, context, parksOrigin }) => {
      const originalUrl = `${parksOrigin}/parks/?source=club&source=email#browse-parks-title`;
      await page.goto(originalUrl);
      const search = page.getByRole("searchbox", { name: "Search parks" });
      const county = page.getByRole("combobox", { name: "County", exact: true });
      const type = page.getByRole("combobox", { name: "Park type", exact: true });
      const amenity = page.getByRole("combobox", { name: "Amenity", exact: true });
      const related = page.getByRole("checkbox", { name: "Possible 2-fers" });
      const rows = page.locator("[data-park-row]:visible");
      await expect(rows).toHaveCount(61);

      await search.fill("Lin");
      await search.fill("Lincoln");
      await county.selectOption("Providence County");
      await type.selectOption("park");
      await amenity.selectOption("picnic-tables");
      await expect(rows).not.toHaveCount(0);
      const matchingReferences = await rows.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.reference));
      await related.check();
      const sharedUrl = page.url();
      const sharedReferences = await rows.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.reference));
      expect(Object.fromEntries(new URL(sharedUrl).searchParams)).toMatchObject({
        query: "Lincoln", county: "Providence County", type: "park", amenity: "picnic-tables", related: "1",
      });
      expect(new URL(sharedUrl).searchParams.getAll("source")).toEqual(["club", "email"]);
      expect(new URL(sharedUrl).hash).toBe("#browse-parks-title");

      await page.goBack();
      await expect(related).not.toBeChecked();
      await expect(rows).toHaveCount(matchingReferences.length);
      await page.goForward();
      await expect(related).toBeChecked();
      await expect(page).toHaveURL(sharedUrl);
      await page.reload();
      await expect(search).toHaveValue("Lincoln");
      await expect(related).toBeChecked();
      await expect(rows).toHaveCount(sharedReferences.length);

      const sharedPage = await context.newPage();
      try {
        await sharedPage.goto(sharedUrl);
        await expect(sharedPage.getByRole("searchbox", { name: "Search parks" })).toHaveValue("Lincoln");
        await expect(sharedPage.getByRole("combobox", { name: "County", exact: true })).toHaveValue("Providence County");
        await expect(sharedPage.getByRole("combobox", { name: "Park type", exact: true })).toHaveValue("park");
        await expect(sharedPage.getByRole("combobox", { name: "Amenity", exact: true })).toHaveValue("picnic-tables");
        await expect(sharedPage.getByRole("checkbox", { name: "Possible 2-fers" })).toBeChecked();
        await expect(sharedPage.locator("[data-park-row]:visible")).toHaveCount(sharedReferences.length);
      } finally {
        await sharedPage.close();
      }

      await search.press("Enter");
      await expect(page).toHaveURL(sharedUrl);
      await expect(related).toBeChecked();
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(page).toHaveURL(originalUrl);
      await expect(rows).toHaveCount(61);
      await page.goBack();
      await expect(page).toHaveURL(sharedUrl);
      await expect(related).toBeChecked();
      for (let index = 0; index < 4; index++) await page.goBack();
      await expect(search).toHaveValue("Lincoln");
      await expect(county).toHaveValue("all");
      await expect(type).toHaveValue("all");
      await expect(amenity).toHaveValue("all");
      await page.goBack();
      await expect(page).toHaveURL(originalUrl);
      await expect(search).toHaveValue("");
      await expect(rows).toHaveCount(61);
    });

    test("directory ignores unknown filter values without losing unrelated parameters", async ({ page, parksOrigin }) => {
      await page.goto(`${parksOrigin}/parks/?county=unknown&type=unknown&amenity=unknown&related=bogus&source=club#browse-parks-title`);
      await expect(page.locator("[data-park-row]:visible")).toHaveCount(61);
      for (const name of ["County", "Park type", "Amenity"]) {
        await expect(page.getByRole("combobox", { name, exact: true })).toHaveValue("all");
      }
      await expect(page.getByRole("checkbox", { name: "Possible 2-fers" })).not.toBeChecked();
      await expect(page).toHaveURL(`${parksOrigin}/parks/?source=club#browse-parks-title`);
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
