import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { parks as references } from "@ripota/parks";
import type { PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";
import type { LivePotaSpot } from "../src/lib/pota/spots";
import { startActivateRiServer } from "./helpers/activate-ri-server";

const eventNow = "2026-09-11T12:00:00Z";
type Feed = {
  checkedAt: string;
  spots: LivePotaSpot[];
  snapshot: PublicPotaParkStatusSnapshot;
  statusUnavailable: boolean;
  requests: { spots: number; statuses: number; stops: number };
};

const test = base.extend<{ feed: Feed }, { onAirOrigin: string }>({
  onAirOrigin: [async ({}, use) => {
    const server = await startActivateRiServer();
    try { await use(server.origin); } finally { await server.stop(); }
  }, { scope: "worker" }],
  feed: async ({ context }, use) => {
    const feed: Feed = {
      checkedAt: eventNow,
      spots: [spot(1, "W1AW", "14062"), spot(3, "K1RI", "7050")],
      snapshot: eventSnapshot(),
      statusUnavailable: false,
      requests: { spots: 0, statuses: 0, stops: 0 },
    };
    await context.route("**/api/pota/spots", route => {
      feed.requests.spots += 1;
      return route.fulfill({
        json: { ok: true, spots: feed.spots, generatedAt: feed.checkedAt, stale: false },
      });
    });
    await context.route("**/api/activate-ri-2026/public/park-status", route => {
      feed.requests.statuses += 1;
      return feed.statusUnavailable
        ? route.fulfill({ status: 503 })
        : route.fulfill({ json: { ok: true, ...feed.snapshot, generatedAt: feed.checkedAt } });
    });
    await context.route("**/api/activate-ri-2026/public/stops", route => {
      feed.requests.stops += 1;
      return route.fulfill({ json: { ok: true, stops: [] } });
    });
    await context.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
    await context.route("**/api/analytics/events", route => route.fulfill({ status: 202, json: { ok: true } }));
    await use(feed);
  },
});

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 1000 } });

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`the ${viewport.name} event view shares overview progress and keeps live spots easy to reach`, async ({ page, feed, onAirOrigin }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await openOnAir(page, feed, onAirOrigin, eventNow);
    const progress = page.locator("[data-on-air-event-progress]");
    const map = page.locator("#on-air-map");
    const listing = page.locator("[data-on-air-now]");
    await expectEventContext(page, 3);
    await expect(map.locator(".reference-map-marker")).toHaveCount(references.length);
    await expect(map.locator('.reference-map-marker[fill="#2d7a4b"]')).toHaveCount(3);
    await expect(map.locator(".reference-map-status-symbol--activated")).toHaveCount(3);
    await expectLiveMarkers(map, 2);
    await expect.poll(() => map.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const attribution = element.querySelector(".leaflet-control-attribution")?.getBoundingClientRect();
      return [...element.querySelectorAll(".reference-map-marker")].flatMap((marker, index) => {
        const point = marker.getBoundingClientRect();
        const clipped = point.left < bounds.left - 2 || point.top < bounds.top - 2 ||
          point.right > bounds.right + 2 || point.bottom > bounds.bottom + 2;
        const obscured = attribution && point.left < attribution.right && point.right > attribution.left &&
          point.top < attribution.bottom && point.bottom > attribution.top;
        return clipped || obscured ? [index] : [];
      });
    })).toEqual([]);
    await expect(page.locator("[data-map-legend-item]:visible")).toHaveText([
      "On air now", "✓Activated", "Scheduled", "Still needed",
    ]);
    await expect(page.locator("[data-on-air-list] tr")).toHaveCount(2);
    expect(feed.requests).toEqual({ spots: 1, statuses: 1, stops: 0 });

    const progressBounds = await progress.boundingBox();
    const listingBounds = await listing.boundingBox();
    expect(progressBounds).not.toBeNull();
    expect(listingBounds).not.toBeNull();
    expect(progressBounds!.y + progressBounds!.height).toBeLessThanOrEqual(listingBounds!.y);
    if (viewport.name === "mobile") {
      const mapBounds = await map.boundingBox();
      const firstSpotBounds = await page.locator("[data-on-air-list] tr").first().boundingBox();
      expect(mapBounds).not.toBeNull();
      expect(firstSpotBounds).not.toBeNull();
      expect(listingBounds!.y + listingBounds!.height).toBeLessThanOrEqual(mapBounds!.y);
      expect(firstSpotBounds!.y).toBeLessThan(viewport.height);
      expect(await listing.evaluate(element => {
        const map = document.querySelector("#on-air-map");
        return Boolean(map && element.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING);
      })).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const screenshot = testInfo.outputPath(`on-air-event-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    await testInfo.attach(`on-air-event-${viewport.name}`, { path: screenshot, contentType: "image/png" });
    expect(errors).toEqual([]);
  });
}

for (const phase of [
  { name: "before", date: "2026-09-09T12:00:00Z" },
  { name: "after", date: "2026-09-14T12:00:00Z" },
]) {
  test(`${phase.name} the event, only current on-air parks appear and empty refreshes clear the map`, async ({ page, feed, onAirOrigin }, testInfo) => {
    await openOnAir(page, feed, onAirOrigin, phase.date);
    const map = page.locator("#on-air-map");
    await expectLiveContext(page, 2);
    await expect(page.locator("[data-on-air-list] tr")).toHaveCount(2);
    await map.locator(".reference-map-marker").first().click();
    const popup = map.locator(".leaflet-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("W1AW");
    await expect(popup).toContainText("14062 kHz");
    await expect(popup).not.toContainText(/scheduled|still needed|needs coverage|activated|confirmation/i);
    await map.locator(".leaflet-popup-close-button").click();
    await page.getByRole("heading", { name: "Rhode Island on air", exact: true }).hover();
    expect(feed.requests).toEqual({ spots: 1, statuses: 0, stops: 0 });
    if (phase.name === "after") {
      const screenshot = testInfo.outputPath("on-air-after-event.png");
      await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
      await testInfo.attach("on-air-after-event", { path: screenshot, contentType: "image/png" });
    }

    feed.spots = [];
    await page.clock.runFor(30_000);
    await expectLiveContext(page, 0);
    await expect(page.locator("[data-on-air-empty]")).toBeVisible();
    await expect(page.locator("[data-map-live-status]")).toBeVisible();
    await expect(page.locator("[data-map-live-status]")).toContainText(/no parks|no.*on air/i);

    feed.spots = [spot(4, "N1POTA", "5357")];
    await page.clock.runFor(30_000);
    await expectLiveContext(page, 1);
    await expect(page.locator("[data-on-air-list] tr .on-air-now__activator")).toHaveText(["N1POTA"]);
    await expect(page.locator("[data-map-live-status]")).toBeHidden();
    expect(feed.requests).toEqual({ spots: 3, statuses: 0, stops: 0 });
  });
}

test("event progress recovers from unavailable evidence and shares polling with the map", async ({ page, feed, onAirOrigin }) => {
  feed.statusUnavailable = true;
  await openOnAir(page, feed, onAirOrigin, eventNow);
  const progress = page.locator("[data-on-air-event-progress]");
  const bar = progress.getByRole("progressbar", { name: "Parks activated" });
  const map = page.locator("#on-air-map");
  await expect(progress).toBeVisible();
  await expect(progress).toContainText(/unavailable/i);
  await expect(bar).not.toHaveAttribute("value");
  await expect(page.locator("[data-on-air-list] tr")).toHaveCount(2);
  await expectLiveMarkers(map, 2);
  await expect(map.locator('.reference-map-marker[fill="#9aa6a1"]')).toHaveCount(references.length);
  await expect(map.locator(".reference-map-status-symbol--needed")).toHaveCount(0);
  await expect(map.locator(".reference-map-status-symbol--unknown")).toHaveCount(references.length);
  await expect(page.locator("[data-map-live-status]")).toContainText("Event progress is unavailable");
  await map.locator(".reference-map-marker").first().click();
  await expect(map.locator(".leaflet-popup")).toContainText("Event progress unavailable");
  await expect(map.locator(".leaflet-popup")).not.toContainText(/still needed|no event POTA evidence yet/i);
  await map.locator(".leaflet-popup-close-button").click();
  await page.getByRole("heading", { name: "Rhode Island on air", exact: true }).hover();
  expect(feed.requests).toEqual({ spots: 1, statuses: 1, stops: 0 });

  feed.statusUnavailable = false;
  feed.snapshot.parks[3] = { ...feed.snapshot.parks[3], status: "observed", observed: true };
  feed.snapshot.summary.observedNotConfirmed = 3;
  feed.snapshot.summary.scheduledNotConfirmed -= 1;
  await page.clock.runFor(60_000);
  await expectEventContext(page, 4);
  await expect(page.locator('#on-air-map .reference-map-marker[fill="#2d7a4b"]')).toHaveCount(4);
  await expect(page.locator("[data-map-live-status]")).toBeHidden();
  expect(feed.requests.statuses).toBe(2);
  expect(feed.requests.stops).toBe(0);
  expect(feed.requests.spots).toBeGreaterThan(1);
  expect(feed.requests.spots).toBeLessThanOrEqual(3);
  const firstLiveRequests = feed.requests.spots;

  feed.statusUnavailable = true;
  await page.clock.runFor(60_000);
  await expectEventContext(page, 4);
  await expect(progress).toContainText(/last|refresh|unavailable|behind/i);
  expect(feed.requests.statuses).toBe(3);
  expect(feed.requests.stops).toBe(0);
  // Advancing the clock can leave a fetch in flight across two timer ticks.
  // The shared store should coalesce it, and must never add a poll per consumer.
  expect(feed.requests.spots).toBeGreaterThan(firstLiveRequests);
  expect(feed.requests.spots).toBeLessThanOrEqual(5);
  const liveRequests = feed.requests.spots;

  feed.statusUnavailable = false;
  feed.snapshot = eventSnapshot();
  await page.clock.runFor(60_000);
  await expectEventContext(page, 3);
  await expect(progress).not.toContainText(/unavailable|refresh failed/i);
  expect(feed.requests.statuses).toBe(4);
  expect(feed.requests.stops).toBe(0);
  expect(feed.requests.spots).toBeGreaterThan(liveRequests);
  expect(feed.requests.spots).toBeLessThanOrEqual(7);
});

test("an open page gains event progress and all park statuses at the UTC event start", async ({ page, feed, onAirOrigin }) => {
  const url = await openOnAir(page, feed, onAirOrigin, "2026-09-09T23:59:45Z", "?sort=frequency&direction=asc");
  await expectLiveContext(page, 2);
  expect(feed.requests.statuses).toBe(0);
  feed.checkedAt = "2026-09-10T00:00:15Z";
  await page.clock.runFor(30_000);
  await expectEventContext(page, 3);
  await expect(page.locator("#on-air-map .reference-map-marker")).toHaveCount(references.length);
  await expect(page.locator("[data-map-legend-item]:visible")).toHaveText([
    "On air now", "✓Activated", "Scheduled", "Still needed",
  ]);
  await expectSortPreserved(page, url, ["K1RI", "W1AW"]);
  expect(feed.requests.statuses).toBe(1);
  expect(feed.requests.stops).toBe(0);
});

test("an open page drops event context at the UTC cutoff and keeps sorted live updates", async ({ page, feed, onAirOrigin }) => {
  const url = await openOnAir(page, feed, onAirOrigin, "2026-09-13T23:59:45Z", "?sort=frequency&direction=asc");
  await expectEventContext(page, 3);
  await expectSortPreserved(page, url, ["K1RI", "W1AW"]);
  const eventRequests = feed.requests.statuses;
  feed.checkedAt = "2026-09-14T00:00:15Z";
  await page.clock.runFor(30_000);
  await expectLiveContext(page, 2);
  await expectSortPreserved(page, url, ["K1RI", "W1AW"]);

  feed.spots = [spot(1, "W1AW", "14062"), spot(4, "N1POTA", "5357")];
  await page.clock.runFor(60_000);
  await expectLiveContext(page, 2);
  await expectSortPreserved(page, url, ["N1POTA", "W1AW"]);
  expect(feed.requests.statuses).toBe(eventRequests);
  expect(feed.requests.stops).toBe(0);
});

async function openOnAir(page: Page, feed: Feed, origin: string, date: string, query = ""): Promise<string> {
  feed.checkedAt = date;
  await page.clock.install({ time: new Date(date) });
  const url = `${origin}/on-air/${query}`;
  await page.goto(url);
  await expect(page.locator("[data-on-air-list] tr")).toHaveCount(feed.spots.length);
  return url;
}

async function expectEventContext(page: Page, activated: number): Promise<void> {
  const progress = page.locator("[data-on-air-event-progress]");
  await expect(progress).toBeVisible();
  const bar = progress.getByRole("progressbar", { name: "Parks activated" });
  await expect(bar).toHaveAttribute("value", String(activated));
  await expect(bar).toHaveAttribute("max", String(references.length));
  await expect(progress).toContainText(new RegExp(`${activated}\\s*/\\s*${references.length}`));
  await expect(page.locator("#on-air-map")).toHaveAttribute("data-map-mode", "event");
}

async function expectLiveContext(page: Page, count: number): Promise<void> {
  const map = page.locator("#on-air-map");
  await expect(page.locator("[data-on-air-event-progress]")).toBeHidden();
  await expect(map).toHaveAttribute("data-map-mode", "live");
  await expect(map.locator(".reference-map-marker")).toHaveCount(count);
  await expectLiveMarkers(map, count);
  await expect(map.locator(".reference-map-status-symbol")).toHaveCount(0);
  await expect(page.locator("[data-map-legend-item]:visible")).toHaveText(count ? ["On air now"] : []);
}

async function expectLiveMarkers(map: Locator, count: number): Promise<void> {
  await expect(map.locator(".reference-map-marker--live")).toHaveCount(count);
  await expect(map.locator(".reference-map-live-indicator--active")).toHaveCount(count);
}

async function expectSortPreserved(page: Page, url: string, callsigns: string[]): Promise<void> {
  await expect(page).toHaveURL(url);
  await expect(page.locator("[data-on-air-sort-select]")).toHaveValue("frequency:asc");
  await expect(page.locator('[data-on-air-sort-column="frequency"]')).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator("[data-on-air-list] tr .on-air-now__activator")).toHaveText(callsigns);
}

function spot(index: number, callsign: string, frequency: string): LivePotaSpot {
  const park = references[index];
  return {
    id: `${park.reference}-${callsign}`, parkReference: park.reference, parkName: park.name,
    activatorCallsign: callsign, frequency, mode: "CW", spotTime: eventNow,
    spotterCallsign: "N1BS", comments: "", sourceLabel: "POTA", upstreamCount: 1,
    locationDesc: "US-RI", expiresInSeconds: 300, parkUrl: park.potaUrl, spotsUrl: "https://pota.app/",
  };
}

function eventSnapshot(): PublicPotaParkStatusSnapshot {
  return {
    generatedAt: eventNow, lastPotaSyncAt: eventNow, lastSpotIngestAt: eventNow,
    stale: false, warning: null,
    eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: {
      total: references.length, confirmed: 1, observedNotConfirmed: 2, scheduledNotConfirmed: 2,
      stillNeeded: references.length - 5, withoutConfirmation: references.length - 1,
    },
    parks: references.map((park, index) => ({
      reference: park.reference, name: park.name, potaUrl: park.potaUrl,
      status: index === 0 ? "confirmed" : index < 3 ? "observed" : index < 5 ? "scheduled" : "needed",
      live: index === 1 || index === 3, scheduled: index === 3 || index === 4,
      observed: index === 1, attemptRecorded: index === 2,
      confirmation: null, confirmations: [], attempts: [], lastObservation: null,
    })),
  };
}
