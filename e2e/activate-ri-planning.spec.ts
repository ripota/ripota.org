import { expect, test, type Page } from "@playwright/test";
import { references } from "@ripota/parks";
import type { PublicActivationStop } from "../src/lib/activate-ri/types";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

function stop(id: string, parkReference: string, activatorCallsign: string, overrides: Partial<PublicActivationStop> = {}): PublicActivationStop {
  return {
    id, parkReference, activatorCallsign,
    plannedDate: "2026-09-11", startTime: "13:00", endTime: "15:00",
    bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "scheduled", ...overrides,
  };
}

const planningStops = [
  stop("block-first", "US-0513", "N1RI", { publicNotes: "North end picnic tables" }),
  stop("block-duplicate", "US-0513", "n1ri"),
  stop("block-second", "US-0513", "N1RI", { plannedDate: "2026-09-12", startTime: "15:00", endTime: "17:00" }),
  stop("chafee-first", "US-0514", "N1RI"),
  stop("chafee-second", "US-0514", "W1AW", { status: "delayed", bands: ["40m"], modes: ["CW"] }),
  stop("ninigret-first", "US-0515", "K1XYZ", { plannedDate: "2026-09-12" }),
  stop("sachuest-cancelled", "US-0516", "N1RI", { status: "cancelled" }),
  stop("trustom-completed", "US-0517", "N1RI", { status: "completed" }),
  stop("sample-roger", "US-0789", "N1RI"),
];

async function mockPlanning(page: Page, callsign?: string): Promise<void> {
  await page.clock.install({ time: new Date("2026-09-06T12:00:00Z") });
  await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: planningStops } }));
  await page.route("**/api/auth/session", route => route.fulfill({
    json: callsign
      ? { ok: true, signedIn: true, user: { id: "planning-user", email: "planning@example.invalid" }, activator: { callsign } }
      : { ok: true, signedIn: false },
  }));
}

function parkRow(page: Page, reference: string) {
  return page.locator(`[data-live-coverage] [data-filter-row][data-park-reference="${reference}"]`);
}

test("park planning compares distinct activators and time slots and expands existing plans", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page);
    await page.goto(`${server.origin}/activate-ri-2026/parks/?coverage=needed`);
    const rows = page.locator("[data-live-coverage] [data-filter-row]:visible");
    await expect(rows).toHaveCount(references.length);
    await expect(page.locator('[data-filter="sort"]')).toHaveValue("activators");
    await expect(parkRow(page, "US-0513").locator("summary")).toHaveText("1 activator · 2 time slots");
    await expect(parkRow(page, "US-0514").locator("summary")).toHaveText("2 activators · 1 time slot");
    await expect(parkRow(page, "US-0515").locator("summary")).toHaveText("1 activator · 1 time slot");
    for (const reference of ["US-0516", "US-0517", "US-0789"]) {
      await expect(parkRow(page, reference)).toContainText("0 activators · 0 time slots");
    }
    await expect(rows.nth(references.length - 3)).toHaveAttribute("data-park-reference", "US-0515");
    await expect(rows.nth(references.length - 2)).toHaveAttribute("data-park-reference", "US-0513");
    await expect(rows.last()).toHaveAttribute("data-park-reference", "US-0514");
    await page.locator('[data-filter="sort"]').selectOption("slots");
    await expect(rows.last()).toHaveAttribute("data-park-reference", "US-0513");
    await expect(rows.nth(references.length - 2)).toHaveAttribute("data-park-reference", "US-0514");
    await page.locator('[data-filter="sort"]').selectOption("name");
    await expect(rows).toHaveCount(references.length);
    expect(await rows.evaluateAll(items => items.map(item => item.getAttribute("data-park-reference")))).toEqual(
      [...references].sort((left, right) => left.name.localeCompare(right.name)).map(park => park.reference),
    );

    const block = parkRow(page, "US-0513");
    await expect(block.locator("details")).not.toHaveAttribute("open", "");
    await expect(block.getByText("North end picnic tables", { exact: true })).toBeHidden();
    await block.locator("summary").click();
    await expect(block.getByText("North end picnic tables", { exact: true })).toBeVisible();
    await expect(block.locator("details")).toContainText("N1RI");
    await expect(block.locator("details")).toContainText("20m");
    await expect(block.locator("details")).toContainText("SSB");
    await expect(block.locator("details")).toContainText("Sep 11");
    await expect(block.locator("details")).toContainText("Sep 12");
    await expect(rows.getByRole("link", { name: "Add an activation", exact: true })).toHaveCount(references.length);
    await expect(block.getByRole("link", { name: "Add an activation", exact: true })).toHaveAttribute("href", "/activate-ri-2026/volunteer/?park=US-0513");
  } finally {
    await server.stop();
  }
});

test("event day and county filters retain parks with no matching plans and carry the chosen date", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`${server.origin}/activate-ri-2026/parks/`);
    const rows = page.locator("[data-live-coverage] [data-filter-row]:visible");
    await expect(rows).toHaveCount(references.length);
    await page.locator('[data-filter="timeline"]').selectOption("2026-09-11");
    await expect(rows).toHaveCount(references.length);
    await expect(parkRow(page, "US-0515")).toBeVisible();
    await expect(parkRow(page, "US-0515")).toContainText("0 activators · 0 time slots");
    await expect(parkRow(page, "US-0513").locator("summary")).toHaveText("1 activator · 1 time slot");
    await page.locator('[data-filter="county"]').selectOption("Washington County");
    await expect(rows).toHaveCount(references.filter(park => park.counties?.includes("Washington County")).length);
    await expect(parkRow(page, "US-0515")).toBeVisible();
    await expect(parkRow(page, "US-0516")).toBeHidden();
    await expect(parkRow(page, "US-0515").getByRole("link", { name: "Add an activation", exact: true })).toHaveAttribute("href", "/activate-ri-2026/volunteer/?park=US-0515&date=2026-09-11");
    await expect(page.locator("[data-planning-status]")).toContainText("Washington County");
    await expect(page.locator("[data-planning-status]")).toContainText("Sep 11");
    await parkRow(page, "US-0513").locator("summary").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(page.locator('[data-filter="timeline"]')).toHaveValue("2026-09-11");
    await expect(page.locator('[data-filter="county"]')).toHaveValue("Washington County");
    await expect(parkRow(page, "US-0515")).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("My parks keeps the activator's event parks while counts include everyone's selected-day plans", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page, "n1ri");
    await page.goto(`${server.origin}/activate-ri-2026/parks/`);
    const myParks = page.getByRole("checkbox", { name: "My parks", exact: true });
    await expect(myParks).toBeEnabled();
    await myParks.check();
    const rows = page.locator("[data-live-coverage] [data-filter-row]:visible");
    await expect(rows).toHaveCount(2);
    await expect(parkRow(page, "US-0514").locator("summary")).toHaveText("2 activators · 1 time slot");
    await expect(parkRow(page, "US-0515")).toBeHidden();
    await page.locator('[data-filter="timeline"]').selectOption("2026-09-12");
    await expect(rows).toHaveCount(2);
    await expect(parkRow(page, "US-0514")).toBeVisible();
    await expect(parkRow(page, "US-0514")).toContainText("0 activators · 0 time slots");
    await expect(parkRow(page, "US-0514").getByRole("link", { name: "Add an activation", exact: true })).toHaveAttribute("href", "/activate-ri-2026/activator/plan/?park=US-0514&date=2026-09-12");
    await expect(page.locator("[data-planning-status]")).toContainText(/2 (of your )?parks/);
    await myParks.uncheck();
    await expect(rows).toHaveCount(references.length);
  } finally {
    await server.stop();
  }
});

test("My parks explains sign-in and the empty state for an activator with no published parks", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page);
    await page.goto(`${server.origin}/activate-ri-2026/parks/?mine=1&timeline=2026-09-12`);
    const myParks = page.getByRole("checkbox", { name: "My parks", exact: true });
    await expect(page.getByRole("link", { name: "Sign in to see my parks", exact: true })).toBeVisible();
    await expect(myParks).toBeChecked();
    await expect(myParks).toBeEnabled();
    await expect(page.locator("[data-live-coverage] [data-filter-row]:visible")).toHaveCount(0);
    await myParks.uncheck();
    await expect(myParks).toBeDisabled();
    await expect(page.getByRole("link", { name: "Sign in to see my parks", exact: true })).toBeVisible();
    await expect(page.locator("[data-live-coverage] [data-filter-row]:visible")).toHaveCount(references.length);
    await page.route("**/api/auth/session", route => route.fulfill({ json: {
      ok: true, signedIn: true, user: { id: "account-only", email: "account@example.invalid" }, activator: null,
    } }));
    await page.goto(`${server.origin}/activate-ri-2026/parks/?mine=1&timeline=2026-09-12`);
    await expect(myParks).toBeChecked();
    await expect(myParks).toBeEnabled();
    await expect(page.getByRole("link", { name: "Sign in to see my parks", exact: true })).toBeHidden();
    await myParks.uncheck();
    await expect(myParks).toBeDisabled();
    await expect(page.locator("[data-live-coverage] [data-filter-row]:visible")).toHaveCount(references.length);
    await page.route("**/api/auth/session", route => route.fulfill({ json: {
      ok: true, signedIn: true, user: { id: "empty-planning-user", email: "empty@example.invalid" }, activator: { callsign: "K1EMPTY" },
    } }));
    await page.reload();
    await expect(myParks).toBeEnabled();
    await myParks.check();
    await expect(page.locator("[data-live-coverage] [data-filter-row]:visible")).toHaveCount(0);
    await expect(page.locator("[data-planning-status]")).toContainText(/0 (of your )?parks/);
    await expect(page.locator("[data-live-coverage]")).toContainText("No published scheduled parks in your plan match these filters.");
    await myParks.uncheck();
    await expect(page.locator("[data-live-coverage] [data-filter-row]:visible")).toHaveCount(references.length);
  } finally {
    await server.stop();
  }
});

test("refresh updates counts without dropping selected modes or hiding zero-plan parks", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page);
    let stops = planningStops;
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/parks/?mode=SSB&timeline=2026-09-11&county=Washington+County`);
    const mode = page.locator('[data-filter="mode"]');
    const rows = page.locator("[data-live-coverage] [data-filter-row]:visible");
    const countyParkCount = references.filter(park => park.counties?.includes("Washington County")).length;
    await expect(mode).toHaveValue("SSB");
    await expect(rows).toHaveCount(countyParkCount);
    await expect(parkRow(page, "US-0514").locator("summary")).toHaveText("1 activator · 1 time slot");
    const filteredUrl = page.url();
    stops = [];
    const reloaded = page.waitForRequest(request => request.url().endsWith("/api/activate-ri-2026/public/stops")
      && request.headers()["cache-control"] === "no-cache");
    await page.getByRole("button", { name: "Refresh plans", exact: true }).click();
    await reloaded;
    await expect(parkRow(page, "US-0514").locator("summary")).toHaveText("0 activators · 0 time slots");
    await expect(rows).toHaveCount(countyParkCount);
    await expect(mode).toHaveValue("SSB");
    await expect(page.locator('[data-filter="timeline"]')).toHaveValue("2026-09-11");
    await expect(page.locator('[data-filter="county"]')).toHaveValue("Washington County");
    await expect(page).toHaveURL(filteredUrl);
    await expect(page.locator("[data-planning-status]")).toContainText("SSB");
    await expect(page.getByRole("button", { name: "Refresh plans", exact: true })).toBeEnabled();
  } finally {
    await server.stop();
  }
});

test("a failed schedule request does not portray all parks as having zero activators", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page);
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ status: 503 }));
    await page.goto(`${server.origin}/activate-ri-2026/parks/`);
    await expect(page.locator("[data-live-coverage]").getByText("Live coverage is unavailable.", { exact: false })).toBeVisible();
    await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(0);
    await expect(page.locator("[data-live-coverage]")).not.toContainText("0 activators");
  } finally {
    await server.stop();
  }
});
