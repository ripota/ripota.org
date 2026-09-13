import { expect, test, type Page } from "@playwright/test";
import parks from "../public/data/activate-ri-2026/parks.json" with { type: "json" };
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";
import type { PublicParkEvidence, PublicPotaParkStatusSnapshot } from "../src/lib/activate-ri/pota-status-client";

test.setTimeout(60_000);
let server: ActivateRiServer;
test.beforeAll(async () => { server = await startActivateRiServer(); });
test.afterAll(async () => { await server?.stop(); });
test.beforeEach(async ({ page }) => {
  // Let Date and timers advance together, including Leaflet's fade animation.
  await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
});

test("post-event parks shows actual POTA records and an active historical map without plans or account requests", async ({ page }) => {
  const errors: string[] = [];
  const irrelevantRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/\/api\/(auth\/session|activate-ri-2026\/public\/stops)(?:\?|$)/.test(new URL(request.url()).pathname)) irrelevantRequests.push(request.url());
  });
  await stubRecords(page);
  await page.goto(`${server.origin}/activate-ri-2026/parks/#park-results`);
  const results = page.locator("[data-activation-results]");
  await expect(results).toBeVisible();
  await expect(results.getByRole("heading", { name: "Recorded activations" })).toBeInViewport();
  await expect(page.locator("[data-activation-record]")).toHaveCount(5);
  await expect(page.locator("[data-park-planning]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add activation", exact: true })).toHaveCount(0);
  await expect(results.locator("[data-results-status]")).toContainText("Sep 14, 2026");
  await expect(results.locator("[data-results-status]")).not.toContainText("Sep 15");
  await expect(results.locator("[data-results-count]")).toContainText("5 log records · 3 parks · 4 qualifying activations");
  const attempt = results.locator("[data-activation-record]").filter({ hasText: "N1TRY" });
  await expect(attempt).toContainText("Recorded attempt");
  await expect(attempt.locator('[data-label="Total QSOs"]')).toHaveText("3");
  await expect(attempt.locator('[data-label="Phone"]')).toHaveText("2");
  await expect(attempt.locator('[data-label="CW"]')).toHaveText("0");
  await expect(attempt.locator('[data-label="Data"]')).toHaveText("1");
  await expect(attempt.getByRole("link", { name: "Photos" })).toHaveCount(0);
  await expect(results.locator(`[data-reference="${parks[0].reference}"]`).first().getByRole("link", { name: "Photos" })).toHaveAttribute("href", `/activate-ri-2026/media/?mediaPark=${parks[0].reference}`);
  await page.getByText("Show park map", { exact: true }).click();
  await expect(page.locator("#activate-ri-archived-results-map")).toBeVisible();
  await expect(page.locator("#activate-ri-archived-results-map .leaflet-interactive").first()).toBeVisible();
  expect(irrelevantRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("combined filters round trip, reload, clear, and retain unrelated parameters", async ({ page }) => {
  await stubRecords(page);
  const query = "source=recap&mode=SSB&band=40m&results-q=n1alpha&results-date=2026-09-11&results-mode=cw&results-outcome=qualifying&results-sort=qsos-desc";
  await page.goto(`${server.origin}/activate-ri-2026/parks/?${query}#park-results`);
  await assertCombinedView(page);
  await page.reload();
  await assertCombinedView(page);
  await page.locator("[data-results-clear]").click();
  await expect(page.locator("[data-activation-record]")).toHaveCount(5);
  await expect(page.locator("[data-results-search]")).toHaveValue("");
  expect(new URL(page.url()).search).toBe("?source=recap&mode=SSB&band=40m");
  expect(new URL(page.url()).hash).toBe("#park-results");
  await page.goBack();
  await assertCombinedView(page);
  await page.goForward();
  await expect(page.locator("[data-activation-record]")).toHaveCount(5);
  await expect(page.locator('[data-results-filter="mode"]')).toHaveValue("all");
});

test("search keystrokes form one history entry and discrete filters remain navigable", async ({ page }) => {
  await stubRecords(page);
  await page.goto(`${server.origin}/activate-ri-2026/parks/?source=history#park-results`);
  await expect(page.locator("[data-activation-record]")).toHaveCount(5);
  const search = page.locator("[data-results-search]");
  await search.pressSequentially("n1alpha");
  await expect(page.locator("[data-activation-record]")).toHaveCount(2);
  await page.locator('[data-results-filter="date"]').selectOption("2026-09-11");
  await expect(page.locator("[data-activation-record]")).toHaveCount(1);
  await page.locator('[data-results-filter="mode"]').selectOption("phone");
  await expect(page.locator("[data-activation-record]")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('[data-results-filter="mode"]')).toHaveValue("all");
  await expect(page.locator("[data-activation-record]")).toHaveCount(1);
  await page.goBack();
  await expect(page.locator('[data-results-filter="date"]')).toHaveValue("all");
  await expect(search).toHaveValue("n1alpha");
  await expect(page.locator("[data-activation-record]")).toHaveCount(2);
  await page.goBack();
  await expect(search).toHaveValue("");
  await expect(page.locator("[data-activation-record]")).toHaveCount(5);
  await page.goForward();
  await expect(search).toHaveValue("n1alpha");
  await expect(page.locator("[data-activation-record]")).toHaveCount(2);
});

test("old search links migrate while explicit result filters remain authoritative", async ({ page }) => {
  await stubRecords(page);
  for (const alias of ["q", "progress-q"]) {
    await page.goto(`${server.origin}/activate-ri-2026/parks/?${alias}=N1TRY&source=old&mode=CW#park-results`);
    await expect(page.locator("[data-results-search]")).toHaveValue("N1TRY");
    await expect(page.locator("[data-activation-record]")).toHaveCount(1);
    await expect(page.locator('[data-results-filter="mode"]')).toHaveValue("all");
    expect(new URL(page.url()).searchParams.has(alias)).toBe(false);
    expect(new URL(page.url()).searchParams.get("results-q")).toBe("N1TRY");
    expect(new URL(page.url()).searchParams.get("source")).toBe("old");
  }
  await page.goto(`${server.origin}/activate-ri-2026/parks/?q=N1TRY&results-q=N1ALPHA&results-sort=invalid&results-date=2026-09-14#park-results`);
  await expect(page.locator("[data-results-search]")).toHaveValue("N1ALPHA");
  await expect(page.locator("[data-activation-record]")).toHaveCount(2);
  expect(new URL(page.url()).search).toBe("?results-q=N1ALPHA");
});

test("late log refresh preserves filters and focus, and failures retain good records but hide media links", async ({ page }) => {
  const data = fixture();
  let fail = false;
  await page.route("**/api/activate-ri-2026/public/park-status", (route) => fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: { ok: true, ...data } }));
  await page.route("**/api/activate-ri-2026/public/media?summary=parks", (route) => fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: mediaFixture() }));
  await page.goto(`${server.origin}/activate-ri-2026/parks/?results-mode=cw&results-sort=qsos-desc#park-results`);
  await expect(page.locator("[data-activation-record]")).toHaveCount(3);
  const url = page.url();
  data.parks = data.parks.map((park) => ({ ...park, confirmations: park.confirmations.map((row) => ({ ...row, qsosCw: 0 })) }));
  await page.locator("[data-results-refresh]").click();
  await expect(page.locator("[data-activation-record]")).toHaveCount(0);
  await expect(page.locator("[data-results-empty]")).toContainText("No activation records match");
  await expect(page.locator('[data-results-filter="mode"]')).toHaveValue("cw");
  await expect(page.locator("[data-results-refresh]")).toBeFocused();
  expect(page.url()).toBe(url);
  await page.locator('[data-results-filter="mode"]').selectOption("all");
  await expect(page.locator("[data-activation-record]")).toHaveCount(5);
  await expect(page.locator("[data-activation-results]").getByRole("link", { name: "Photos" })).toHaveCount(2);
  fail = true;
  await page.locator("[data-results-refresh]").click();
  await expect(page.locator("[data-results-status]")).toContainText("latest refresh failed");
  await expect(page.locator("[data-activation-record]")).toHaveCount(5);
  await expect(page.locator("[data-activation-results]").getByRole("link", { name: "Photos" })).toHaveCount(0);
});

test("distinguishes unavailable records from zero uploaded logs", async ({ page }) => {
  let unavailable = true;
  const data = fixture();
  data.parks = [];
  await page.route("**/api/activate-ri-2026/public/park-status", (route) => unavailable ? route.fulfill({ status: 503 }) : route.fulfill({ json: { ok: true, ...data } }));
  await page.route("**/api/activate-ri-2026/public/media?summary=parks", (route) => route.fulfill({ json: { ok: true, parks: [] } }));
  await page.goto(`${server.origin}/activate-ri-2026/parks/#park-results`);
  await expect(page.locator("[data-results-status]")).toContainText("temporarily unavailable");
  await expect(page.locator("[data-results-count]")).toBeEmpty();
  await expect(page.locator("[data-results-empty]")).toBeHidden();
  unavailable = false;
  await page.locator("[data-results-refresh]").click();
  await expect(page.locator("[data-results-empty]")).toContainText("No event activation logs are available yet");
  await expect(page.locator("[data-results-count]")).toContainText("0 of 0 log records");
});

for (const width of [900, 390, 320]) test(`records remain readable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await stubRecords(page);
  await page.goto(`${server.origin}/activate-ri-2026/parks/?results-outcome=attempts#park-results`);
  const row = page.locator("[data-activation-record]");
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-label="Date (UTC)"]')).toBeVisible();
  await expect(row.locator('[data-label="Total QSOs"]')).toBeVisible();
  await expect(row).toContainText("Recorded attempt");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`activation-records-${width}.png`), fullPage: true });
});

async function assertCombinedView(page: Page) {
  await expect(page.locator("[data-results-search]")).toHaveValue("n1alpha");
  for (const [key, value] of [["date", "2026-09-11"], ["mode", "cw"], ["outcome", "qualifying"], ["sort", "qsos-desc"]]) {
    await expect(page.locator(`[data-results-filter="${key}"]`)).toHaveValue(value);
  }
  await expect(page.locator("[data-activation-record]")).toHaveCount(1);
  await expect(page.locator("[data-activation-record]")).toContainText(parks[1].reference);
}

async function stubRecords(page: Page) {
  await page.route("**/api/activate-ri-2026/public/park-status", (route) => route.fulfill({ json: { ok: true, ...fixture() } }));
  await page.route("**/api/activate-ri-2026/public/media?summary=parks", (route) => route.fulfill({ json: mediaFixture() }));
}
function mediaFixture() { return { ok: true, parks: [{ reference: parks[0].reference, photos: 1, videos: 0 }] }; }
function evidence(activeCallsign: string, qsoDate: string, totalQsos: number, cw: number, phone: number, data: number): PublicParkEvidence {
  return { activeCallsign, qsoDate, totalQsos, qsosCw: cw, qsosPhone: phone, qsosData: data };
}
function fixture(): PublicPotaParkStatusSnapshot {
  const confirmations = [
    [evidence("N1ZED", "20260913", 40, 5, 35, 0), evidence("N1ALPHA", "20260910", 30, 0, 20, 10)],
    [evidence("N1ALPHA", "20260911", 15, 15, 0, 0)],
    [evidence("N1ZED", "20260913", 40, 5, 35, 0)],
  ];
  return {
    generatedAt: "2026-09-15T12:00:00Z", lastPotaSyncAt: "2026-09-14T10:00:00Z", lastSpotIngestAt: null,
    stale: false, warning: null, eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: { total: 61, confirmed: 3, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 58, withoutConfirmation: 58 },
    parks: parks.map((park, index) => ({ ...park, potaUrl: "https://pota.app/", status: index < 3 ? "confirmed" : "needed", live: false, scheduled: false, observed: false, attemptRecorded: index === 1, confirmation: confirmations[index]?.[0] ?? null, confirmations: confirmations[index] ?? [], attempts: index === 1 ? [evidence("N1TRY", "20260911", 3, 0, 2, 1)] : [], lastObservation: null })),
  };
}
