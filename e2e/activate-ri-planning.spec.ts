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

async function planningViewSnapshot(page: Page) {
  return page.locator("[data-park-planning]").evaluate(root => ({
    filters: (Array.from(root.querySelectorAll("[data-filter]")) as unknown as HTMLSelectElement[]).map(control => [control.dataset.filter, control.value]),
    moreOpen: root.querySelector<HTMLDetailsElement>(".park-planning-more")?.open,
    rows: Array.from(root.querySelectorAll<HTMLTableRowElement>("[data-filter-row]")).map(row => ({
      park: row.dataset.parkReference,
      count: row.querySelector("summary")?.textContent,
      expanded: row.querySelector<HTMLDetailsElement>("details")?.open,
    })),
  }));
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
    const search = page.locator("[data-planning-search]");
    await search.fill("US-0513");
    await expect(rows).toHaveCount(1);
    await expect(page.locator("[data-planning-status]")).toContainText("1 park matching “US-0513”");
    await page.reload();
    await expect(search).toHaveValue("US-0513");
    await expect(rows).toHaveCount(1);
    await search.fill("no matching park");
    await expect(rows).toHaveCount(0);
    await page.locator("[data-clear-planning]").click();
    await expect(search).toBeFocused();
    await expect(rows).toHaveCount(references.length);
    await expect(page.locator('[data-filter="sort"]')).toHaveValue("activators");
    await page.goBack();
    await expect(search).toHaveValue("no matching park");
    await expect(page.locator('[data-filter="sort"]')).toHaveValue("name");
    await expect(rows).toHaveCount(0);
    await page.goBack();
    await expect(search).toHaveValue("US-0513");
    await expect(rows).toHaveCount(1);
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

test("shared planning URLs reproduce every filter, sort, and disclosure through reload and history", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page);
    await page.goto(`${server.origin}/activate-ri-2026/parks/#park-planning`);
    await expect(parkRow(page, "US-0513").locator("summary")).toHaveText("1 activator · 2 time slots");
    await page.locator('[data-filter="sort"]').selectOption("slots");
    await page.locator('[data-filter="timeline"]').selectOption("2026-09-11");
    await page.locator('[data-filter="county"]').selectOption("Washington County");
    const more = page.locator(".park-planning-more");
    await more.locator("summary").click();
    await page.locator('[data-filter="mode"]').selectOption("SSB");
    await page.locator('[data-filter="band"]').selectOption("20m");
    await parkRow(page, "US-0513").locator("summary").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("expanded")).toBe("US-0513");
    await parkRow(page, "US-0514").locator("summary").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("expanded")).toBe("US-0513,US-0514");
    await more.locator("summary").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("more")).toBe("0");
    const sharedUrl = page.url();
    const params = new URL(sharedUrl).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      sort: "slots", timeline: "2026-09-11", county: "Washington County", mode: "SSB", band: "20m",
      expanded: "US-0513,US-0514", more: "0",
    });
    expect(new URL(sharedUrl).hash).toBe("#park-planning");
    const view = await planningViewSnapshot(page);
    const historyLength = await page.evaluate(() => history.length);
    await page.goBack();
    await expect(more).toHaveAttribute("open", "");
    await expect(parkRow(page, "US-0514").locator("details")).toHaveAttribute("open", "");
    await page.goBack();
    await expect(parkRow(page, "US-0514").locator("details")).not.toHaveAttribute("open", "");
    await expect(parkRow(page, "US-0513").locator("details")).toHaveAttribute("open", "");
    await page.goForward();
    await expect(parkRow(page, "US-0514").locator("details")).toHaveAttribute("open", "");
    await page.goForward();
    await expect(more).not.toHaveAttribute("open", "");
    await expect(page).toHaveURL(sharedUrl);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await expect.poll(() => planningViewSnapshot(page)).toEqual(view);
    await page.reload();
    await expect.poll(() => planningViewSnapshot(page)).toEqual(view);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);

    const recipient = await page.context().newPage();
    await mockPlanning(recipient);
    await recipient.goto(sharedUrl);
    await expect.poll(() => planningViewSnapshot(recipient)).toEqual(view);
    await expect(recipient).toHaveURL(sharedUrl);
    await recipient.close();

    await page.locator('[data-filter="county"]').selectOption("Newport County");
    await expect(parkRow(page, "US-0513")).toBeHidden();
    expect(new URL(page.url()).searchParams.get("expanded")).toBe("US-0513,US-0514");
    await page.goBack();
    await expect.poll(() => planningViewSnapshot(page)).toEqual(view);
  } finally {
    await server.stop();
  }
});

test("fresh shared links preserve bands and modes that have no published stops", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page);
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [] } }));
    await page.goto(`${server.origin}/activate-ri-2026/parks/?sort=name&mode=SSB&band=20m&more=0&expanded=US-0515`);
    const rows = page.locator("[data-live-coverage] [data-filter-row]");
    await expect(rows).toHaveCount(references.length);
    await expect(page.locator('[data-filter="mode"]')).toHaveValue("SSB");
    await expect(page.locator('[data-filter="band"]')).toHaveValue("20m");
    await expect(page.locator(".park-planning-more")).not.toHaveAttribute("open", "");
    await expect(parkRow(page, "US-0515").locator("details")).toHaveAttribute("open", "");
    await expect(parkRow(page, "US-0515").locator("summary")).toHaveText("0 activators · 0 time slots");
    await expect(page.locator("[data-planning-status]")).toContainText("SSB");
    await expect(page.locator("[data-planning-status]")).toContainText("20m");
    const sharedUrl = page.url();
    await page.reload();
    await expect(rows).toHaveCount(references.length);
    await expect(page.locator('[data-filter="mode"]')).toHaveValue("SSB");
    await expect(page.locator('[data-filter="band"]')).toHaveValue("20m");
    await expect(page.locator(".park-planning-more")).not.toHaveAttribute("open", "");
    await expect(page).toHaveURL(sharedUrl);
  } finally {
    await server.stop();
  }
});

test("late schedule and account responses preserve view changes made during loading", async ({ page }) => {
  const server = await startActivateRiServer();
  let releaseStops!: () => void;
  let releaseSession!: () => void;
  const stopsReady = new Promise<void>(resolve => { releaseStops = resolve; });
  const sessionReady = new Promise<void>(resolve => { releaseSession = resolve; });
  try {
    await mockPlanning(page);
    await page.route("**/api/activate-ri-2026/public/stops", async route => {
      await stopsReady;
      await route.fulfill({ json: { ok: true, stops: planningStops } });
    });
    await page.route("**/api/auth/session", async route => {
      await sessionReady;
      await route.fulfill({ json: { ok: true, signedIn: true, activator: { callsign: "K1XYZ" } } });
    });
    await page.goto(`${server.origin}/activate-ri-2026/parks/?activator=N1RI&mode=SSB&band=20m`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-filter="mode"]')).toHaveValue("SSB");
    await expect(page.locator('[data-filter="band"]')).toHaveValue("20m");
    await page.locator('[data-filter="sort"]').selectOption("slots");
    await page.locator('[data-filter="timeline"]').selectOption("2026-09-12");
    await page.locator('[data-filter="county"]').selectOption("Washington County");
    await page.locator('[data-filter="mode"]').selectOption("all");
    await page.locator(".park-planning-more > summary").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("more")).toBe("0");
    const chosenUrl = page.url();
    releaseStops();
    await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(2);
    await expect(parkRow(page, "US-0514").locator("summary")).toHaveText("0 activators · 0 time slots");
    await expect(page).toHaveURL(chosenUrl);
    releaseSession();
    await expect(page.locator("[data-my-parks-label]")).toHaveText("N1RI's parks");
    await expect(page.locator('[data-filter="mode"]')).toHaveValue("all");
    await expect(page.locator('[data-filter="band"]')).toHaveValue("20m");
    await expect(page.locator('[data-filter="sort"]')).toHaveValue("slots");
    await expect(page.locator('[data-filter="timeline"]')).toHaveValue("2026-09-12");
    await expect(page.locator('[data-filter="county"]')).toHaveValue("Washington County");
    await expect(page.locator(".park-planning-more")).not.toHaveAttribute("open", "");
    await expect(page).toHaveURL(chosenUrl);
    await page.reload();
    await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(2);
    await expect(page.locator('[data-filter="mode"]')).toHaveValue("all");
    await expect(page).toHaveURL(chosenUrl);
  } finally {
    releaseStops();
    releaseSession();
    await server.stop();
  }
});

test("an activator's shared park scope shows the same parks and counts for every recipient", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page, "N1RI");
    await page.goto(`${server.origin}/activate-ri-2026/parks/`);
    await page.getByRole("checkbox", { name: "My parks", exact: true }).check();
    await expect.poll(() => new URL(page.url()).searchParams.get("activator")).toBe("N1RI");
    expect(new URL(page.url()).searchParams.has("mine")).toBe(false);
    await page.locator('[data-filter="timeline"]').selectOption("2026-09-11");
    await parkRow(page, "US-0514").locator("summary").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("expanded")).toBe("US-0514");
    const sharedUrl = page.url();
    const original = await planningViewSnapshot(page);
    for (const recipientCallsign of [undefined, "N1RI", "K1XYZ"]) {
      const recipient = await page.context().newPage();
      await mockPlanning(recipient, recipientCallsign);
      await recipient.goto(sharedUrl);
      await expect.poll(() => planningViewSnapshot(recipient)).toEqual(original);
      await expect(parkRow(recipient, "US-0514").locator("summary")).toHaveText("2 activators · 1 time slot");
      await expect(recipient.locator("[data-my-parks-label]")).toHaveText(recipientCallsign === "N1RI" ? "My parks" : "N1RI's parks");
      await expect(recipient.locator("[data-my-parks]")).toBeChecked();
      await expect(recipient).toHaveURL(sharedUrl);
      await recipient.locator("[data-my-parks]").uncheck();
      await expect(recipient.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(references.length);
      await expect(recipient.locator("[data-my-parks-label]")).toHaveText("My parks");
      expect(new URL(recipient.url()).searchParams.has("activator")).toBe(false);
      if (recipientCallsign === "K1XYZ") {
        await recipient.getByRole("checkbox", { name: "My parks", exact: true }).check();
        await expect.poll(() => new URL(recipient.url()).searchParams.get("activator")).toBe("K1XYZ");
        await expect(recipient.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(1);
        await expect(parkRow(recipient, "US-0515")).toBeVisible();
        await expect(parkRow(recipient, "US-0515").locator("summary")).toHaveText("0 activators · 0 time slots");
        await expect(parkRow(recipient, "US-0514")).toBeHidden();
        await recipient.goBack();
        await expect(recipient.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(references.length);
        await recipient.goBack();
        await expect(recipient.locator("[data-my-parks-label]")).toHaveText("N1RI's parks");
        await expect.poll(() => planningViewSnapshot(recipient)).toEqual(original);
        await expect(recipient).toHaveURL(sharedUrl);
      }
      await recipient.close();
    }
  } finally {
    await server.stop();
  }
});

test("legacy My parks links canonicalize the owner while explicit shared owners take precedence", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await mockPlanning(page, " n1ri ");
    await page.goto(`${server.origin}/activate-ri-2026/parks/?mine=1&sort=slots&timeline=2026-09-12&expanded=US-0514`);
    await expect.poll(() => new URL(page.url()).searchParams.get("activator")).toBe("N1RI");
    expect(new URL(page.url()).searchParams.has("mine")).toBe(false);
    await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(2);
    await expect(parkRow(page, "US-0514").locator("details")).toHaveAttribute("open", "");
    await expect(parkRow(page, "US-0514").locator("summary")).toHaveText("0 activators · 0 time slots");
    await expect(page.locator('[data-filter="sort"]')).toHaveValue("slots");
    await expect(page.locator('[data-filter="timeline"]')).toHaveValue("2026-09-12");

    await page.route("**/api/auth/session", route => route.fulfill({ json: {
      ok: true, signedIn: true, activator: { callsign: "K1XYZ" },
    } }));
    await page.goto(`${server.origin}/activate-ri-2026/parks/?activator=n1ri&mine=1&timeline=2026-09-11`);
    await expect.poll(() => new URL(page.url()).searchParams.get("activator")).toBe("N1RI");
    expect(new URL(page.url()).searchParams.has("mine")).toBe(false);
    await expect(page.locator("[data-my-parks-label]")).toHaveText("N1RI's parks");
    await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(2);
    await expect(parkRow(page, "US-0514").locator("summary")).toHaveText("2 activators · 1 time slot");
    await expect(parkRow(page, "US-0515")).toBeHidden();
  } finally {
    await server.stop();
  }
});

test("Back to legacy My parks during refresh waits for the new account before choosing its owner", async ({ page }) => {
  const server = await startActivateRiServer();
  let releaseSession!: () => void;
  const sessionReady = new Promise<void>(resolve => { releaseSession = resolve; });
  let account: "signed-out" | "N1RI" | "K1XYZ" = "signed-out";
  try {
    await mockPlanning(page);
    await page.route("**/api/auth/session", async route => {
      const nextAccount = account;
      if (nextAccount === "K1XYZ") await sessionReady;
      await route.fulfill({ json: nextAccount === "signed-out"
        ? { ok: true, signedIn: false }
        : { ok: true, signedIn: true, activator: { callsign: nextAccount } },
      });
    });
    await page.goto(`${server.origin}/activate-ri-2026/parks/?mine=1`);
    const mine = page.locator("[data-my-parks]");
    const refresh = page.getByRole("button", { name: "Refresh plans", exact: true });
    await expect(page.getByRole("link", { name: "Sign in to see my parks", exact: true })).toBeVisible();
    await mine.uncheck();
    await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(references.length);
    account = "N1RI";
    await refresh.click();
    await expect(page.locator("[data-my-parks-help]")).toContainText("Signed in as N1RI");
    await expect(refresh).toBeEnabled();

    account = "K1XYZ";
    const refreshingSession = page.waitForRequest("**/api/auth/session");
    await refresh.click();
    await refreshingSession;
    await expect(refresh).toBeDisabled();
    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get("mine")).toBe("1");
    expect(new URL(page.url()).searchParams.has("activator")).toBe(false);
    await expect(page.locator("[data-planning-status]")).toContainText("Checking your activation plan");
    await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(0);
    releaseSession();
    await expect.poll(() => new URL(page.url()).searchParams.get("activator")).toBe("K1XYZ");
    expect(new URL(page.url()).searchParams.has("mine")).toBe(false);
    await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(1);
    await expect(parkRow(page, "US-0515")).toBeVisible();
    await expect(page.locator("[data-my-parks-label]")).toHaveText("My parks");
    await expect(refresh).toBeEnabled();
  } finally {
    releaseSession();
    await server.stop();
  }
});

test("disclosure clicks update the shared view before late data can replace their elements", async ({ page }) => {
  const server = await startActivateRiServer();
  let releaseSession!: () => void;
  let releaseStops!: () => void;
  const sessionReady = new Promise<void>(resolve => { releaseSession = resolve; });
  const stopsReady = new Promise<void>(resolve => { releaseStops = resolve; });
  let refreshingStops = false;
  try {
    await mockPlanning(page);
    await page.route("**/api/auth/session", async route => {
      await sessionReady;
      await route.fulfill({ json: { ok: true, signedIn: true, activator: { callsign: "N1RI" } } });
    });
    await page.route("**/api/activate-ri-2026/public/stops", async route => {
      if (refreshingStops) await stopsReady;
      await route.fulfill({ json: { ok: true, stops: planningStops } });
    });
    await page.goto(`${server.origin}/activate-ri-2026/parks/`, { waitUntil: "domcontentloaded" });
    await expect(parkRow(page, "US-0513").locator("summary")).toHaveText("1 activator · 2 time slots");
    // Read in the click's task, before the browser dispatches queued native toggle events.
    const opened = await page.evaluate(() => {
      (document.querySelector('[data-park-reference="US-0513"] summary') as HTMLElement).click();
      (document.querySelector(".park-planning-more > summary") as HTMLElement).click();
      const params = new URL(window.location.href).searchParams;
      return { expanded: params.get("expanded"), more: params.get("more") };
    });
    expect(opened).toEqual({ expanded: "US-0513", more: "1" });
    const openedUrl = page.url();
    releaseSession();
    const refresh = page.getByRole("button", { name: "Refresh plans", exact: true });
    await expect(refresh).toBeEnabled();
    await expect(parkRow(page, "US-0513").locator("details")).toHaveAttribute("open", "");
    await expect(page.locator(".park-planning-more")).toHaveAttribute("open", "");
    await expect(page).toHaveURL(openedUrl);

    refreshingStops = true;
    const reloadingStops = page.waitForRequest("**/api/activate-ri-2026/public/stops");
    await refresh.click();
    await reloadingStops;
    const closed = await page.evaluate(() => {
      (document.querySelector('[data-park-reference="US-0513"] summary') as HTMLElement).click();
      (document.querySelector(".park-planning-more > summary") as HTMLElement).click();
      const params = new URL(window.location.href).searchParams;
      return { expanded: params.get("expanded"), more: params.get("more") };
    });
    expect(closed).toEqual({ expanded: null, more: null });
    const closedUrl = page.url();
    releaseStops();
    await expect(refresh).toBeEnabled();
    await expect(parkRow(page, "US-0513").locator("details")).not.toHaveAttribute("open", "");
    await expect(page.locator(".park-planning-more")).not.toHaveAttribute("open", "");
    await expect(page).toHaveURL(closedUrl);
    await parkRow(page, "US-0513").locator("summary").press("Enter");
    await expect(parkRow(page, "US-0513").locator("details")).toHaveAttribute("open", "");
    await expect.poll(() => new URL(page.url()).searchParams.get("expanded")).toBe("US-0513");
    await parkRow(page, "US-0513").locator("summary").press("Space");
    await expect(parkRow(page, "US-0513").locator("details")).not.toHaveAttribute("open", "");
    await page.locator(".park-planning-more > summary").press("Enter");
    await expect(page.locator(".park-planning-more")).toHaveAttribute("open", "");
    await expect.poll(() => new URL(page.url()).searchParams.get("more")).toBe("1");
    await page.locator(".park-planning-more > summary").press("Space");
    await expect(page.locator(".park-planning-more")).not.toHaveAttribute("open", "");
    await expect(page).toHaveURL(closedUrl);
  } finally {
    releaseSession();
    releaseStops();
    await server.stop();
  }
});
