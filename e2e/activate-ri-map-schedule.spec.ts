import { expect, test } from "@playwright/test";
import { parks as references } from "@ripota/parks";
import type { PublicActivationStop } from "../src/lib/activate-ri/types";
import type { PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} map keeps an activated park's upcoming windows and links to its schedule and results`, async ({ page }, testInfo) => {
    const server = await startActivateRiServer();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const confirmation = { activeCallsign: "WA1VIN", qsoDate: "20260911", totalQsos: 13, qsosCw: 13, qsosPhone: 0, qsosData: 0 };
    const snapshot: PublicPotaParkStatusSnapshot = {
      generatedAt: "2026-09-11T17:00:00Z", lastPotaSyncAt: "2026-09-11T17:00:00Z", lastSpotIngestAt: null,
      stale: false, warning: null,
      eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
      summary: { total: references.length, confirmed: 1, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: references.length - 1, withoutConfirmation: references.length - 1 },
      parks: references.map(park => ({
        reference: park.reference, name: park.name, potaUrl: park.potaUrl,
        status: park.reference === "US-7865" ? "confirmed" : "needed",
        live: false, scheduled: park.reference === "US-7865", observed: false, attemptRecorded: false,
        confirmation: park.reference === "US-7865" ? confirmation : null,
        confirmations: park.reference === "US-7865" ? [confirmation] : [], attempts: [], lastObservation: null,
      })),
    };
    const base: PublicActivationStop = {
      id: "east-saturday", parkReference: "US-7865", plannedDate: "2026-09-12", startTime: "10:00", endTime: "13:00",
      activatorCallsign: "K1NW", bands: ["20m"], modes: ["CW"], publicNotes: "", status: "scheduled",
    };
    const stops: PublicActivationStop[] = [
      base,
      { ...base, id: "east-sunday", activatorCallsign: "N1BS", plannedDate: "2026-09-13", status: "delayed" },
      { ...base, id: "past", activatorCallsign: "W1PAST", plannedDate: "2026-09-11" },
      { ...base, id: "done", activatorCallsign: "W1DONE", activity: "confirmed" },
      { ...base, id: "cancelled", activatorCallsign: "W1CANCEL", status: "cancelled" },
      { ...base, id: "other-park", parkReference: "US-0513" },
    ];
    let releaseStops!: () => void;
    const stopsReady = new Promise<void>(resolve => { releaseStops = resolve; });
    let failStops = false;
    try {
      await page.setViewportSize(viewport);
      await page.clock.install({ time: new Date("2026-09-11T17:00:00Z") });
      await page.route("**/api/activate-ri-2026/public/park-status", route => route.fulfill({ json: { ok: true, ...snapshot } }));
      await page.route("**/api/activate-ri-2026/public/stops", async route => {
        await stopsReady;
        await route.fulfill(failStops ? { status: 503 } : { json: { ok: true, stops } });
      });
      await page.route("**/api/pota/spots", route => route.fulfill({ json: { ok: true, spots: [], generatedAt: snapshot.generatedAt, stale: false } }));
      await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
      await page.goto(`${server.origin}/activate-ri-2026/`);
      const map = page.locator('[data-event-view="results"] [data-reference-map]');
      // The only confirmed marker is East State Beach, independently of schedule status.
      const marker = map.locator('.reference-map-marker[fill="#2d7a4b"]');
      await marker.click();
      const popup = map.locator(".leaflet-popup-content");
      await expect(popup).toContainText("East State Beach");
      await expect(popup).toContainText("Activated");
      await expect(popup).toContainText("Loading planned activations");
      releaseStops();
      const upcoming = popup.locator("[data-map-upcoming-stops]");
      await expect(upcoming).toContainText("K1NW");
      await expect(upcoming).toContainText("Sep 12, 2026, 06:00-09:00 EDT");
      await expect(upcoming).toContainText("N1BS · Delayed");
      await expect(upcoming).not.toContainText(/W1PAST|W1DONE|W1CANCEL/);
      await expect(popup).toContainText("POTA log: WA1VIN");
      const schedule = popup.getByRole("link", { name: "View this park’s schedule" });
      const results = popup.getByRole("link", { name: "View activation results" });
      await expect(schedule).toHaveAttribute("href", "/activate-ri-2026/schedule/?q=US-7865");
      await expect(results).toHaveAttribute("href", "/activate-ri-2026/parks/?progress-q=US-7865#park-results");
      await expect(popup.locator(".map-popup__links a").first()).toHaveText("View this park’s schedule");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(map.locator(".leaflet-popup")).toHaveCSS("opacity", "1");
      await expect.poll(() => map.locator(".leaflet-popup").evaluate(element => {
        const bounds = element.closest("[data-reference-map]")!.getBoundingClientRect();
        const popup = element.getBoundingClientRect();
        return popup.left >= bounds.left && popup.right <= bounds.right;
      })).toBe(true);
      // Links must be visible without scrolling the popup's capped content area.
      expect(await schedule.evaluate(element => {
        const content = element.closest(".leaflet-popup-content")!;
        const link = element.getBoundingClientRect();
        const bounds = content.getBoundingClientRect();
        return link.top >= bounds.top && link.bottom <= bounds.bottom;
      })).toBe(true);
      await map.scrollIntoViewIfNeeded();
      const screenshotPath = testInfo.outputPath(`map-schedule-${viewport.name}.png`);
      await map.screenshot({ path: screenshotPath, animations: "disabled" });
      await testInfo.attach(`map-schedule-${viewport.name}`, { path: screenshotPath, contentType: "image/png" });

      await schedule.click();
      await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/schedule/?q=US-7865`);
      await expect(page.getByRole("searchbox", { name: "Search parks" })).toHaveValue("US-7865");
      await expect(page.getByRole("combobox", { name: "Event day (Rhode Island time)" })).toHaveValue("all");
      await expect(page.locator('[data-filter-row]:visible').filter({ hasText: "Sep 12, 2026" }).filter({ hasText: "K1NW" })).toHaveCount(1);
      await expect(page.locator('[data-filter-row]:visible').filter({ hasText: "Sep 13, 2026" })).toHaveCount(1);
      await expect(page.locator('[data-filter-row][data-park-reference="US-0513"]:visible')).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("searchbox", { name: "Search parks" })).toHaveValue("US-7865");

      await page.goBack();
      await marker.click();
      await results.click();
      await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("US-7865");
      expect(new URL(page.url()).searchParams.has("progress-q")).toBe(false);
      expect(new URL(page.url()).searchParams.get("expanded")).toBe("US-7865");
      expect(new URL(page.url()).hash).toBe("#park-results");
      const cards = page.locator("[data-live-coverage] [data-filter-row]");
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText("East State Beach");
      await expect(cards.locator(".park-plan-details")).toHaveJSProperty("open", true);
      await expect(cards.getByText(/K1NW/)).toBeVisible();

      failStops = true;
      await page.goto(`${server.origin}/activate-ri-2026/`);
      await marker.click();
      await expect(popup).toContainText("Planned activations are temporarily unavailable.");
      await expect(popup).not.toContainText("No upcoming activation");
      await expect(popup).toContainText("POTA log: WA1VIN");
      await expect(schedule).toBeVisible();
      await expect(map.locator('.reference-map-marker[fill="#2d7a4b"]')).toHaveCount(1);
      expect(errors).toEqual([]);
    } finally {
      releaseStops();
      await server.stop();
    }
  });
}
