import { expect, test } from "@playwright/test";
import { parks as references } from "@ripota/parks";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("schedule offers park planning even when every park already has an activator", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-06T12:00:00Z") });
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: {
      ok: true,
      stops: references.map(park => ({
        id: `covered-${park.reference}`, parkReference: park.reference,
        plannedDate: "2026-09-11", startTime: "13:00", endTime: "15:00",
        activatorCallsign: "N1RI", bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "scheduled",
      })),
    } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/`);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(references.length);
    const shortcut = page.getByRole("link", { name: /Find parks with fewer activators/ });
    await expect(shortcut).toBeVisible();
    await shortcut.click();
    await expect(page).toHaveURL(/\/activate-ri-2026\/parks\//);
    await expect(page.locator("[data-live-coverage] [data-filter-row]:visible")).toHaveCount(references.length);
    await expect(page.locator('[data-filter="sort"]')).toHaveValue("activators");
  } finally {
    await server.stop();
  }
});

test("schedule search preserves deep links, mobile secondary filters, and print context", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/activate-ri-2026/public/stops", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          stops: [
            {
              id: "search-other-park",
              parkReference: "US-0513",
              plannedDate: "2026-09-12",
              startTime: "13:00",
              endTime: "15:00",
              activatorCallsign: "W1AW",
              bands: ["20m"],
              modes: ["SSB"],
              status: "scheduled",
            },
            {
              id: "search-target-park",
              parkReference: "US-0514",
              plannedDate: "2026-09-13",
              startTime: "15:00",
              endTime: "18:00",
              activatorCallsign: "N1RI",
              bands: ["40m"],
              modes: ["CW"],
              status: "scheduled",
            },
          ],
        }),
      });
    });
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?q=us-0514&activator=N1RI&county=Washington+County&timezone=utc`);

    const search = page.locator("[data-schedule-search]");
    const more = page.locator("[data-schedule-more-filters]");
    const summary = page.locator("[data-schedule-more-summary]");
    await expect(search).toHaveValue("us-0514");
    await expect(more).toHaveAttribute("open", "");
    await expect(summary).toHaveText("More filters (2 active)");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toContainText("US-0514");
    await expect(page.locator("[data-schedule-count]")).toHaveText("1 matching activation window for “us-0514”.");
    await page.locator("[data-timezone]").selectOption("pacific");
    await expect(page.locator("[data-schedule-print-summary]")).toContainText("Pacific");
    await page.locator("[data-timezone]").selectOption("utc");

    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(more).not.toHaveAttribute("open", "");
    await expect(page.locator('[data-filter="activator"]')).toBeHidden();
    await expect(summary).toHaveText("More filters (2 active)");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("[data-event-filters]")).toBeHidden();
    await expect(page.locator("[data-schedule-print-summary]")).toContainText("Search: “us-0514”");
    await expect(page.locator("[data-schedule-print-summary]")).toContainText("N1RI");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await page.emulateMedia({ media: "screen" });

    await search.fill("  chAfEe  ");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toContainText("US-0514");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("chAfEe");
    await search.press("Enter");
    await expect.poll(() => new URL(page.url()).searchParams.get("activator")).toBe("N1RI");
    await page.reload();
    await expect(search).toHaveValue("chAfEe");
    await expect(more).toHaveAttribute("open", "");
    await expect(summary).toHaveText("More filters (2 active)");

    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(summary).toHaveText("More filters");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    await expect(page.locator("[data-timezone]")).toHaveValue("utc");
    await expect(page).toHaveURL(/\?timezone=utc$/);
    await page.reload();
    await expect(more).not.toHaveAttribute("open", "");
    await expect(page.locator('[data-filter="mode"]')).toBeVisible();
    await expect(page.locator('[data-filter="band"]')).toBeVisible();
    await expect(page.locator('[data-filter="timeline"]')).toBeVisible();
    await expect(page.locator("[data-timezone]")).toBeVisible();
    const dayBounds = await page.locator('[data-filter="timeline"]').boundingBox();
    const timezoneBounds = await page.locator("[data-timezone]").boundingBox();
    const modeBounds = await page.locator('[data-filter="mode"]').boundingBox();
    const bandBounds = await page.locator('[data-filter="band"]').boundingBox();
    expect(dayBounds!.y).toBeCloseTo(timezoneBounds!.y, 0);
    expect(modeBounds!.y).toBeCloseTo(bandBounds!.y, 0);

    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(more).toHaveAttribute("open", "");
    await expect(summary).toBeHidden();
    await expect(page.locator('[data-filter="activator"]')).toBeVisible();
    await expect(page.locator('[data-filter="county"]')).toBeVisible();
    await expect(page.locator("[data-hunter-scope]")).toBeVisible();
    const secondaryPositions = await page.locator("[data-schedule-more-filters] select").evaluateAll((controls) =>
      controls.map((control) => control.getBoundingClientRect().y),
    );
    expect(new Set(secondaryPositions).size).toBe(1);
  } finally {
    await server.stop();
  }
});

test("schedule search preserves typing and Enter while activation windows are loading", async ({ page }) => {
  const server = await startActivateRiServer();
  let releaseStops!: () => void;
  const stopsReady = new Promise<void>((resolve) => { releaseStops = resolve; });
  let documentRequests = 0;
  let stopRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests += 1;
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/activate-ri-2026/public/stops", async (route) => {
      stopRequests += 1;
      await stopsReady;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          stops: [
            {
              id: "loading-other-park",
              parkReference: "US-0513",
              plannedDate: "2026-09-12",
              startTime: "13:00",
              endTime: "15:00",
              activatorCallsign: "W1AW",
              bands: ["20m"],
              modes: ["SSB"],
              status: "scheduled",
            },
            {
              id: "loading-target-park",
              parkReference: "US-0514",
              plannedDate: "2026-09-13",
              startTime: "15:00",
              endTime: "18:00",
              activatorCallsign: "N1RI",
              bands: ["40m"],
              modes: ["CW"],
              status: "scheduled",
            },
          ],
        }),
      });
    });
    const scheduleRequest = page.waitForRequest("**/api/activate-ri-2026/public/stops");
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?q=US-0513&timezone=utc`, { waitUntil: "domcontentloaded" });
    await scheduleRequest;
    await expect(page.locator("[data-print-schedule]")).toBeDisabled();
    await expect(page.locator("[data-live-schedule]")).toHaveAttribute("aria-busy", "true");

    const search = page.locator("[data-schedule-search]");
    await expect(page.locator("[data-live-loading]")).toBeVisible();
    await expect(search).toHaveValue("US-0513");
    await search.fill("US-0514");
    await search.press("Enter");
    await expect(page.locator("[data-live-loading]")).toBeVisible();

    releaseStops();
    await expect(page.locator("[data-schedule-loaded]")).toContainText("Schedule loaded");
    await expect(page.locator("[data-print-schedule]")).toBeEnabled();
    await expect(page.locator("[data-live-schedule]")).toHaveAttribute("aria-busy", "false");
    await expect(search).toHaveValue("US-0514");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toContainText("US-0514");
    await expect(page.locator("[data-schedule-count]")).toHaveText("1 matching activation window for “US-0514”.");
    await expect(page.locator("[data-timezone]")).toHaveValue("utc");
    await expect(page).toHaveURL(/\?q=US-0514&timezone=utc$/);
    expect(documentRequests).toBe(1);
    expect(stopRequests).toBe(1);
  } finally {
    releaseStops();
    await server.stop();
  }
});
