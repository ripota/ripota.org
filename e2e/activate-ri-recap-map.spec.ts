import { expect, test } from "@playwright/test";
import eventParks from "../public/data/activate-ri-2026/parks.json" with { type: "json" };
import type { PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("the archived park-results map keeps 2026 evidence separate from current activity and plans", async ({ page }) => {
  const server = await startActivateRiServer();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let fail = false;
  let summaryRequests = 0;
  let releaseMediaSummary!: () => void;
  const mediaSummaryReady = new Promise<void>((resolve) => { releaseMediaSummary = resolve; });
  const confirmation = { qsoDate: "20260912", activeCallsign: "W1AW", totalQsos: 20, qsosCw: 10, qsosData: 0, qsosPhone: 10 };
  const snapshot: PublicPotaParkStatusSnapshot = {
    generatedAt: "2027-02-01T12:00:00Z", lastPotaSyncAt: "2026-09-20T12:00:00Z", lastSpotIngestAt: null,
    stale: false, warning: null,
    eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: { total: eventParks.length, confirmed: 1, observedNotConfirmed: 1, scheduledNotConfirmed: 1, stillNeeded: eventParks.length - 3, withoutConfirmation: eventParks.length - 1 },
    parks: eventParks.map((park, index) => ({
      reference: park.reference, name: `Changed later: ${park.name}`, potaUrl: park.potaUrl,
      status: index === 0 ? "confirmed" : index === 1 ? "observed" : index === 2 ? "scheduled" : "needed",
      live: true, scheduled: true, observed: index < 2, attemptRecorded: false,
      confirmation: index === 0 ? confirmation : null, confirmations: index === 0 ? [confirmation] : [], attempts: [],
      lastObservation: index === 1 ? {
        spotDate: "2026-09-12", activeCallsign: "N1BS", lastObservedAt: "2026-09-12T12:00:00Z",
        frequency: "14062", mode: "CW", sourceLabel: "POTA", spotterCallsign: "W1AW",
        evidenceKind: "structured_spot", declaredByReference: null,
      } : null,
    })),
  };

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install({ time: new Date("2027-02-01T12:00:00Z") });
    await page.route("**/api/activate-ri-2026/public/park-status", route => fail
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: { ok: true, ...snapshot } }));
    await page.route("**/api/activate-ri-2026/public/media**", async route => {
      if (new URL(route.request().url()).searchParams.get("summary") === "parks") {
        summaryRequests++;
        await mediaSummaryReady;
        return fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: { ok: true, parks: [
          { reference: eventParks[0].reference, photos: 2, videos: 0 },
          { reference: eventParks[2].reference, photos: 0, videos: 1 },
        ] } });
      }
      return route.fulfill({ json: { ok: true, media: [], nextCursor: null } });
    });
    await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [] } }));
    await page.route("**/api/pota/spots", route => route.fulfill({ json: { ok: true, spots: [], generatedAt: snapshot.generatedAt, stale: false } }));
    await page.goto(`${server.origin}/activate-ri-2026/parks/`, { waitUntil: "domcontentloaded" });
    await page.getByText("Show park map", { exact: true }).click();

    const map = page.locator('[data-map-recap="true"]');
    const legend = map.locator("..").locator(".map-legend");
    await expect(map.locator(".reference-map-marker")).toHaveCount(eventParks.length);
    const trailLongitude = await map.evaluate(element => {
      const payload = JSON.parse(document.getElementById((element as HTMLElement).dataset.mapDataId!)!.textContent!);
      return payload.items.find((item: { reference: string }) => item.reference === "US-4582").marker.longitude;
    });
    // The national trail's old address is in New York; its event point must be in Rhode Island.
    expect(trailLongitude).toBeGreaterThan(-72);
    expect(trailLongitude).toBeLessThan(-71);
    await expect(legend.locator("[data-map-legend-item]:visible")).toHaveText([
      "✓Confirmed in POTA logs", "•Activity recorded", "—No log confirmation",
    ]);
    await expect(map.locator('.reference-map-marker[fill="#2d7a4b"]')).toHaveCount(1);
    await expect(map.locator('.reference-map-marker[fill="#ad701e"]')).toHaveCount(1);
    await expect(map.locator('.reference-map-marker[fill="#707b78"]')).toHaveCount(eventParks.length - 2);
    await expect(map.locator(".reference-map-status-symbol--activated")).toHaveText(["✓"]);
    await expect(map.locator(".reference-map-status-symbol--observed")).toHaveText(["•"]);
    await expect(map.locator(".reference-map-live-indicator, .reference-map-marker--live")).toHaveCount(0);
    // On narrow screens the attribution wraps; Block Island must remain above it.
    await expect.poll(() => map.evaluate(element => {
      const attributionTop = element.querySelector(".leaflet-control-attribution")!.getBoundingClientRect().top;
      return [...element.querySelectorAll(".reference-map-marker")]
        .every(marker => marker.getBoundingClientRect().bottom < attributionTop);
    })).toBe(true);

    await map.locator('.reference-map-marker[fill="#2d7a4b"]').dispatchEvent("click");
    const popup = map.locator(".leaflet-popup");
    await expect(popup).toContainText(eventParks[0].name);
    await expect(popup).not.toContainText("Changed later");
    await expect(popup).toContainText("W1AW · 2026-09-12 UTC · 20 QSOs");
    await expect(popup).not.toContainText(/On air now|scheduled|upcoming|Volunteer|Add activation/i);
    const mediaLink = popup.getByRole("link", { name: "Photos" });
    await expect(mediaLink).toHaveCount(0);
    releaseMediaSummary();
    // Availability arriving after a popup opens must update that popup too.
    await expect(mediaLink).toHaveAttribute("href", `/activate-ri-2026/media/?mediaPark=${eventParks[0].reference}`);
    await map.locator(".leaflet-popup-close-button").click();
    await expect(popup).toHaveCount(0);
    await map.locator('.reference-map-marker[fill="#ad701e"]').dispatchEvent("click");
    await expect(popup).toContainText("Activity recorded · no qualifying log yet");
    await expect(popup).toContainText("N1BS");
    await expect(popup).toContainText("2026-09-12 UTC");
    await expect(mediaLink).toHaveCount(0);
    await map.locator(".leaflet-popup-close-button").click();
    await expect(popup).toHaveCount(0);
    await map.locator(".reference-map-marker").nth(2).dispatchEvent("click");
    await expect(mediaLink).toHaveAttribute("href", `/activate-ri-2026/media/?mediaPark=${eventParks[2].reference}`);
    expect(summaryRequests).toBe(1);

    await page.clock.runFor(60_000);
    await expect(map.locator(".reference-map-live-indicator, .reference-map-marker--live")).toHaveCount(0);

    fail = true;
    await page.reload();
    await page.getByText("Show park map", { exact: true }).click();
    await expect(map.locator(".reference-map-marker")).toHaveCount(eventParks.length);
    await expect(legend).toBeHidden();
    await map.locator(".reference-map-marker").first().dispatchEvent("click");
    await expect(popup).toContainText("2026 results are temporarily unavailable");
    await expect(popup).not.toContainText("No log confirmation recorded");
    await expect(mediaLink).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    releaseMediaSummary();
    await server.stop();
  }
});
