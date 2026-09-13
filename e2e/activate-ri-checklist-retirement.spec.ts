import { expect, test, type Page } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

const storageKey = "activate-ri-2026:hunter-checklist:v1";
const savedChecklist = JSON.stringify({
  version: 1,
  importedReferenceIds: ["US-0513"],
  manualOverrides: {},
  lastImportedAt: "2026-09-12T12:00:00Z",
});
const stops = [
  { id: "block", parkReference: "US-0513", plannedDate: "2026-09-12", startTime: "13:00", endTime: "15:00", activatorCallsign: "W1AW", bands: ["20m"], modes: ["SSB"], status: "scheduled" },
  { id: "chafee", parkReference: "US-0514", plannedDate: "2026-09-13", startTime: "15:00", endTime: "18:00", activatorCallsign: "N1RI", bands: ["40m"], modes: ["CW"], status: "scheduled" },
];

async function seedChecklist(page: Page): Promise<void> {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: savedChecklist });
  await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
}

test("the retired hunter URL leaves saved data intact and has a no-JavaScript fallback", async ({ page, browser }) => {
  const server = await startActivateRiServer();
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  try {
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    await seedChecklist(page);
    await page.goto(`${server.origin}/activate-ri-2026/hunter/?q=US-0513#hunter-requested-parks`);
    await expect(page.getByRole("heading", { name: "Thanks for answering the call." })).toBeVisible();
    await expect(page.locator("[data-hunter-retired]")).toBeVisible();
    await expect(page.locator("[data-hunter-checklist]")).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "See the event recap" })).toHaveAttribute("href", "/activate-ri-2026/");
    await expect(page.getByRole("link", { name: "Explore park results" })).toHaveAttribute("href", "/activate-ri-2026/parks/");
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(savedChecklist);
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/hunter/?q=US-0513#hunter-requested-parks`);
    const staticPage = await noScript.newPage();
    await staticPage.goto(`${server.origin}/activate-ri-2026/hunter/`);
    await expect(staticPage.locator("[data-hunter-retired]")).toBeVisible();
    await expect(staticPage.getByRole("link", { name: "See the event recap" })).toBeVisible();
    await expect(staticPage.getByRole("link", { name: "Explore park results" })).toBeVisible();
    await expect(staticPage.locator("[data-hunter-checklist]")).toHaveCount(0);
  } finally {
    await noScript.close();
    await server.stop();
  }
});

test("an open checklist retires at the event boundary without losing saved data or focus", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-13T23:59:00Z") });
    await page.clock.pauseAt(new Date("2026-09-13T23:59:59Z"));
    await seedChecklist(page);
    await page.goto(`${server.origin}/activate-ri-2026/hunter/`);
    await expect(page.locator("[data-hunter-checklist]")).toBeVisible();
    await page.locator("[data-hunter-search]").focus();
    await page.clock.runFor(1500);
    await expect(page.locator("[data-hunter-checklist]")).toHaveCount(0);
    await expect(page.locator("#hunter-title")).toBeFocused();
    await expect(page.locator("[data-hunter-retired]")).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(savedChecklist);
  } finally {
    await server.stop();
  }
});

test("archived schedule links retain park selections and history without checklist invitations", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    await seedChecklist(page);
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513&timezone=utc&source=club#schedule`);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toContainText("US-0513");
    await expect(page.locator("[data-hunter-scope]")).toBeHidden();
    await expect(page.locator('a[href^="/activate-ri-2026/hunter/"]:visible')).toHaveCount(0);
    await expect(page.locator("[data-coverage-shortcut-wrap]")).toBeHidden();
    await expect(page.locator(".schedule-estimate-note:visible")).toContainText("plans shared for the 2026 event");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("[data-schedule-print-heading] [data-schedule-archive-only]")).toBeVisible();
    await expect(page.locator("[data-schedule-print-heading] [data-schedule-live-only]")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    const selectedUrl = page.url();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ timezone: "utc", source: "club" });
    expect(new URL(page.url()).hash).toBe("#schedule");
    await page.goBack();
    await expect(page).toHaveURL(selectedUrl);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toContainText("US-0513");
    await page.goForward();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);

    await page.goto(`${server.origin}/activate-ri-2026/schedule/?scope=remaining&timezone=utc`);
    await expect(page.getByRole("heading", { name: "A saved park selection" })).toBeVisible();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toContainText("US-0514");
    await expect(page.locator("[data-personal-schedule-import]")).toBeHidden();
    await expect(page.locator('a[href^="/activate-ri-2026/hunter/"]:visible')).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(savedChecklist);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/schedule/?timezone=utc`);

  } finally {
    await server.stop();
  }
});

test("an old personal schedule without saved data offers a way back to all archived plans", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?scope=remaining`);
    await expect(page.locator("[data-personal-schedule-copy]")).toContainText("isn’t available in this browser");
    await expect(page.locator("[data-schedule-table-wrap]")).toBeHidden();
    await expect(page.locator('a[href^="/activate-ri-2026/hunter/"]:visible')).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/schedule/`);
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  } finally {
    await server.stop();
  }
});

test("empty and unavailable archived schedules lead to results without new planning invitations", async ({ page }) => {
  const server = await startActivateRiServer();
  let unavailable = false;
  try {
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    await page.route("**/api/activate-ri-2026/public/stops", route => unavailable
      ? route.fulfill({ status: 503, json: { ok: false } })
      : route.fulfill({ json: { ok: true, stops: [] } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/`);
    const table = page.locator("[data-live-schedule]");
    await expect(table.locator("[data-schedule-archive-only]")).toContainText("No 2026 activation windows are listed here");
    await expect(table.getByRole("link", { name: "park results", exact: true })).toHaveAttribute("href", "/activate-ri-2026/parks/");
    await expect(page.getByText("Approved activation windows will appear here after organizer review.", { exact: true })).toBeHidden();

    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=invalid`);
    await expect(page.locator("[data-requested-schedule-error]")).toContainText("Clear filters to see all published 2026 plans");
    await expect(page.locator('a[href^="/activate-ri-2026/hunter/"]:visible')).toHaveCount(0);
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=`);
    await expect(page.locator("[data-requested-schedule-copy]")).toContainText("This older link requests no parks");

    unavailable = true;
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513`);
    await expect(page.locator("[data-requested-schedule-copy]")).toContainText("The archived schedule is temporarily unavailable");
    await expect(table.locator("[data-schedule-archive-only]")).toContainText("The archived schedule is temporarily unavailable");
    await expect(table.getByRole("link", { name: "park results", exact: true })).toBeVisible();
    await expect(table.getByRole("link", { name: "official POTA spots", exact: true })).toBeHidden();
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513`);
  } finally {
    await server.stop();
  }
});
