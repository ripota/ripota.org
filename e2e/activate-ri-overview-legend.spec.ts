import { expect, test } from "@playwright/test";
import { parks as references } from "@ripota/parks";
import type { PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";
import type { LivePotaSpot } from "../src/lib/pota/spots";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`the ${viewport.name} overview combines activity and shows only current map categories`, async ({ page }, testInfo) => {
    const server = await startActivateRiServer();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let releaseResponse!: () => void;
    const responseReady = new Promise<void>(resolve => { releaseResponse = resolve; });
    let fail = false;
    let liveSpots: LivePotaSpot[] = [{
      id: "overview-live-spot", parkReference: references[1].reference, parkName: references[1].name,
      activatorCallsign: "W1AW", frequency: "14062", mode: "CW", spotTime: "2026-09-10T12:00:00Z",
      spotterCallsign: "N1BS", comments: "", sourceLabel: "POTA", upstreamCount: 1,
      locationDesc: "US-RI", expiresInSeconds: 300,
      parkUrl: references[1].potaUrl, spotsUrl: "https://pota.app/",
    }];
    let snapshot: PublicPotaParkStatusSnapshot = {
      generatedAt: "2026-09-10T12:00:00Z", lastPotaSyncAt: "2026-09-10T12:00:00Z", lastSpotIngestAt: null,
      stale: false, warning: null,
      eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
      summary: { total: references.length, confirmed: 1, observedNotConfirmed: 2, scheduledNotConfirmed: references.length - 3, stillNeeded: 0, withoutConfirmation: references.length - 1 },
      parks: references.map((park, index) => ({
        reference: park.reference, name: park.name, potaUrl: park.potaUrl,
        status: index === 0 ? "confirmed" : index < 3 ? "observed" : "scheduled",
        live: index === 1, scheduled: index >= 3, observed: index === 1,
        attemptRecorded: index === 2,
        confirmation: null, confirmations: [], attempts: [], lastObservation: null,
      })),
    };

    try {
      await page.setViewportSize(viewport);
      await page.clock.install({ time: new Date("2026-09-10T12:00:00Z") });
      await page.route("**/api/activate-ri-2026/public/park-status", async route => {
        await responseReady;
        await (fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: { ok: true, ...snapshot } }));
      });
      await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [] } }));
      await page.route("**/api/pota/spots", route => route.fulfill({ json: {
        ok: true, spots: liveSpots, generatedAt: "2026-09-10T12:00:00Z", stale: false,
      } }));
      await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
      await page.goto(`${server.origin}/activate-ri-2026/`, { waitUntil: "domcontentloaded" });

      const results = page.locator('[data-event-view="results"]');
      const legend = results.locator(".map-legend");
      const visibleLegendItems = legend.locator("[data-map-legend-item]:visible");
      const progress = results.locator("[data-hero-pota-progress]");
      const map = results.locator("[data-reference-map]");
      await expect(results).toBeVisible();
      await expect(results.locator("[data-hero-scheduled]")).toHaveText("Loading...");
      await expect(legend).toBeHidden();
      await expect(visibleLegendItems).toHaveCount(0);

      releaseResponse();
      await expect(results.locator("[data-hero-primary-label]")).toHaveText("Activated");
      await expect(results.locator("[data-hero-scheduled]")).toHaveText(`3 / ${references.length}`);
      await expect(results.locator("[data-hero-secondary-label]")).toHaveText("On air now");
      await expect(results.locator("[data-hero-gaps]")).toHaveText("1");
      await expect(results.locator("[data-hero-without-confirmation]")).toHaveCount(0);
      await expect(progress).toHaveAttribute("value", "3");
      await expect(progress).toHaveAttribute("max", String(references.length));
      await expect(progress).toHaveAccessibleName("Parks activated");
      await expect(visibleLegendItems).toHaveText(["On air now", "Activated", "Scheduled"]);
      await expect(legend.locator('[data-map-legend-statuses="needed"]')).toBeHidden();
      await expect(map.locator('.reference-map-marker[fill="#2d7a4b"]')).toHaveCount(3);
      await expect(map.locator(".reference-map-status-symbol--activated")).toHaveText(["✓", "✓", "✓"]);
      await expect(map.locator(".reference-map-marker--live")).toHaveCount(1);
      await expect(map).not.toHaveAttribute("title");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const screenshotPath = testInfo.outputPath(`overview-${viewport.name}.png`);
      await results.screenshot({ path: screenshotPath, animations: "disabled" });
      await testInfo.attach(`overview-${viewport.name}`, { path: screenshotPath, contentType: "image/png" });

      if (viewport.name === "desktop") {
        await map.locator(".reference-map-marker:not(.reference-map-marker--live)").nth(6).hover({ force: true });
        await expect(map.locator(".leaflet-tooltip:visible")).toHaveCount(0);
        await map.locator(".reference-map-marker--live").hover();
        const tooltip = map.locator(".leaflet-tooltip:visible");
        await expect(tooltip).toContainText(`On air now · ${references[1].reference}`);
        await expect(tooltip).toContainText("W1AW · 14062 kHz · CW");
        await expect(tooltip).not.toContainText(/disclaimer|authoritative|official boundaries|navigation/i);
        const tooltipBounds = await tooltip.boundingBox();
        expect(tooltipBounds?.height).toBeLessThan(70);
        expect(tooltipBounds?.width).toBeGreaterThan(140);
        expect(tooltipBounds?.width).toBeLessThan(300);
        const tooltipScreenshotPath = testInfo.outputPath("overview-live-tooltip.png");
        await results.screenshot({ path: tooltipScreenshotPath, animations: "disabled" });
        await testInfo.attach("overview-live-tooltip", { path: tooltipScreenshotPath, contentType: "image/png" });
        await map.locator(".reference-map-marker--live").click();
        await expect(map.locator(".leaflet-popup")).toBeVisible();
        await expect(tooltip).toHaveCount(0);
        await map.locator(".leaflet-popup-close-button").click();
        await map.locator(".reference-map-marker--live").hover();
        await expect(tooltip).toBeVisible();
      }

      liveSpots = [];
      snapshot.parks = snapshot.parks.map(park => ({
        ...park, status: "needed", live: false, scheduled: false, observed: false, attemptRecorded: false,
      }));
      snapshot.summary = {
        total: references.length, confirmed: 0, observedNotConfirmed: 0,
        scheduledNotConfirmed: 0, stillNeeded: references.length, withoutConfirmation: references.length,
      };
      await page.clock.runFor(60_000);
      await expect(visibleLegendItems).toHaveText(["Still needed"]);
      await expect(results.locator("[data-hero-scheduled]")).toHaveText(`0 / ${references.length}`);
      await expect(results.locator("[data-hero-gaps]")).toHaveText("0");
      await expect(progress).toHaveAttribute("value", "0");
      await expect(map.locator(".reference-map-status-symbol--activated")).toHaveCount(0);
      await expect(map.locator(".reference-map-marker--live")).toHaveCount(0);
      await expect(map.locator(".leaflet-tooltip:visible")).toHaveCount(0);

      snapshot = {
        ...snapshot, parks: [],
        summary: { total: 0, confirmed: 0, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 0, withoutConfirmation: 0 },
      };
      await page.clock.runFor(60_000);
      await expect(legend).toBeHidden();
      await expect(visibleLegendItems).toHaveCount(0);

      fail = true;
      await page.reload();
      await expect(results.locator("[data-hero-scheduled]")).toHaveText("Unavailable");
      await expect(results.locator("[data-hero-gaps]")).toHaveText("Unavailable");
      await expect(results.locator("[data-hero-pota-updated]")).toContainText("temporarily unavailable");
      await expect(progress).not.toHaveAttribute("value");
      await expect(legend).toBeHidden();
      await expect(visibleLegendItems).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      releaseResponse();
      await server.stop();
    }
  });
}
