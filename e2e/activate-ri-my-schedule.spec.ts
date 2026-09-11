import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

const session = { signedIn: true, activator: { callsign: "N1RI" } };
const baseStop = {
  parkReference: "US-0513", plannedDate: "2026-09-12", startTime: "13:00", endTime: "15:00",
  bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "scheduled",
};
const stops = [
  { ...baseStop, id: "other-w1aw", activatorCallsign: "W1AW" },
  { ...baseStop, id: "my-first-stop", activatorCallsign: "N1RI" },
  { ...baseStop, id: "other-k1abc", activatorCallsign: "K1ABC" },
  {
    ...baseStop, id: "my-second-stop", activatorCallsign: "N1RI", parkReference: "US-0514",
    plannedDate: "2026-09-13", bands: ["40m"], modes: ["CW"],
  },
];

test("My schedule is visible above More filters and shares the activator filter across controls, links, and history", async ({ page, browser }, testInfo) => {
  const server = await startActivateRiServer();
  const recipient = await browser.newContext();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/auth/session", route => route.fulfill({ json: session }));
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?source=club#schedule`);

    const mine = page.getByRole("checkbox", { name: /My schedule/ });
    const activator = page.locator('[data-filter="activator"]');
    const more = page.locator("[data-schedule-more-filters]");
    const rows = page.locator("[data-filter-row]:visible");
    await expect(rows).toHaveCount(4);
    await expect(mine).toBeVisible();
    await expect(mine).not.toBeChecked();
    await expect(activator).toHaveValue("all");
    await expect(activator.locator("option")).toHaveText(["Any activator", "N1RI", "K1ABC", "W1AW"]);
    await expect(more).not.toHaveAttribute("open", "");
    await expect(more.locator("[data-my-schedule]")).toHaveCount(0);
    const mineBounds = await page.locator("[data-my-schedule-wrap]").boundingBox();
    const moreBounds = await more.boundingBox();
    expect(mineBounds!.y + mineBounds!.height).toBeLessThanOrEqual(moreBounds!.y);

    const initialUrl = page.url();
    const initialHistoryLength = await page.evaluate(() => history.length);
    await mine.check();
    await expect(rows).toHaveCount(2);
    await expect(activator).toHaveValue("N1RI");
    expect(new URL(page.url()).searchParams.get("activator")).toBe("N1RI");
    expect(new URL(page.url()).searchParams.has("mine")).toBe(false);
    expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);
    await expect(mine).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("my-schedule-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("my-schedule-desktop.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await mine.uncheck();
    await expect(activator).toHaveValue("all");
    await expect(rows).toHaveCount(4);
    await expect(page).toHaveURL(initialUrl);
    await page.goBack();
    await expect(mine).toBeChecked();
    await expect(rows).toHaveCount(2);
    await page.goForward();
    await expect(mine).not.toBeChecked();
    await expect(rows).toHaveCount(4);
    await activator.selectOption("N1RI");
    await expect(mine).toBeChecked();
    await activator.selectOption("W1AW");
    await expect(mine).not.toBeChecked();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("W1AW");
    await mine.check();
    await expect(activator).toHaveValue("N1RI");

    await page.locator('[data-filter="timeline"]').selectOption("2026-09-13");
    await page.locator('[data-filter="mode"]').selectOption("CW");
    await page.locator('[data-filter="band"]').selectOption("40m");
    await page.locator("[data-timezone]").selectOption("utc");
    await page.locator("[data-schedule-search]").fill("US-0514");
    await expect(rows).toHaveCount(1);
    const selectedUrl = page.url();
    expect(Object.fromEntries(new URL(selectedUrl).searchParams)).toEqual({
      source: "club", activator: "N1RI", timeline: "2026-09-13", mode: "CW", band: "40m",
      timezone: "utc", q: "US-0514",
    });
    expect(new URL(selectedUrl).hash).toBe("#schedule");
    await page.getByRole("button", { name: "Share agenda", exact: true }).click();
    const sharedUrl = await page.locator("[data-schedule-share-url]").inputValue();
    expect(new URL(sharedUrl).searchParams.get("activator")).toBe("N1RI");
    expect(new URL(sharedUrl).searchParams.has("mine")).toBe(false);
    const other = await recipient.newPage();
    await other.route("**/api/auth/session", route => route.fulfill({ json: { signedIn: false } }));
    await other.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
    await other.goto(sharedUrl);
    await expect(other.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(other.locator("[data-filter-row]:visible")).toContainText("US-0514");
    await expect(other.locator('[data-filter="activator"]')).toHaveValue("N1RI");
    await expect(other.locator("[data-my-schedule-wrap]")).toBeHidden();

    await page.reload();
    await expect(mine).toBeChecked();
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(selectedUrl);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(mine).not.toBeChecked();
    await expect(activator).toHaveValue("all");
    await expect(rows).toHaveCount(4);
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ source: "club", timezone: "utc" });
    expect(new URL(page.url()).hash).toBe("#schedule");
    await page.goBack();
    await expect(mine).toBeChecked();
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(selectedUrl);
  } finally {
    await recipient.close();
    await server.stop();
  }
});

test("a late signed-in session does not overwrite an activator selection or add history", async ({ page }) => {
  const server = await startActivateRiServer();
  let releaseSession!: () => void;
  const sessionReady = new Promise<void>(resolve => { releaseSession = resolve; });
  try {
    await page.route("**/api/auth/session", async route => {
      await sessionReady;
      await route.fulfill({ json: session });
    });
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
    const sessionRequest = page.waitForRequest("**/api/auth/session");
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?activator=N1RI`, { waitUntil: "domcontentloaded" });
    await sessionRequest;
    const activator = page.locator('[data-filter="activator"]');
    const mine = page.locator("[data-my-schedule]");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    await expect(mine).toBeHidden();
    await activator.selectOption("W1AW");
    const selectedUrl = page.url();
    const historyLength = await page.evaluate(() => history.length);
    releaseSession();
    await expect(mine).toBeVisible();
    await expect(mine).not.toBeChecked();
    await expect(activator).toHaveValue("W1AW");
    await expect(activator.locator("option")).toHaveText(["Any activator", "N1RI", "K1ABC", "W1AW"]);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page).toHaveURL(selectedUrl);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await page.goBack();
    await expect(mine).toBeChecked();
    await expect(activator).toHaveValue("N1RI");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
  } finally {
    releaseSession();
    await server.stop();
  }
});

test("My schedule stays selected when late or reloaded plans contain no stops for that activator", async ({ page }) => {
  const server = await startActivateRiServer();
  let releaseStops!: () => void;
  const stopsReady = new Promise<void>(resolve => { releaseStops = resolve; });
  try {
    await page.route("**/api/auth/session", route => route.fulfill({ json: session }));
    await page.route("**/api/activate-ri-2026/public/stops", async route => {
      await stopsReady;
      await route.fulfill({ json: { ok: true, stops: stops.filter(stop => stop.activatorCallsign !== "N1RI") } });
    });
    await page.goto(`${server.origin}/activate-ri-2026/schedule/`, { waitUntil: "domcontentloaded" });
    const mine = page.locator("[data-my-schedule]");
    const activator = page.locator('[data-filter="activator"]');
    await expect(mine).toBeVisible();
    await mine.check();
    await expect(activator).toHaveValue("N1RI");
    const selectedUrl = page.url();
    releaseStops();
    await expect(page.locator("[data-schedule-loaded]")).toContainText("Schedule loaded");
    await expect(activator.locator("option")).toHaveText(["Any activator", "N1RI", "K1ABC", "W1AW"]);
    await expect(mine).toBeChecked();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(0);
    await expect(page.locator("[data-filter-empty]")).toBeVisible();
    await expect(page).toHaveURL(selectedUrl);
    await page.reload();
    await expect(mine).toBeChecked();
    await expect(activator).toHaveValue("N1RI");
    await expect(activator.locator('option[value="N1RI"]')).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(0);
    await mine.uncheck();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    expect(new URL(page.url()).searchParams.has("activator")).toBe(false);
  } finally {
    releaseStops();
    await server.stop();
  }
});

test("signed-out, non-activator, and unavailable sessions keep the ordinary alphabetical activator list", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
    for (const response of [
      { json: { signedIn: false } },
      { json: { signedIn: true, activator: null } },
      { status: 503, body: "Synthetic session outage" },
    ]) {
      await page.route("**/api/auth/session", route => route.fulfill(response));
      const sessionResponse = page.waitForResponse("**/api/auth/session");
      await page.goto(`${server.origin}/activate-ri-2026/schedule/`);
      await sessionResponse;
      await expect(page.locator("[data-filter-row]:visible")).toHaveCount(4);
      await expect(page.locator("[data-my-schedule-wrap]")).toBeHidden();
      await expect(page.locator('[data-filter="activator"] option')).toHaveText(["Any activator", "K1ABC", "N1RI", "W1AW"]);
      await expect(page.locator('[data-filter="activator"]')).toHaveValue("all");
      await page.unroute("**/api/auth/session");
    }
  } finally {
    await server.stop();
  }
});
