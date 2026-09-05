import { expect, test } from "@playwright/test";
import { references } from "@ripota/parks";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

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
      await page.clock.runFor(60_000);
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
      if (!path.endsWith("/parks/")) {
        await expect(results.getByRole("link", { name: "Check recognition" })).toBeVisible();
      }
      expect(errors).toEqual([]);
    } finally {
      await server.stop();
    }
  });
}
