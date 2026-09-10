import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

const stops = [
  { id: "late", parkReference: "US-0513", plannedDate: "2026-09-12", startTime: "23:45", endTime: "01:15", activatorCallsign: "W1AAA", activatorName: "Synthetic activator", bands: ["20m"], modes: ["SSB"], publicNotes: "Do not include this note in exported agendas", status: "scheduled" },
  { id: "early", parkReference: "US-0513", plannedDate: "2026-09-12", startTime: "13:00", endTime: "16:00", activatorCallsign: "W1BBB", bands: ["40m"], modes: ["CW"], publicNotes: "", status: "scheduled" },
  { id: "delayed", parkReference: "US-0514", plannedDate: "2026-09-12", startTime: "16:00", endTime: "19:00", activatorCallsign: "W1CCC", bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "delayed" },
  { id: "cancelled", parkReference: "US-0515", plannedDate: "2026-09-12", startTime: "16:00", endTime: "19:00", activatorCallsign: "W1DDD", bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "cancelled" },
];

test("requested agenda preserves parks, statuses, filters, and a portable share link", async ({ page, browser }) => {
  const server = await startActivateRiServer();
  const recipient = await browser.newContext();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=us-0513,US-0514,US-0515,US-0516,US-0513&timezone=utc&token=private-token#private-fragment`);
    const rows = page.locator("[data-filter-row]:visible");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("W1BBB");
    await expect(rows.nth(1)).toContainText("Delayed");
    await expect(rows.nth(2)).toContainText("23:45-01:15 UTC (+1 day)");
    await expect(page.locator("[data-requested-schedule-copy]")).toContainText("3 planned activation windows at 2 of 4 requested parks");
    await expect(page.locator("[data-requested-schedule-unmatched-list]")).toContainText("US-0515");
    await expect(page.locator("[data-requested-schedule-unmatched-list]")).toContainText("published windows cancelled");
    await expect(page.locator("[data-requested-schedule-unmatched-list]")).toContainText("US-0516");
    await expect(page.locator(".schedule-estimate-note")).toContainText("planned estimates");

    await page.locator('[data-filter="mode"]').selectOption("SSB");
    await expect(rows).toHaveCount(2);
    await page.getByRole("button", { name: "Share agenda", exact: true }).click();
    const link = await page.locator("[data-schedule-share-url]").inputValue();
    expect(new URL(link).searchParams.get("parks")).toBe("US-0513,US-0514,US-0515,US-0516");
    expect(new URL(link).searchParams.get("mode")).toBe("SSB");
    expect(link).not.toMatch(/private|token|scope|notes|email|phone|#/);

    const other = await recipient.newPage();
    await other.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({ json: { ok: true, stops } }));
    await other.goto(link);
    await expect(other.locator("[data-filter-row]:visible")).toHaveCount(2);
    await expect(other.locator("[data-requested-schedule-copy]")).toContainText("2 planned activation windows at 2 of 4 requested parks");
    await expect(other.locator("[data-personal-schedule-summary]")).toBeHidden();
    await other.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(other.locator("[data-filter-row]:visible")).toHaveCount(3);
    expect(new URL(other.url()).searchParams.get("parks")).toBe("US-0513,US-0514,US-0515,US-0516");
    await page.locator("[data-schedule-search]").fill("no matching park");
    await expect(page.locator("[data-schedule-share]")).toBeHidden();
    await expect(rows).toHaveCount(0);
    await expect(page.locator("[data-filter-empty]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await recipient.close();
    await server.stop();
  }
});

test("invalid, empty, and unavailable agendas never widen to all parks", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513,US-9999,bad`);
    await expect(page.locator("[data-requested-schedule-error]")).toContainText("Invalid reference IDs: BAD");
    await expect(page.locator("[data-requested-schedule-error]")).toContainText("Not in the current RI park list: US-9999");
    await expect(page.locator("[data-schedule-table-wrap]")).toBeHidden();
    await expect(page.locator("[data-print-schedule]")).toBeDisabled();
    await expect(page.locator("[data-share-schedule]")).toBeDisabled();
    await page.reload();
    await expect(page.locator("[data-requested-schedule-error]")).toBeVisible();

    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=`);
    await expect(page.locator("[data-requested-schedule-copy]")).toContainText("requests no parks");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(0);
    await expect(page.locator("[data-filter-empty]")).toBeVisible();
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("Unavailable")) } }));
    await page.getByRole("button", { name: "Share agenda", exact: true }).click();
    await expect(page.locator("[data-schedule-share-status]")).toContainText("Select and copy");
    expect(new URL(await page.locator("[data-schedule-share-url]").inputValue()).searchParams.get("parks")).toBe("");

    await page.unroute("**/api/activate-ri-2026/public/stops");
    await page.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({ status: 503, body: "Synthetic outage" }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513,US-0515`);
    await expect(page.locator("[data-requested-schedule-copy]")).toContainText("temporarily unavailable");
    await expect(page.locator("[data-requested-schedule-references]")).toContainText("US-0513, US-0515");
    await expect(page.locator("[data-requested-schedule-unmatched]")).toBeHidden();
    await expect(page.locator("[data-print-schedule]")).toBeDisabled();
    await expect(page.locator("[data-share-schedule]")).toBeDisabled();
  } finally {
    await server.stop();
  }
});

test("requested-park scopes restore their parks through Back and Forward", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513&timezone=utc`);
    const rows = page.locator("[data-filter-row]:visible");
    const scope = page.locator("[data-hunter-scope]");
    await expect(rows).toHaveCount(2);
    const requestedUrl = page.url();
    await scope.selectOption("all");
    await expect(rows).toHaveCount(3);
    expect(new URL(page.url()).searchParams.has("parks")).toBe(false);
    await expect(page.locator("[data-requested-schedule-summary]")).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(requestedUrl);
    await expect(scope).toHaveValue("requested");
    await expect(rows).toHaveCount(2);
    await expect(page.locator("[data-requested-schedule-references]")).toHaveText("Requested parks: US-0513.");
    await page.goForward();
    await expect(scope).toHaveValue("all");
    await expect(rows).toHaveCount(3);
    await scope.selectOption("requested");
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ parks: "US-0513", timezone: "utc" });
    await expect(rows).toHaveCount(2);
    const reselectedUrl = page.url();
    await page.reload();
    await expect(scope).toHaveValue("requested");
    await expect(rows).toHaveCount(2);
    await expect(page).toHaveURL(reselectedUrl);
  } finally {
    await server.stop();
  }
});

test("explicit default schedule filters show all requested windows and canonicalize the URL", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513&activator=all&mode=all&band=all&county=all&timeline=all&timezone=eastern&scope=all`);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    for (const key of ["activator", "mode", "band", "county", "timeline"]) {
      await expect(page.locator(`[data-filter="${key}"]`)).toHaveValue("all");
    }
    await expect(page.locator('[data-filter="activator"] option[value="ALL"]')).toHaveCount(0);
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ parks: "US-0513" });
    await page.reload();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    await expect(page.locator('[data-filter="activator"]')).toHaveValue("all");
  } finally {
    await server.stop();
  }
});

test("an old agenda shows its age on screen and in print", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-05T12:00:00Z") });
    await page.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513&timezone=utc`);
    await expect(page.locator("[data-schedule-loaded]")).toHaveAttribute("data-stale", "false");
    await page.clock.fastForward(6 * 60 * 1000);
    await expect(page.locator("[data-schedule-loaded]")).toContainText("over five minutes old");
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(page.locator("[data-schedule-print-loaded]")).toContainText("Reload for the latest plans");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
  } finally {
    await server.stop();
  }
});

test("shared dynamic filters survive removed options and outages while invalid static filters reset", async ({ page }) => {
  const server = await startActivateRiServer();
  let unavailable = false;
  let recovered = false;
  try {
    await page.route("**/api/activate-ri-2026/public/stops", (route) => unavailable
      ? route.fulfill({ status: 503, body: "Synthetic outage" })
      : route.fulfill({ json: { ok: true, stops: recovered
        ? [{ ...stops[0], activatorCallsign: "N1GONE", modes: ["Digital"], bands: ["70cm"] }]
        : stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?parks=US-0513&mode=Digital&band=70cm&activator=N1GONE&timeline=2026-09-99&county=Atlantis`);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(0);
    await expect(page.locator('[data-filter="timeline"]')).toHaveValue("all");
    await expect(page.locator('[data-filter="county"]')).toHaveValue("all");
    await expect(page.locator('[data-filter="timeline"] option[value="2026-09-99"]')).toHaveCount(0);
    await expect(page.locator('[data-filter="county"] option[value="Atlantis"]')).toHaveCount(0);
    await expect(page.locator('[data-filter="mode"]')).toHaveValue("Digital");
    await expect(page.locator('[data-filter="band"]')).toHaveValue("70cm");
    await expect(page.locator('[data-filter="activator"]')).toHaveValue("N1GONE");
    await expect(page.locator("[data-filter-empty]")).toBeVisible();
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      parks: "US-0513", mode: "Digital", band: "70cm", activator: "N1GONE",
    });
    unavailable = true;
    await page.reload();
    await expect(page.locator("[data-requested-schedule-copy]")).toContainText("temporarily unavailable");
    expect(new URL(page.url()).searchParams.get("mode")).toBe("Digital");
    expect(new URL(page.url()).searchParams.get("band")).toBe("70cm");
    expect(new URL(page.url()).searchParams.get("activator")).toBe("N1GONE");
    unavailable = false;
    recovered = true;
    await page.getByRole("button", { name: "Reload schedule", exact: true }).click();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toContainText("N1GONE");
  } finally {
    await server.stop();
  }
});

test("sharing a remaining-parks schedule makes its local selection portable, including zero parks", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({ json: { ok: true, stops } }));
    await page.goto(`${server.origin}/activate-ri-2026/schedule/`);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(3);
    await page.evaluate(() => {
      const parks = JSON.parse(document.querySelector<HTMLElement>("[data-live-schedule]")!.dataset.parks!);
      localStorage.setItem("activate-ri-2026:hunter-checklist:v1", JSON.stringify({
        version: 1, importedReferenceIds: parks.map((park: { reference: string }) => park.reference).filter((reference: string) => reference !== "US-0513"),
        manualOverrides: {}, lastImportedAt: "2026-09-05T12:00:00Z",
      }));
    });
    await page.goto(`${server.origin}/activate-ri-2026/schedule/?scope=remaining&timezone=utc`);
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(2);
    await page.getByRole("button", { name: "Share agenda", exact: true }).click();
    const link = await page.locator("[data-schedule-share-url]").inputValue();
    expect(new URL(link).searchParams.get("parks")).toBe("US-0513");
    expect(new URL(link).searchParams.has("scope")).toBe(false);
    await page.evaluate(() => {
      const key = "activate-ri-2026:hunter-checklist:v1";
      const state = JSON.parse(localStorage.getItem(key)!);
      state.importedReferenceIds.push("US-0513");
      localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(0);
    await page.getByRole("button", { name: "Share agenda", exact: true }).click();
    expect(new URL(await page.locator("[data-schedule-share-url]").inputValue()).searchParams.get("parks")).toBe("");
  } finally {
    await server.stop();
  }
});
