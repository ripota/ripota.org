import { expect, test, type Page } from "@playwright/test";
import { parks as references } from "@ripota/parks";
import type { PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";
import type { PublicActivationStop } from "../src/lib/activate-ri/types";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("park evidence and status filters remain available when activation plans cannot load", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-11T12:00:00Z") });
    const confirmation = { qsoDate: "20260911", activeCallsign: "W1AW", totalQsos: 12, qsosCw: 12, qsosData: 0, qsosPhone: 0 };
    const snapshot: PublicPotaParkStatusSnapshot = {
      generatedAt: "2026-09-11T12:00:00Z", lastPotaSyncAt: "2026-09-11T12:00:00Z", lastSpotIngestAt: null,
      stale: false, warning: null,
      eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
      summary: { total: references.length, confirmed: 1, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: references.length - 1, withoutConfirmation: references.length - 1 },
      parks: references.map(park => ({
        reference: park.reference, name: park.name, potaUrl: park.potaUrl,
        status: park.reference === "US-0514" ? "confirmed" : "needed",
        live: false, scheduled: false, observed: false, attemptRecorded: false,
        confirmation: park.reference === "US-0514" ? confirmation : null,
        confirmations: park.reference === "US-0514" ? [confirmation] : [],
        attempts: [], lastObservation: null,
      })),
    };
    await page.route("**/api/activate-ri-2026/public/park-status", route => route.fulfill({ json: { ok: true, ...snapshot } }));
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ status: 503 }));
    await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
    await page.goto(`${server.origin}/activate-ri-2026/parks/?progress-status=confirmed`);
    const listing = page.locator("[data-park-planning]");
    const rows = listing.locator("[data-filter-row]");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("US-0514");
    await expect(rows).toContainText("POTA confirmed");
    await expect(rows).toContainText("W1AW");
    await expect(rows).toContainText("Activation plans unavailable");
    await expect(rows.getByRole("link", { name: "Add an activation", exact: true })).toBeVisible();
    await expect(listing.getByRole("radio", { name: "Confirmed", exact: true })).toBeChecked();
    const sharedUrl = page.url();
    await listing.getByRole("button", { name: "Refresh parks", exact: true }).click();
    await expect(listing.getByRole("button", { name: "Refresh parks", exact: true })).toBeEnabled();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("POTA confirmed");
    await expect(page).toHaveURL(sharedUrl);
  } finally {
    await server.stop();
  }
});

test("one park listing combines status and planning filters and shares the complete view through history, reload, and refresh", async ({ page }) => {
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
  const stops: PublicActivationStop[] = [{
    id: "burlingame-saturday", parkReference: "US-0514", plannedDate: "2026-09-12",
    startTime: "10:00", endTime: "13:00", activatorCallsign: "K1NW",
    bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "scheduled",
  }];
  let statusRequests = 0;
  let stopRequests = 0;
  async function mockParks(target: Page): Promise<void> {
    await target.clock.install({ time: new Date("2026-09-11T12:00:00Z") });
    await target.route("**/api/activate-ri-2026/public/park-status", route => {
      statusRequests++;
      return route.fulfill({ json: { ok: true, ...snapshot } });
    });
    await target.route("**/api/activate-ri-2026/public/stops", route => {
      stopRequests++;
      return route.fulfill({ json: { ok: true, stops } });
    });
    await target.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
  }
  try {
    await mockParks(page);
    await page.goto(`${server.origin}/activate-ri-2026/parks/?source=club&source=email#park-planning`);
    const listing = page.locator("[data-park-planning]");
    const search = listing.getByRole("searchbox", { name: "Search parks" });
    const rows = listing.locator("[data-live-coverage] [data-filter-row]");
    const scheduled = listing.getByRole("radio", { name: "Scheduled", exact: true });
    await expect(rows).toHaveCount(references.length);
    await expect(page.getByRole("searchbox", { name: "Search parks" })).toHaveCount(1);
    await expect(page.locator("[data-live-coverage]")).toHaveCount(1);
    await expect(page.locator(".pota-park-card")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Refresh (parks|plans|progress)$/ })).toHaveCount(1);

    await listing.locator('[data-filter="sort"]').selectOption("slots");
    await listing.locator('[data-filter="timeline"]').selectOption("2026-09-12");
    await listing.locator('[data-filter="county"]').selectOption("Washington County");
    await listing.locator(".park-planning-more > summary").click();
    await listing.locator('[data-filter="mode"]').selectOption("SSB");
    await listing.locator('[data-filter="band"]').selectOption("20m");
    await listing.getByRole("radio", { name: "Still needed", exact: true }).check();
    await search.fill("US-0513");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("US-0513");
    await expect(rows.locator(".event-table-park-link")).toHaveAttribute("href", "/parks/us-0513/");

    await scheduled.check();
    await expect(rows).toHaveCount(0);
    await expect(listing.locator("[data-filter-empty]")).toContainText("No parks match");
    await search.fill("US-0");
    await search.fill("US-051");
    await search.fill("US-0514");
    await expect(rows).toHaveCount(1);
    await expect(rows.locator(".park-plan-details > summary")).toContainText("1 activator · 1 time slot");
    const sharedUrl = page.url();
    expect(Object.fromEntries(new URL(sharedUrl).searchParams)).toMatchObject({
      sort: "slots", timeline: "2026-09-12", county: "Washington County", mode: "SSB", band: "20m",
      "progress-status": "scheduled", q: "US-0514",
    });
    expect(new URL(sharedUrl).searchParams.getAll("source")).toEqual(["club", "email"]);
    expect(new URL(sharedUrl).hash).toBe("#park-planning");

    await page.goBack();
    await expect(search).toHaveValue("US-0513");
    await expect(scheduled).toBeChecked();
    await expect(rows).toHaveCount(0);
    await page.goBack();
    await expect(listing.getByRole("radio", { name: "Still needed", exact: true })).toBeChecked();
    await expect(rows).toHaveCount(1);
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL(sharedUrl);
    await expect(rows).toHaveCount(1);
    await page.reload();
    await expect(search).toHaveValue("US-0514");
    await expect(scheduled).toBeChecked();
    await expect(rows).toHaveCount(1);
    await expect(listing.locator('[data-filter="county"]')).toHaveValue("Washington County");
    await expect(listing.locator('[data-filter="timeline"]')).toHaveValue("2026-09-12");
    await expect(listing.locator('[data-filter="mode"]')).toHaveValue("SSB");
    await expect(listing.locator('[data-filter="band"]')).toHaveValue("20m");

    const recipient = await page.context().newPage();
    await mockParks(recipient);
    await recipient.goto(sharedUrl);
    await expect(recipient.getByRole("searchbox", { name: "Search parks" })).toHaveValue("US-0514");
    await expect(recipient.getByRole("radio", { name: "Scheduled", exact: true })).toBeChecked();
    for (const [key, value] of Object.entries({ sort: "slots", timeline: "2026-09-12", county: "Washington County", mode: "SSB", band: "20m" })) {
      await expect(recipient.locator(`[data-filter="${key}"]`)).toHaveValue(value);
    }
    await expect(recipient.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(1);
    await expect(recipient).toHaveURL(sharedUrl);
    await recipient.close();

    const changed = snapshot.parks.find(park => park.reference === "US-0514")!;
    changed.status = "needed";
    changed.scheduled = false;
    snapshot.summary.scheduledNotConfirmed = 0;
    snapshot.summary.stillNeeded = references.length;
    await page.clock.runFor(60_000);
    await expect(rows).toHaveCount(0);
    await expect(search).toHaveValue("US-0514");
    await expect(scheduled).toBeChecked();
    await expect(page).toHaveURL(sharedUrl);

    const requestsBeforeRefresh = { status: statusRequests, stops: stopRequests };
    stops.length = 0;
    await listing.getByRole("button", { name: "Refresh parks", exact: true }).click();
    await expect.poll(() => statusRequests).toBeGreaterThan(requestsBeforeRefresh.status);
    await expect.poll(() => stopRequests).toBeGreaterThan(requestsBeforeRefresh.stops);
    await expect(listing.getByRole("button", { name: "Refresh parks", exact: true })).toBeEnabled();
    await expect(rows).toHaveCount(0);
    await expect(listing.locator('[data-filter="mode"]')).toHaveValue("SSB");
    await expect(listing.locator('[data-filter="band"]')).toHaveValue("20m");
    await expect(scheduled).toBeChecked();
    await expect(page).toHaveURL(sharedUrl);

    await listing.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(listing.getByRole("radio", { name: "All", exact: true })).toBeChecked();
    await expect(rows).toHaveCount(references.length);
    for (const key of ["timeline", "county", "mode", "band"]) {
      await expect(listing.locator(`[data-filter="${key}"]`)).toHaveValue("all");
    }
    await expect(listing.locator('[data-filter="sort"]')).toHaveValue("activators");
    await expect(listing.locator("[data-my-parks]")).not.toBeChecked();
    for (const key of ["q", "progress-q", "progress-status", "sort", "timeline", "county", "mode", "band", "activator", "mine"]) {
      expect(new URL(page.url()).searchParams.has(key)).toBe(false);
    }
    expect(new URL(page.url()).searchParams.getAll("source")).toEqual(["club", "email"]);
    expect(new URL(page.url()).hash).toBe("#park-planning");
    await page.goBack();
    await expect(page).toHaveURL(sharedUrl);
    await expect(search).toHaveValue("US-0514");
    await expect(scheduled).toBeChecked();
    await expect(rows).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

test("a legacy park results link opens the unified park's plans and preserves explicit disclosure choices", async ({ page }) => {
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
    await page.goto(`${server.origin}/activate-ri-2026/parks/?sort=slots&timeline=main&progress-q=US-7865#park-results`);
    const listing = page.locator("[data-park-planning]");
    const search = listing.getByRole("searchbox", { name: "Search parks" });
    const rows = listing.locator("[data-live-coverage] [data-filter-row]");
    const selectedRow = rows.filter({ hasText: "US-7865" });
    const planned = selectedRow.locator(".park-plan-details");
    const plannedSummary = planned.locator("summary");
    await expect(search).toHaveValue("US-7865");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("US-7865");
    expect(new URL(page.url()).searchParams.has("progress-q")).toBe(false);
    expect(new URL(page.url()).searchParams.get("expanded")).toBe("US-7865");
    await expect(page.locator("#park-results")).toBeInViewport();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("POTA confirmed");
    await expect(rows).toContainText("Loading activation plans…");

    releaseStops();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("POTA confirmed");
    await expect(planned).toHaveJSProperty("open", true);
    await expect(planned.getByText(/K1NW/)).toBeVisible();
    await expect(planned).toContainText("Sep 12, 2026, 06:00-09:00 EDT");

    await plannedSummary.click();
    await expect(planned).toHaveJSProperty("open", false);
    expect(new URL(page.url()).searchParams.has("expanded")).toBe(false);
    const closedUrl = page.url();
    stops[0].endTime = "14:00";
    await listing.getByRole("button", { name: "Refresh parks", exact: true }).click();
    await expect(planned).toContainText("06:00-10:00 EDT");
    await expect(planned).toHaveJSProperty("open", false);
    snapshot.lastPotaSyncAt = "2026-09-11T12:01:00Z";
    await page.clock.runFor(60_000);
    await expect(page.locator("[data-pota-summary-status]")).toContainText("12:01");
    await expect(planned).toHaveJSProperty("open", false);
    await expect(search).toHaveValue("US-7865");
    await expect(page).toHaveURL(closedUrl);

    await page.reload();
    await expect(search).toHaveValue("US-7865");
    await expect(rows).toHaveCount(1);
    await expect(planned).toHaveJSProperty("open", false);
    await plannedSummary.click();
    await expect(planned).toHaveJSProperty("open", true);
    const openedUrl = page.url();

    await listing.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(rows).toHaveCount(references.length);
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ expanded: "US-7865" });
    expect(new URL(page.url()).hash).toBe("#park-results");
    await expect(planned).toHaveJSProperty("open", true);
    await page.goBack();
    await expect(page).toHaveURL(openedUrl);
    await expect(rows).toHaveCount(1);
    await expect(planned).toHaveJSProperty("open", true);
    await page.goBack();
    await expect(page).toHaveURL(closedUrl);
    await expect(planned).toHaveJSProperty("open", false);
    await page.goForward();
    await page.goForward();
    await expect(search).toHaveValue("");
    await expect(rows).toHaveCount(references.length);
    await expect(planned).toHaveJSProperty("open", true);
  } finally {
    releaseStops();
    await server.stop();
  }
});
