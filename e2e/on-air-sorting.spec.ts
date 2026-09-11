import { expect, test as base, type Page } from "@playwright/test";
import type { LivePotaSpot } from "../src/lib/pota/spots";
import { startActivateRiServer } from "./helpers/activate-ri-server";

const checkedAt = "2026-09-11T12:04:00Z";
const initialSpots: LivePotaSpot[] = [
  spot("US-0513", "Alpha National Wildlife Refuge", "W1ZZZ", "7050.0", "SSB", "12:02", "W1AAA", "Alpha"),
  spot("US-0514", "Bravo National Wildlife Refuge", "K1AAA", "14045", "CW", "12:01", "W1BBB", "Bravo"),
  spot("US-0515", "Charlie National Wildlife Refuge", "N1MMM", "5357", "FT8", "12:03", "W1CCC", "Charlie"),
];
const defaultOrder = ["N1MMM", "W1ZZZ", "K1AAA"];
type Column = "park" | "activator" | "frequency" | "mode" | "spotted" | "source";
type Direction = "asc" | "desc";
type Feed = { spots: LivePotaSpot[] };

const test = base.extend<{ feed: Feed }, { onAirOrigin: string }>({
  onAirOrigin: [async ({}, use) => {
    const server = await startActivateRiServer();
    try { await use(server.origin); } finally { await server.stop(); }
  }, { scope: "worker" }],
  feed: async ({ context }, use) => {
    const feed = { spots: structuredClone(initialSpots) };
    await context.route("**/api/pota/spots", route => route.fulfill({
      json: { ok: true, spots: feed.spots, generatedAt: checkedAt, stale: false },
    }));
    await context.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, signedIn: false } }));
    await context.route("**/api/activate-ri-2026/public/park-status", route => route.fulfill({ status: 503 }));
    await context.route("**/api/analytics/events", route => route.fulfill({ status: 202, json: { ok: true } }));
    await use(feed);
  },
});

test.setTimeout(60_000);
test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page, feed }) => {
  await page.clock.install({ time: new Date(checkedAt) });
  expect(feed.spots).toHaveLength(3);
});

test("the full live table separates frequency and mode and sorts every column in both directions", async ({ page, onAirOrigin }) => {
  await page.goto(`${onAirOrigin}/on-air/`);
  const table = page.getByRole("table", { name: "On air now" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(6);
  await expect(table.getByRole("columnheader")).toHaveText([
    /Park/, /Activator/, /Frequency/, /Mode/, /Spotted/, /Source/,
  ]);
  await expectOrder(page, defaultOrder);
  await expectSort(page, "spotted", "desc");
  const firstRow = page.locator("[data-on-air-list] tr").first();
  await expect(firstRow.locator("td")).toHaveCount(6);
  await expect(firstRow.locator("td").nth(2)).toHaveText("5357 kHz");
  await expect(firstRow.locator("td").nth(3)).toHaveText("FT8");

  const cases: { column: Column; label: string; ascending: string[] }[] = [
    { column: "park", label: "Park", ascending: ["W1ZZZ", "K1AAA", "N1MMM"] },
    { column: "activator", label: "Activator", ascending: ["K1AAA", "N1MMM", "W1ZZZ"] },
    { column: "frequency", label: "Frequency", ascending: ["N1MMM", "W1ZZZ", "K1AAA"] },
    { column: "mode", label: "Mode", ascending: ["K1AAA", "N1MMM", "W1ZZZ"] },
    { column: "spotted", label: "Spotted", ascending: ["K1AAA", "W1ZZZ", "N1MMM"] },
    { column: "source", label: "Source", ascending: ["W1ZZZ", "K1AAA", "N1MMM"] },
  ];
  for (const { column, label, ascending } of cases) {
    const firstDirection = column === "spotted" ? "desc" : "asc";
    const button = table.getByRole("button", { name: `Sort by ${label}`, exact: true });
    await button.click();
    await expectSort(page, column, firstDirection);
    await expectOrder(page, firstDirection === "asc" ? ascending : [...ascending].reverse());
    await button.click();
    await expectSort(page, column, firstDirection === "asc" ? "desc" : "asc");
    await expectOrder(page, firstDirection === "asc" ? [...ascending].reverse() : ascending);
  }
});

test("sortable column headers work with the keyboard and keep focus", async ({ page, onAirOrigin }) => {
  await page.goto(`${onAirOrigin}/on-air/`);
  await expectOrder(page, defaultOrder);
  const frequency = page.getByRole("button", { name: "Sort by Frequency", exact: true });
  await frequency.focus();
  await page.keyboard.press("Enter");
  await expectSort(page, "frequency", "asc");
  await expectOrder(page, ["N1MMM", "W1ZZZ", "K1AAA"]);
  await expect(frequency).toBeFocused();
  await page.keyboard.press("Space");
  await expectSort(page, "frequency", "desc");
  await expectOrder(page, ["K1AAA", "W1ZZZ", "N1MMM"]);
  await expect(frequency).toBeFocused();
});

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport });

    test("sorting survives sharing, reload, history, and reset without losing unrelated URL state", async ({ page, context, onAirOrigin }, testInfo) => {
      const originalUrl = `${onAirOrigin}/on-air/?source=club&source=email#on-air-now-title`;
      await page.goto(originalUrl);
      await expectOrder(page, defaultOrder);
      const mobileSort = page.getByRole("combobox", { name: "Sort live spots" });
      if (viewport.name === "mobile") {
        await expect(mobileSort).toBeVisible();
        await expect(mobileSort.locator("option")).toHaveCount(12);
      }
      await chooseSort(page, viewport.name, "frequency", "asc");
      await expectSort(page, "frequency", "asc");
      await expectOrder(page, ["N1MMM", "W1ZZZ", "K1AAA"]);
      const frequencyUrl = page.url();
      await chooseSort(page, viewport.name, "mode", "asc");
      await expectOrder(page, ["K1AAA", "N1MMM", "W1ZZZ"]);
      const ascendingModeUrl = page.url();
      await chooseSort(page, viewport.name, "mode", "desc");
      await expectSort(page, "mode", "desc");
      await expectOrder(page, ["W1ZZZ", "N1MMM", "K1AAA"]);
      const sharedUrl = page.url();
      expect(new URL(sharedUrl).searchParams.get("sort")).toBe("mode");
      expect(new URL(sharedUrl).searchParams.has("direction")).toBe(false);
      expect(new URL(sharedUrl).searchParams.getAll("source")).toEqual(["club", "email"]);
      expect(new URL(sharedUrl).hash).toBe("#on-air-now-title");

      await page.goBack();
      await expect(page).toHaveURL(ascendingModeUrl);
      await expectSort(page, "mode", "asc");
      await expectOrder(page, ["K1AAA", "N1MMM", "W1ZZZ"]);
      await page.goBack();
      await expect(page).toHaveURL(frequencyUrl);
      await expectSort(page, "frequency", "asc");
      await expectOrder(page, ["N1MMM", "W1ZZZ", "K1AAA"]);
      await page.goForward();
      await page.goForward();
      await expect(page).toHaveURL(sharedUrl);
      await page.reload();
      await expectSort(page, "mode", "desc");
      await expectOrder(page, ["W1ZZZ", "N1MMM", "K1AAA"]);

      const sharedPage = await context.newPage();
      try {
        await sharedPage.goto(sharedUrl);
        await expectSort(sharedPage, "mode", "desc");
        await expectOrder(sharedPage, ["W1ZZZ", "N1MMM", "K1AAA"]);
      } finally {
        await sharedPage.close();
      }

      await page.getByRole("button", { name: "Reset sort", exact: true }).click();
      await expect(page).toHaveURL(originalUrl);
      await expectSort(page, "spotted", "desc");
      await expectOrder(page, defaultOrder);
      await page.goBack();
      await expect(page).toHaveURL(sharedUrl);
      await expectSort(page, "mode", "desc");
      await expectOrder(page, ["W1ZZZ", "N1MMM", "K1AAA"]);
      await page.locator("[data-on-air-now]").scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const screenshot = testInfo.outputPath(`on-air-sorting-${viewport.name}.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach(`on-air-sorting-${viewport.name}`, { path: screenshot, contentType: "image/png" });
    });
  });
}

test("invalid and explicit default sort parameters are canonicalized", async ({ page, onAirOrigin }) => {
  const cleanUrl = `${onAirOrigin}/on-air/?source=club#on-air-now-title`;
  for (const parameters of ["sort=unknown&direction=sideways", "sort=spotted&direction=desc"]) {
    await page.goto(`${onAirOrigin}/on-air/?${parameters}&source=club#on-air-now-title`);
    await expectOrder(page, defaultOrder);
    await expectSort(page, "spotted", "desc");
    await expect(page).toHaveURL(cleanUrl);
  }
});

test("live refresh preserves the chosen sort through an empty feed and returning spots", async ({ page, feed, onAirOrigin }) => {
  const sharedUrl = `${onAirOrigin}/on-air/?sort=frequency&direction=asc`;
  await page.goto(sharedUrl);
  await expectOrder(page, ["N1MMM", "W1ZZZ", "K1AAA"]);
  feed.spots = [
    { ...initialSpots[1], frequency: "3500" },
    { ...initialSpots[0], frequency: "28060" },
  ];
  await page.clock.runFor(30_000);
  await expectOrder(page, ["K1AAA", "W1ZZZ"]);
  await expectSort(page, "frequency", "asc");
  await expect(page).toHaveURL(sharedUrl);

  feed.spots = [];
  await page.clock.runFor(30_000);
  await expect(page.locator("[data-on-air-list] tr")).toHaveCount(0);
  await expect(page.locator("[data-on-air-empty]")).toBeVisible();
  await expect(page.locator("[data-on-air-sort-select]")).toHaveValue("frequency:asc");
  await expect(page).toHaveURL(sharedUrl);

  feed.spots = [...initialSpots].reverse();
  await page.clock.runFor(30_000);
  await expectOrder(page, ["N1MMM", "W1ZZZ", "K1AAA"]);
  await expectSort(page, "frequency", "asc");
  await expect(page).toHaveURL(sharedUrl);
});

test("homepage keeps its compact live list and ignores full-view sort parameters", async ({ page, onAirOrigin }) => {
  const url = `${onAirOrigin}/?sort=frequency&direction=asc`;
  await page.goto(url);
  const panel = page.locator(".on-air-now--compact");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-on-air-list] > li .on-air-now__activator")).toHaveText(initialSpots.map(spot => spot.activatorCallsign));
  await expect(panel.locator("[data-on-air-sort]")).toHaveCount(0);
  await expect(panel.locator("[data-on-air-sort-select]")).toHaveCount(0);
  await expect(panel.getByRole("table")).toHaveCount(0);
  await expect(panel.locator(".on-air-now__radio").first()).toHaveText("7050 kHz · SSB");
  await expect(page).toHaveURL(url);
});

async function expectOrder(page: Page, callsigns: string[]): Promise<void> {
  await expect(page.locator("[data-on-air-list] tr .on-air-now__activator")).toHaveText(callsigns);
}

async function expectSort(page: Page, column: Column, direction: Direction): Promise<void> {
  await expect(page.locator(`[data-on-air-sort-column="${column}"]`)).toHaveAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
  await expect(page.locator("[data-on-air-sort-column][aria-sort]")).toHaveCount(1);
  await expect(page.locator("[data-on-air-sort-select]")).toHaveValue(`${column}:${direction}`);
  const params = new URL(page.url()).searchParams;
  expect(params.get("sort")).toBe(column === "spotted" ? null : column);
  expect(params.get("direction")).toBe(direction === "desc" ? null : direction);
}

async function chooseSort(page: Page, viewport: string, column: Column, direction: Direction): Promise<void> {
  if (viewport === "mobile") {
    await page.getByRole("combobox", { name: "Sort live spots" }).selectOption(`${column}:${direction}`);
  } else {
    await page.locator(`[data-on-air-sort="${column}"]`).click();
  }
}

function spot(reference: string, name: string, callsign: string, frequency: string, mode: string, time: string, spotter: string, source: string): LivePotaSpot {
  return {
    id: reference,
    parkReference: reference,
    parkName: name,
    activatorCallsign: callsign,
    frequency,
    mode,
    spotTime: `2026-09-11T${time}:00Z`,
    spotterCallsign: spotter,
    comments: "",
    sourceLabel: source,
    upstreamCount: 1,
    locationDesc: "US-RI",
    expiresInSeconds: 300,
    parkUrl: `https://pota.app/#/park/${reference}`,
    spotsUrl: "https://pota.app/",
  };
}
