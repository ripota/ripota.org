import { expect, test } from "@playwright/test";
import { parks as references } from "@ripota/parks";
import type { PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";
import type { PublicActivationStop } from "../src/lib/activate-ri/types";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("event progress shares status and search alongside planner filters and restores them through history and refresh", async ({ page }) => {
  const server = await startActivateRiServer();
  const snapshot: PublicPotaParkStatusSnapshot = {
    generatedAt: "2026-09-11T12:00:00Z", lastPotaSyncAt: "2026-09-11T12:00:00Z", lastSpotIngestAt: null,
    stale: false, warning: null,
    eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: { total: references.length, confirmed: 0, observedNotConfirmed: 0, scheduledNotConfirmed: 1, stillNeeded: references.length - 1, withoutConfirmation: references.length },
    parks: references.map(park => ({
      reference: park.reference, name: park.name, potaUrl: park.potaUrl,
      status: park.reference === "US-0514" ? "scheduled" : "needed",
      live: false, scheduled: park.reference === "US-0514", observed: false,
      attemptRecorded: false, confirmation: null, confirmations: [], attempts: [], lastObservation: null,
    })),
  };
  try {
    await page.clock.install({ time: new Date("2026-09-11T12:00:00Z") });
    await page.route("**/api/activate-ri-2026/public/park-status", route => route.fulfill({ json: { ok: true, ...snapshot } }));
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [] } }));
    await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
    await page.goto(`${server.origin}/activate-ri-2026/parks/?sort=slots&timeline=main&progress-status=needed&progress-q=US-0513#park-planning`);
    const progress = page.locator("[data-pota-progress]");
    const search = progress.getByRole("searchbox", { name: "Search parks" });
    const cards = progress.locator(".pota-park-card");
    const scheduled = progress.getByRole("radio", { name: "Scheduled", exact: true });
    await expect(search).toHaveValue("US-0513");
    await expect(progress.getByRole("radio", { name: "Still needed", exact: true })).toBeChecked();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("US-0513");
    await expect(cards.getByRole("link", { name: "Open local field guide" })).toHaveAttribute("href", "/parks/us-0513/");
    await expect(cards.getByRole("link")).toHaveCount(1);

    await scheduled.check();
    await expect(cards).toHaveCount(0);
    await search.fill("US-0");
    await search.fill("US-051");
    await search.fill("US-0514");
    await expect(cards).toHaveCount(1);
    const sharedUrl = page.url();
    expect(Object.fromEntries(new URL(sharedUrl).searchParams)).toMatchObject({
      sort: "slots", timeline: "main", "progress-status": "scheduled", "progress-q": "US-0514",
    });
    expect(new URL(sharedUrl).hash).toBe("#park-planning");

    await page.goBack();
    await expect(search).toHaveValue("US-0513");
    await expect(scheduled).toBeChecked();
    await expect(cards).toHaveCount(0);
    await page.goBack();
    await expect(progress.getByRole("radio", { name: "Still needed", exact: true })).toBeChecked();
    await expect(cards).toHaveCount(1);
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL(sharedUrl);
    await expect(cards).toHaveCount(1);
    await page.reload();
    await expect(search).toHaveValue("US-0514");
    await expect(scheduled).toBeChecked();
    await expect(cards).toHaveCount(1);

    const changed = snapshot.parks.find(park => park.reference === "US-0514")!;
    changed.status = "needed";
    changed.scheduled = false;
    snapshot.summary.scheduledNotConfirmed = 0;
    snapshot.summary.stillNeeded = references.length;
    await page.clock.runFor(60_000);
    await expect(cards).toHaveCount(0);
    await expect(search).toHaveValue("US-0514");
    await expect(scheduled).toBeChecked();
    await expect(page).toHaveURL(sharedUrl);

    await progress.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(progress.getByRole("radio", { name: "All", exact: true })).toBeChecked();
    await expect(cards).toHaveCount(references.length);
    expect(new URL(page.url()).searchParams.has("progress-status")).toBe(false);
    expect(new URL(page.url()).searchParams.has("progress-q")).toBe(false);
    expect(new URL(page.url()).searchParams.get("sort")).toBe("slots");
    expect(new URL(page.url()).searchParams.get("timeline")).toBe("main");
    await page.goBack();
    await expect(page).toHaveURL(sharedUrl);
    await expect(search).toHaveValue("US-0514");
    await expect(scheduled).toBeChecked();
  } finally {
    await server.stop();
  }
});

test("a park results link reveals its planned stops and retains the park through refresh, reset, and history", async ({ page }) => {
  const server = await startActivateRiServer();
  const confirmation = {
    qsoDate: "20260911", activeCallsign: "W1AAA", totalQsos: 12,
    qsosCw: 0, qsosData: 0, qsosPhone: 12,
  };
  const snapshot: PublicPotaParkStatusSnapshot = {
    generatedAt: "2026-09-11T12:00:00Z", lastPotaSyncAt: "2026-09-11T12:00:00Z", lastSpotIngestAt: null,
    stale: false, warning: null,
    eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: { total: references.length, confirmed: 1, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: references.length - 1, withoutConfirmation: references.length - 1 },
    parks: references.map(park => ({
      reference: park.reference, name: park.name, potaUrl: park.potaUrl,
      status: park.reference === "US-7865" ? "confirmed" : "needed",
      live: false, scheduled: park.reference === "US-7865", observed: false,
      attemptRecorded: false,
      confirmation: park.reference === "US-7865" ? confirmation : null,
      confirmations: park.reference === "US-7865" ? [confirmation] : [],
      attempts: [], lastObservation: null,
    })),
  };
  const stops: PublicActivationStop[] = [{
    id: "east-beach-saturday", parkReference: "US-7865", plannedDate: "2026-09-12",
    startTime: "10:00", endTime: "13:00", activatorCallsign: "K1NW",
    bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "scheduled",
  }];
  let releaseStops!: () => void;
  const stopsReady = new Promise<void>(resolve => { releaseStops = resolve; });
  try {
    await page.clock.install({ time: new Date("2026-09-11T12:00:00Z") });
    await page.route("**/api/activate-ri-2026/public/park-status", route => route.fulfill({ json: { ok: true, ...snapshot } }));
    await page.route("**/api/activate-ri-2026/public/stops", async route => {
      await stopsReady;
      await route.fulfill({ json: { ok: true, stops } });
    });
    await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
    const sharedUrl = `${server.origin}/activate-ri-2026/parks/?sort=slots&timeline=main&progress-q=US-7865#park-results`;
    await page.goto(sharedUrl);
    const progress = page.locator("[data-pota-progress]");
    const search = progress.getByRole("searchbox", { name: "Search parks" });
    const cards = progress.locator(".pota-park-card");
    const selectedCard = cards.filter({ hasText: "US-7865" });
    const planned = selectedCard.locator("details").filter({ has: page.locator("summary", { hasText: "Planned event stops" }) });
    const plannedSummary = planned.locator("summary");
    await expect(search).toHaveValue("US-7865");
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("POTA confirmed");
    await expect(progress.locator("#park-results")).toBeInViewport();
    await expect(planned).toHaveCount(0);

    releaseStops();
    await expect(planned).toHaveJSProperty("open", true);
    await expect(planned.getByText(/K1NW/)).toBeVisible();
    await expect(planned).toContainText("Sep 12, 2026, 06:00-09:00 EDT");

    await plannedSummary.click();
    await expect(planned).toHaveJSProperty("open", false);
    stops[0].endTime = "14:00";
    await progress.getByRole("button", { name: "Refresh progress", exact: true }).click();
    await expect(planned).toContainText("06:00-10:00 EDT");
    await expect(planned).toHaveJSProperty("open", false);
    snapshot.lastPotaSyncAt = "2026-09-11T12:01:00Z";
    await page.clock.runFor(60_000);
    await expect(progress.locator("[data-pota-summary-status]")).toContainText("12:01");
    await expect(planned).toHaveJSProperty("open", false);
    await expect(search).toHaveValue("US-7865");
    await expect(page).toHaveURL(sharedUrl);

    await page.reload();
    await expect(search).toHaveValue("US-7865");
    await expect(cards).toHaveCount(1);
    await expect(planned).toHaveJSProperty("open", true);

    await progress.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(cards).toHaveCount(references.length);
    expect(new URL(page.url()).searchParams.has("progress-q")).toBe(false);
    expect(new URL(page.url()).searchParams.get("sort")).toBe("slots");
    expect(new URL(page.url()).searchParams.get("timeline")).toBe("main");
    expect(new URL(page.url()).hash).toBe("#park-results");
    await plannedSummary.click();
    await expect(planned).toHaveJSProperty("open", false);
    await page.goBack();
    await expect(page).toHaveURL(sharedUrl);
    await expect(cards).toHaveCount(1);
    await expect(planned).toHaveJSProperty("open", true);
    await page.goForward();
    await expect(search).toHaveValue("");
    await expect(cards).toHaveCount(references.length);
  } finally {
    releaseStops();
    await server.stop();
  }
});
