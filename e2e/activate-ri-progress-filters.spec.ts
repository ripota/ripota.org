import { expect, test } from "@playwright/test";
import { references } from "@ripota/parks";
import type { PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";
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
