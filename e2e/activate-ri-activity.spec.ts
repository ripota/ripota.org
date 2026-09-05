import { expect, test } from "@playwright/test";
import { references } from "@ripota/parks";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("legacy activity links redirect permanently to progress and preserve the selected view", async ({ page, request }) => {
  const server = await startActivateRiServer();
  try {
    for (const suffix of ["", "/"]) {
      const response = await request.get(`${server.origin}/activate-ri-2026/activity${suffix}?view=unspotted`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(301);
      const destination = new URL(response.headers().location, server.origin);
      expect(destination.pathname).toBe("/activate-ri-2026/progress/");
      expect(destination.search).toBe("?view=unspotted");
    }
    await page.clock.install({ time: new Date("2026-09-11T12:00:00Z") });
    await page.goto(`${server.origin}/activate-ri-2026/activity/?view=unspotted`);
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/progress/?view=unspotted`);
    await expect(page.getByRole("heading", { name: "Event progress", exact: true })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://ripota.org/activate-ri-2026/progress/");
    await expect(page.getByRole("radio", { name: /Not yet spotted/ })).toBeChecked();
    await expect(page.getByRole("link", { name: "Progress", exact: true })).toHaveAttribute("aria-current", "page");
  } finally {
    await server.stop();
  }
});

for (const path of ["/activate-ri-2026/", "/activate-ri-2026/parks/"]) {
  test(`a pre-event build transitions at runtime on ${path}`, async ({ page }) => {
    const server = await startActivateRiServer();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.clock.install({ time: new Date("2026-09-09T23:59:00Z") });
      await page.clock.pauseAt(new Date("2026-09-09T23:59:00Z"));
      await page.route("**/api/activate-ri-2026/public/park-status", async route => {
        const snapshot = {
          ok: true, generatedAt: "2026-09-10T00:00:00Z",
          lastPotaSyncAt: "2026-09-10T00:00:00Z", lastSpotIngestAt: null,
          stale: false, warning: null,
          eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
          summary: { total: 61, confirmed: 0, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 61, withoutConfirmation: 61 },
          parks: references.map(park => ({
            reference: park.reference, name: park.name, potaUrl: park.potaUrl,
            status: "needed", live: false, scheduled: false, observed: false,
            attemptRecorded: false, confirmation: null, confirmations: [], attempts: [], lastObservation: null,
          })),
        };
        await route.fulfill({ json: snapshot });
      });
      await page.goto(server.origin + path);
      const planning = page.locator('[data-event-view="planning"]');
      const results = page.locator('[data-event-view="results"]');
      await expect(planning).toBeVisible();
      await expect(results).toBeHidden();
      const progressLink = page.locator("[data-event-progress-link]");
      await expect(progressLink).toBeHidden();
      await page.clock.runFor(60_000);
      await expect(progressLink).toBeVisible();
      await expect(progressLink).toHaveText("Progress");
      await expect(progressLink).toHaveAttribute("href", "/activate-ri-2026/progress/");
      await expect(planning).toBeHidden();
      await expect(results).toBeVisible();
      await expect(page.locator("[data-event-phase-views]")).toHaveAttribute("data-phase", "event-live");
      await expect(results).toContainText("Confirmed by POTA");
      if (path.endsWith("/parks/")) {
        await expect(results.locator(".pota-park-card")).toHaveCount(61);
      } else {
        await expect(results.locator("[data-hero-pota-updated]")).toContainText("Sep 10");
      }
      await page.clock.setFixedTime(new Date("2026-09-14T00:00:00Z"));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.locator("[data-event-phase-views]")).toHaveAttribute("data-phase", "post-event");
      await expect(progressLink).toBeVisible();
      if (!path.endsWith("/parks/")) {
        await expect(results.getByRole("link", { name: "Check recognition" })).toBeVisible();
      }
      expect(errors).toEqual([]);
    } finally {
      await server.stop();
    }
  });
}

test("activity filters missing parks, keeps the view on refresh, and explains stale results", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    const response = await page.request.get(server.origin + "/api/activate-ri-2026/public/spot-activity");
    expect(response.ok()).toBe(true);
    const snapshot = await response.json();
    snapshot.scope = "event";
    const spotted = snapshot.unspottedParks.shift();
    Object.assign(spotted, {
      spotCount: 1, structuredSpotCount: 1, rbnSpotCount: 1,
      firstSpottedAt: "2026-09-11T12:00:00Z", lastSpottedAt: "2026-09-11T12:00:00Z",
      activators: ["W1AW"], modes: ["CW"], bands: ["20m"], coverage: { status: "spotted", stop: null },
    });
    snapshot.parks.push(spotted);
    Object.assign(snapshot.summary, { parks: 1, unspottedParks: 60, spots: 1 });
    const planned = snapshot.unspottedParks[0];
    planned.coverage = { status: "scheduled_later", stop: {
      parkReference: planned.reference, activatorCallsign: "N1BS", status: "scheduled",
      startAt: "2026-09-11T13:00:00Z", endAt: "2026-09-11T14:00:00Z",
    } };
    let fail = false;
    await page.route("**/api/activate-ri-2026/public/spot-activity", route =>
      fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: snapshot }));
    await page.clock.install();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(server.origin + "/activate-ri-2026/progress/?view=unspotted");
    const rows = page.locator("[data-pota-activity-rows] tr");
    await expect(rows).toHaveCount(60);
    await expect(page.getByRole("radio", { name: "Not yet spotted (60)", exact: true })).toBeChecked();
    await page.getByRole("searchbox", { name: "Search parks" }).fill(planned.reference);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Scheduled later");
    await expect(rows).toContainText("N1BS");
    await page.getByRole("searchbox", { name: "Search parks" }).fill("");
    await page.getByRole("radio", { name: "All parks (61)", exact: true }).check();
    await expect(rows).toHaveCount(61);
    await page.getByRole("radio", { name: "Spotted (1)", exact: true }).check();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("W1AW");
    await page.getByRole("radio", { name: "Not yet spotted (60)", exact: true }).check();
    await page.reload();
    await expect(rows).toHaveCount(60);
    snapshot.unspottedParks.shift();
    snapshot.parks.push({ ...planned, spotCount: 1, coverage: { status: "spotted", stop: null } });
    Object.assign(snapshot.summary, { parks: 2, unspottedParks: 59, spots: 2 });
    await page.clock.runFor(60_000);
    await expect(rows).toHaveCount(59);
    await expect(page.getByRole("radio", { name: "Not yet spotted (59)", exact: true })).toBeChecked();
    fail = true;
    await page.clock.runFor(60_000);
    await expect(page.locator("[data-pota-activity-status]")).toContainText("may be out of date");
    await expect(rows).toHaveCount(59);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await server.stop();
  }
});
