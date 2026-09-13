import { expect, test } from "@playwright/test";
import parks from "../public/data/activate-ri-2026/parks.json" with { type: "json" };
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

function snapshot() {
  const evidence = { qsoDate: "20260912", activeCallsign: "W1AW", totalQsos: 100, qsosCw: 30, qsosPhone: 60, qsosData: 10 };
  return {
    ok: true, generatedAt: "2026-09-15T12:00:00Z", lastPotaSyncAt: "2026-09-14T10:00:00Z", lastSpotIngestAt: null,
    stale: false, warning: null, eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: { total: 61, confirmed: 1, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 60, withoutConfirmation: 60 },
    parks: parks.map((park, index) => ({ ...park, potaUrl: "https://pota.app/", status: index === 0 ? "confirmed" : "needed", live: false,
      scheduled: false, observed: false, attemptRecorded: false, confirmation: index === 0 ? evidence : null,
      confirmations: index === 0 ? [evidence] : [], attempts: [], lastObservation: null,
    })),
  };
}

function photos() {
  return ["W1AW", "W1AW", "N1TEST", "K1TEST"].map((callsign, index) => {
    const id = `00000000-0000-4000-8000-00000000000${index}`;
    return { id, kind: "photo", featuredOnRecap: true, callsign, authorLabel: callsign, title: `Test photo ${index}`, parkReference: parks[index].reference,
      thumbnailUrl: `/api/activate-ri-2026/public/media/${id}/thumbnail` };
  });
}

for (const width of [1440, 390, 320]) {
  test(`recap at ${width}px celebrates both sides with provisional results and photo credits`, async ({ page }, testInfo) => {
    const server = await startActivateRiServer();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: 950 });
      await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
      await page.route("**/api/activate-ri-2026/public/park-status", (route) => route.fulfill({ json: snapshot() }));
      await page.route("**/api/activate-ri-2026/public/media?kind=photo&featured=1", (route) => route.fulfill({ json: { ok: true, media: photos(), nextCursor: null } }));
      await page.route("**/api/activate-ri-2026/public/media/*/thumbnail", (route) => route.fulfill({ status: 404 }));
      await page.goto(`${server.origin}/activate-ri-2026/`);
      const recap = page.locator("[data-event-recap]");
      await expect(recap).toBeVisible();
      await expect(recap.getByRole("heading", { level: 1 })).toHaveText("We did it!! Thank you!!");
      await expect(recap.getByRole("heading", { name: "To our activators" })).toBeVisible();
      await expect(recap.getByRole("heading", { name: "To our hunters" })).toBeVisible();
      await expect(page.locator("[data-event-participation]")).toBeHidden();
      await expect(recap.locator('[data-recap-stat="parks"]')).toHaveText("1 / 61");
      await expect(recap.locator('[data-recap-stat="activations"]')).toHaveText("1");
      await expect(recap.locator('[data-recap-stat="callsigns"]')).toHaveText("1");
      await expect(recap.locator('[data-recap-stat="qsos"]')).toHaveText("100");
      await expect(recap.locator("[data-recap-status]")).toContainText("Sep 14, 2026");
      await expect(recap.locator("[data-recap-status]")).not.toContainText("Sep 15");
      await expect(recap).toContainText("results are provisional");
      await expect(recap).not.toContainText("2027");
      const images = recap.locator("[data-recap-photo-grid] figure");
      await expect(images).toHaveCount(3);
      for (const callsign of ["W1AW", "N1TEST", "K1TEST"]) {
        await expect(images.filter({ hasText: callsign })).toHaveCount(1);
      }
      for (const image of await images.all()) {
        await expect(image.getByRole("link")).toHaveAttribute("href", /mediaId=00000000-0000-4000-8000-00000000000[0-3]/);
      }
      await recap.getByText("About these numbers", { exact: true }).click();
      await expect(recap).toContainText("not a count of unique contacts");
      await recap.getByText("Activator callsigns in the logs", { exact: true }).click();
      await expect(recap.locator("[data-recap-callsigns]")).toHaveText("W1AW");
      await expect(page.getByRole("navigation", { name: "Activate All RI navigation" }).getByRole("link", { name: "Recap", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Hunter checklist", exact: false })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Spot archive", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`recap-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
    } finally { await server.stop(); }
  });
}

test("recap keeps last good data on refresh failure and accepts late logs", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
    let fail = false;
    const data = snapshot();
    await page.route("**/api/activate-ri-2026/public/park-status", (route) => fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: data }));
    await page.route("**/api/activate-ri-2026/public/media?kind=photo&featured=1", (route) => route.fulfill({ json: { ok: true, media: [], nextCursor: null } }));
    await page.goto(`${server.origin}/activate-ri-2026/`);
    await expect(page.locator('[data-recap-stat="qsos"]')).toHaveText("100");
    await page.getByText("About these numbers", { exact: true }).click();
    fail = true;
    await page.clock.runFor(60_000);
    await expect(page.locator("[data-recap-status]")).toContainText("latest refresh failed");
    await expect(page.locator('[data-recap-stat="qsos"]')).toHaveText("100");
    fail = false;
    data.parks[0].confirmations[0].totalQsos = 125;
    data.parks[0].confirmations[0].qsosPhone = 85;
    await page.clock.runFor(60_000);
    await expect(page.locator('[data-recap-stat="qsos"]')).toHaveText("125");
    await expect(page.locator("[data-recap-status]")).not.toContainText("latest refresh failed");
    await expect(page.locator(".recap-method")).toHaveAttribute("open", "");
  } finally { await server.stop(); }
});

test("recap distinguishes unavailable data from zero and keeps gallery links usable", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
    await page.route("**/api/activate-ri-2026/public/park-status", (route) => route.fulfill({ status: 503 }));
    await page.route("**/api/activate-ri-2026/public/media?kind=photo&featured=1", (route) => route.fulfill({ status: 503 }));
    await page.goto(`${server.origin}/activate-ri-2026/`);
    await expect(page.locator("[data-recap-status]")).toContainText("temporarily unavailable");
    await expect(page.locator('[data-recap-stat="qsos"]')).toHaveText("—");
    await expect(page.locator("[data-recap-modes]")).toBeHidden();
    await expect(page.locator("[data-recap-photo-status]")).toContainText("preview couldn’t load");
    await expect(page.getByRole("link", { name: "See all photos", exact: false })).toHaveAttribute("href", "/activate-ri-2026/media/");
  } finally { await server.stop(); }
});

test("the thank-you and archive links work without JavaScript", async ({ browser }) => {
  const server = await startActivateRiServer();
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${server.origin}/activate-ri-2026/`);
    await expect(page.locator("[data-event-recap]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "We did it!! Thank you!!" })).toBeVisible();
    await expect(page.locator("[data-event-participation]")).toBeHidden();
    await expect(page.getByRole("link", { name: "Browse the 2026 schedule", exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Join the RI POTA conversation", exact: true })).toBeVisible();
  } finally { await context.close(); await server.stop(); }
});
