import { expect, test, type Page } from "@playwright/test";
import parks from "../public/data/activate-ri-2026/parks.json" with { type: "json" };
import { eventReplayPath, eventReplayWindow, type EventReplay } from "../src/lib/activate-ri/event-replay";
import type { PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 1100 } });

let server: ActivateRiServer;
test.beforeAll(async () => { server = await startActivateRiServer(); });
test.afterAll(async () => { await server?.stop(); });

const now = "2026-09-14T12:00:00.000Z";
const replay: EventReplay = {
  ok: true, eventId: "activate-ri-2026", generatedAt: now,
  window: eventReplayWindow, source: "pota-spot-archive", totalParks: parks.length, truncated: false,
  events: [
    { at: "2026-09-10T01:00:00.000Z", parkReference: parks[0].reference, activatorCallsign: "W1AW", frequency: "14062", mode: "CW" },
    { at: "2026-09-11T12:00:00.000Z", parkReference: parks[1].reference, activatorCallsign: "N1RI", frequency: "14250", mode: "SSB" },
    { at: "2026-09-12T00:00:00.000Z", parkReference: parks[0].reference, activatorCallsign: "K1RI", frequency: "7035", mode: "CW" },
    { at: "2026-09-13T23:00:00.000Z", parkReference: parks[2].reference, activatorCallsign: "N1BS", frequency: "7074", mode: "FT8" },
  ],
};

const snapshot: PublicPotaParkStatusSnapshot = {
  generatedAt: now, lastPotaSyncAt: now, lastSpotIngestAt: now, stale: false, warning: null,
  eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
  summary: { total: parks.length, confirmed: 4, observedNotConfirmed: 2, scheduledNotConfirmed: 0, stillNeeded: parks.length - 6, withoutConfirmation: parks.length - 4 },
  parks: parks.map((park, index) => ({
    reference: park.reference, name: park.name, potaUrl: park.potaUrl,
    status: index < 4 ? "confirmed" : index < 6 ? "observed" : "needed",
    live: index === 0, scheduled: false, observed: index >= 4 && index < 6,
    attemptRecorded: false,
    confirmation: index < 4 ? { qsoDate: "20260912", activeCallsign: "W1AW", totalQsos: 20, qsosCw: 10, qsosPhone: 10, qsosData: 0 } : null,
    confirmations: index < 4 ? [{ qsoDate: "20260912", activeCallsign: "W1AW", totalQsos: 20, qsosCw: 10, qsosPhone: 10, qsosData: 0 }] : [], attempts: [],
    lastObservation: index >= 4 && index < 6 ? {
      spotDate: "2026-09-12", activeCallsign: "N1BS", lastObservedAt: "2026-09-12T12:00:00Z", frequency: "14062", mode: "CW",
      sourceLabel: "POTA", spotterCallsign: "W1AW", evidenceKind: "structured_spot", declaredByReference: null,
    } : null,
  })),
};

async function setup(page: Page, options: { time?: string; data?: EventReplay; fail?: () => boolean } = {}) {
  const time = options.time ?? now;
  const errors: string[] = [];
  let requests = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: new Date(time) });
  await page.clock.pauseAt(new Date(time));
  await page.route(`**${eventReplayPath}`, route => {
    requests++;
    return options.fail?.() ? route.fulfill({ status: 503 }) : route.fulfill({ json: options.data ?? replay });
  });
  await page.route("**/api/activate-ri-2026/public/park-status", route => route.fulfill({ json: { ok: true, ...snapshot } }));
  await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [] } }));
  await page.route("**/api/pota/spots", route => route.fulfill({ json: { ok: true, spots: [], generatedAt: time, stale: false } }));
  await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
  await page.route("**/api/activate-ri-2026/public/media**", route => route.fulfill({ json: { ok: true, media: [], nextCursor: null } }));
  await page.goto(`${server.origin}/activate-ri-2026/`, { waitUntil: "domcontentloaded" });
  return { errors, requests: () => requests };
}

const player = (page: Page) => page.locator("[data-event-replay]");
const results = (page: Page) => page.locator('[data-event-view="results"]');
const recap = (page: Page) => page.locator("[data-event-recap]");

test("the recap hero autoplays once, retains final totals, and finishes at the honest reported park count", async ({ page }) => {
  const state = await setup(page);
  const root = player(page);
  await expect(root).toBeVisible();
  await expect(root).toHaveAttribute("data-state", "playing");
  await expect(root.locator(".event-replay__marker")).toHaveCount(parks.length);
  const trailLongitude = await root.locator("[data-replay-parks]").evaluate(element => {
    const data = JSON.parse(element.textContent!);
    return data.items.find((park: { reference: string }) => park.reference === "US-4582").longitude;
  });
  expect(trailLongitude).toBeGreaterThan(-72);
  expect(trailLongitude).toBeLessThan(-71);
  await expect(results(page)).toBeHidden();
  await expect(recap(page).getByRole("heading", { level: 1 })).toHaveText("We did it!! Thank you!!");
  await expect(recap(page).locator("[data-recap-coverage]")).toContainText(`Activity recorded at 6 of ${parks.length} parks.`);
  await expect(recap(page).locator('[data-recap-stat="parks"]')).toHaveText(`4 / ${parks.length}`);
  await expect(recap(page).locator('[data-recap-stat="activations"]')).toHaveText("4");
  await expect(recap(page).locator('[data-recap-stat="callsigns"]')).toHaveText("1");
  await expect(recap(page).locator('[data-recap-stat="qsos"]')).toHaveText("80");
  await expect(root.locator("[data-replay-count]")).toHaveText("0");
  await expect(root.locator('[data-heard="true"]')).toHaveCount(0);
  await expect(root.getByRole("button", { name: "Pause replay" })).toBeVisible();

  await page.clock.runFor(2000);
  await expect(root.locator("[data-replay-count]")).toHaveText("1");
  await expect(root.locator('[data-heard="true"]')).toHaveCount(1);
  await expect(root.locator('[data-pulse="first"]')).toHaveCount(1);
  await expect(root.locator("[data-replay-announcement]")).toBeEmpty();

  await page.clock.runFor(71_000);
  await expect(root).toHaveAttribute("data-state", "complete");
  await expect(root.locator("[data-replay-clock]")).toHaveAttribute("datetime", "2026-09-13T23:59:59.999Z");
  await expect(root.locator("[data-replay-count]")).toHaveText("3");
  await expect(root.locator('[data-heard="true"]')).toHaveCount(3);
  await expect(root.getByRole("button", { name: "Replay weekend" })).toBeVisible();
  await expect(root.getByRole("button", { name: "See final map" })).toBeDisabled();
  await expect(root.locator("[data-replay-count-label]")).toHaveText("Parks heard");
  await expect(root.locator("[data-replay-announcement]")).toContainText("Replay complete");
  await page.clock.runFor(10_000);
  await expect(root).toHaveAttribute("data-state", "complete");
  await expect(recap(page).locator("[data-recap-coverage]")).toContainText(`Activity recorded at 6 of ${parks.length} parks.`);
  await expect(recap(page).locator('[data-recap-stat="parks"]')).toHaveText(`4 / ${parks.length}`);
  await expect(recap(page).locator('[data-recap-stat="activations"]')).toHaveText("4");
  await expect(recap(page).locator('[data-recap-stat="callsigns"]')).toHaveText("1");
  await expect(recap(page).locator('[data-recap-stat="qsos"]')).toHaveText("80");
  expect(state.requests()).toBe(1);
  expect(state.errors).toEqual([]);
});

test("pause, keyboard scrubbing, final map, and explicit replay give visitors control", async ({ page }) => {
  await setup(page);
  const root = player(page);
  await expect(root).toHaveAttribute("data-state", "playing");
  await page.clock.runFor(2000);
  await root.getByRole("button", { name: "Pause map replay", exact: true }).click();
  await expect(root).toHaveAttribute("data-state", "paused");
  const headerPausedAt = await root.locator("[data-replay-clock]").getAttribute("datetime");
  await page.clock.runFor(1000);
  await expect(root.locator("[data-replay-clock]")).toHaveAttribute("datetime", headerPausedAt!);
  await root.getByRole("button", { name: "Play map replay", exact: true }).click();
  await expect(root).toHaveAttribute("data-state", "playing");
  await root.getByRole("button", { name: "Pause replay" }).click();
  const stoppedAt = await root.locator("[data-replay-clock]").getAttribute("datetime");
  await page.clock.runFor(5000);
  await expect(root.locator("[data-replay-clock]")).toHaveAttribute("datetime", stoppedAt!);
  const slider = root.getByRole("slider", { name: "Event replay time" });
  const skip = root.getByRole("link", { name: "Skip to replay controls" });
  await skip.focus();
  await expect(skip).toBeInViewport();
  await skip.press("Enter");
  await expect(slider).toBeFocused();
  await slider.press("End");
  await expect(root).toHaveAttribute("data-state", "complete");
  await expect(slider).toHaveValue("1000");
  await expect(slider).toHaveAttribute("aria-valuetext", /Sep 13.*23:59 UTC, 3 parks heard/);
  await slider.press("Home");
  await expect(root).toHaveAttribute("data-state", "paused");
  await expect(slider).toHaveValue("0");
  await expect(root.locator("[data-replay-count]")).toHaveText("0");
  await expect(root.locator("[data-pulse]")).toHaveCount(0);
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1");
  await root.getByRole("button", { name: "See final map" }).click();
  await expect(root.locator("[data-replay-count]")).toHaveText("3");
  await root.getByRole("button", { name: "Replay weekend" }).click();
  await expect(root).toHaveAttribute("data-state", "playing");
  await expect(root.locator("[data-replay-count]")).toHaveText("0");
});

test("reduced motion starts on the final map and allows an explicit replay without pulses", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  const root = player(page);
  await expect(root).toHaveAttribute("data-state", "complete");
  await expect(root.locator("[data-replay-count]")).toHaveText("3");
  await page.clock.runFor(5000);
  await expect(root).toHaveAttribute("data-state", "complete");
  await root.getByRole("button", { name: "Replay weekend" }).click();
  await expect(root).toHaveAttribute("data-state", "playing");
  await page.clock.runFor(2000);
  await expect(root.locator("[data-replay-count]")).toHaveText("1");
  await expect(root.locator("[data-pulse]")).toHaveCount(0);
});

test("enabling reduced motion during autoplay settles on the final map", async ({ page }) => {
  await setup(page);
  const root = player(page);
  await expect(root).toHaveAttribute("data-state", "playing");
  await page.clock.runFor(2000);
  // Media-query change events are delivered by the browser's rendering loop.
  // Keep that loop running while simulating an OS preference change.
  await page.clock.resume();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(root).toHaveAttribute("data-state", "complete");
  await expect(root.locator("[data-replay-count]")).toHaveText("3");
  await expect(root.locator("[data-pulse]")).toHaveCount(0);
});

test("park details are keyboard accessible, pause playback, and describe the selected point in time", async ({ page }) => {
  await setup(page);
  const root = player(page);
  await expect(root).toHaveAttribute("data-state", "playing");
  await page.clock.runFor(2000);
  const marker = root.getByRole("button", { name: `${parks[0].name} · ${parks[0].reference} · Reported on air`, exact: true });
  await marker.focus();
  await marker.press("Enter");
  await expect(root).toHaveAttribute("data-state", "paused");
  const popup = root.locator(".leaflet-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("W1AW · 14062 kHz · CW");
  await expect(popup).toContainText("Sep 10, 01:00 UTC");
  await expect(popup.getByRole("link", { name: "Explore this park" })).toHaveAttribute("href", /^\/parks\//);
  const time = await root.locator("[data-replay-clock]").getAttribute("datetime");
  await page.clock.runFor(3000);
  await expect(root.locator("[data-replay-clock]")).toHaveAttribute("datetime", time!);
  await root.getByRole("button", { name: "See final map" }).click();
  await page.clock.runFor(300);
  await expect(popup).toHaveCount(0);
  await marker.focus();
  await marker.press("Enter");
  await expect(root.locator(".leaflet-popup")).toContainText("K1RI · 7035 kHz · CW");
});

test("scrolling out of view pauses time and preserves a visitor's explicit pause", async ({ page }) => {
  await setup(page);
  const root = player(page);
  await expect(root).toHaveAttribute("data-state", "playing");
  await page.clock.runFor(2000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(root).toHaveAttribute("data-state", "paused");
  const at = await root.locator("[data-replay-clock]").getAttribute("datetime");
  await page.clock.runFor(5000);
  await expect(root.locator("[data-replay-clock]")).toHaveAttribute("datetime", at!);
  await root.locator("[data-replay-map]").scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute("data-state", "playing");
  await root.getByRole("button", { name: "Pause replay" }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await root.locator("[data-replay-map]").scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute("data-state", "paused");
  await page.clock.runFor(5000);
  await expect(root.locator("[data-replay-clock]")).toHaveAttribute("datetime", at!);
});

test("visibility changes freeze the replay and do not override explicit pause", async ({ page }) => {
  await setup(page);
  const root = player(page);
  await expect(root).toHaveAttribute("data-state", "playing");
  await page.clock.runFor(2000);
  // Drive the browser visibility event explicitly: headless tabs remain visible.
  const setHidden = async (hidden: boolean) => page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await setHidden(true);
  await expect(root).toHaveAttribute("data-state", "paused");
  const at = await root.locator("[data-replay-clock]").getAttribute("datetime");
  await page.clock.runFor(5000);
  await setHidden(false);
  await expect(root).toHaveAttribute("data-state", "playing");
  await expect(root.locator("[data-replay-clock]")).toHaveAttribute("datetime", at!);
  await root.getByRole("button", { name: "Pause replay" }).click();
  await setHidden(true);
  await page.clock.runFor(5000);
  await setHidden(false);
  await expect(root).toHaveAttribute("data-state", "paused");
  await expect(root.locator("[data-replay-clock]")).toHaveAttribute("datetime", at!);
});

for (const width of [390, 320]) {
  test(`the replay is usable at ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    const root = player(page);
    await root.locator("[data-replay-map]").scrollIntoViewIfNeeded();
    await expect(root).toHaveAttribute("data-state", "playing");
    await root.getByRole("button", { name: "See final map" }).click();
    await expect(root.locator("[data-replay-count]")).toHaveText("3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const control of await root.locator("button:visible").all()) {
      const bounds = await control.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    const slider = root.getByRole("slider", { name: "Event replay time" });
    await slider.press("Home");
    await expect(root.locator("[data-replay-count]")).toHaveText("0");
  });
}

test("empty archives remain understandable and leave recap results available", async ({ page }) => {
  await setup(page, { data: { ...replay, events: [] } });
  const root = player(page);
  await expect(root).toHaveAttribute("data-state", "empty");
  await expect(root.locator("[data-replay-detail]")).toContainText("no archived spot reports");
  await expect(root.locator("[data-replay-count]")).toHaveText("0");
  await expect(root.getByRole("slider")).toBeDisabled();
  await expect(root.locator("[data-replay-play]")).toBeDisabled();
  await expect(recap(page).locator('[data-recap-stat="parks"]')).toHaveText(`4 / ${parks.length}`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await root.locator("[data-replay-map]").scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute("data-state", "empty");
});

test("an unavailable replay can retry without hiding recap results", async ({ page }) => {
  let failed = true;
  const state = await setup(page, { fail: () => failed });
  const root = player(page);
  await expect(root).toHaveAttribute("data-state", "unavailable");
  await expect(root.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(root.locator("[data-replay-play]")).toBeDisabled();
  await expect(recap(page).locator('[data-recap-stat="parks"]')).toHaveText(`4 / ${parks.length}`);
  failed = false;
  await root.getByRole("button", { name: "Try again" }).click();
  await expect(root).toHaveAttribute("data-state", "playing");
  await expect(root.getByRole("button", { name: "Try again" })).toBeHidden();
  expect(state.requests()).toBe(2);
});

test("during the event the existing live hero remains and no replay is fetched", async ({ page }) => {
  const state = await setup(page, { time: "2026-09-12T12:00:00.000Z" });
  await expect(results(page)).toBeVisible();
  await expect(player(page)).toBeHidden();
  await expect(results(page).locator("[data-reference-map]")).toBeVisible();
  await expect(results(page).locator("[data-reference-map] .reference-map-marker")).toHaveCount(parks.length);
  await expect(results(page).locator("[data-hero-secondary-label]")).toHaveText("On air now");
  await expect(results(page).locator("[data-hero-gaps]")).toHaveText("1");
  expect(state.requests()).toBe(0);
  expect(state.errors).toEqual([]);
});
