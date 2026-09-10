import { expect, test, type Page } from "@playwright/test";
import { parseAnalyticsEvent, type AnalyticsEvent } from "../src/lib/analytics/events";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

async function collectEvents(page: Page): Promise<AnalyticsEvent[]> {
  const events: AnalyticsEvent[] = [];
  await page.route("**/api/analytics/events", async (route) => {
    const payload: unknown = route.request().postDataJSON();
    const parsed = parseAnalyticsEvent(payload);
    expect(parsed, `Rendered event rejected: ${JSON.stringify(payload)}`).not.toBeNull();
    events.push(parsed!);
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({ json: { ok: true, stops: [] } }));
  return events;
}

test("rendered hunter lifecycle, every progress change, CTA and agenda actions emit valid anonymous events", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    const events = await collectEvents(page);
    await page.goto(`${server.origin}/activate-ri-2026/`);
    await page.locator('[data-analytics-action="hunter"]').click();
    await expect.poll(() => events.some(event => event.name === "event_cta_clicked" && event.properties?.action === "hunter")).toBe(true);
    await expect(page).toHaveURL(/\/activate-ri-2026\/hunter\/$/);
    // The previous page's CTA request can arrive before the destination module
    // initializes. This checkbox is created by that module, unlike the static
    // blank-start button, so it establishes readiness without a timing delay.
    await expect(page.locator("#hunter-park-US-0513")).toBeAttached();
    await page.getByRole("button", { name: "Start a blank checklist", exact: true }).click();
    await expect(page.getByRole("heading", { name: /0 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect.poll(() => events.some(event => event.name === "hunter_checklist_started")).toBe(true);
    await page.getByLabel(/US-0513 .* hunted/).check();
    await page.getByLabel(/US-0514 .* hunted/).check();
    await page.getByLabel(/US-0513 .* hunted/).uncheck();
    await expect.poll(() => events.filter(event => event.name === "hunter_progress_changed").length).toBe(3);
    expect(events.filter(event => event.name === "hunter_progress_changed").map(event => [event.properties?.direction, event.properties?.completedCount])).toEqual([["hunted", 1], ["hunted", 2], ["remaining", 1]]);
    await page.reload();
    await expect.poll(() => events.some(event => event.name === "hunter_checklist_resumed" && event.properties?.entryMode === "blank" && event.properties?.completedCount === 1)).toBe(true);
    await page.getByRole("link", { name: "View schedule for US-0514", exact: true }).click();
    await expect.poll(() => events.some(event => event.name === "hunter_schedule_details_opened")).toBe(true);
    await page.goto(`${server.origin}/activate-ri-2026/hunter/#hunter-requested-parks`);
    await page.locator("[data-hunter-requested-input]").fill("US-0513 US-0514");
    await page.getByRole("button", { name: "View requested parks schedule", exact: true }).click();
    await expect.poll(() => events.some(event => event.name === "hunter_agenda_action" && event.properties?.action === "build" && event.properties?.parkCount === 2)).toBe(true);
    await expect.poll(() => events.some(event => event.name === "hunter_agenda_action" && event.properties?.action === "open" && event.properties?.agendaScope === "requested")).toBe(true);
    await page.locator("[data-hunter-scope]").selectOption("remaining");
    await page.locator("[data-share-schedule]").click();
    await page.evaluate(() => { window.print = () => {
      window.dispatchEvent(new Event("beforeprint"));
      window.dispatchEvent(new Event("afterprint"));
    }; });
    await page.locator("[data-print-schedule]").click();
    await expect.poll(() => events.filter(event => event.name === "hunter_agenda_action").map(event => event.properties?.action)).toEqual(expect.arrayContaining(["scope_changed", "share", "print"]));
    expect(events.filter(event => event.name === "hunter_agenda_action" && event.properties?.action === "print")).toHaveLength(1);
    // Browser menu / Cmd+P follows beforeprint without the on-page button.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("beforeprint"));
      window.dispatchEvent(new Event("afterprint"));
    });
    await expect.poll(() => events.filter(event => event.name === "hunter_agenda_action" && event.properties?.action === "print").length).toBe(2);
    expect(events.every(event => event.schemaVersion === 2 && Boolean(event.eventId) && Boolean(event.occurredAt))).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("US-0513");
    expect(serialized).not.toContain("US-0514");
    expect(new Set(events.map(event => event.anonymousId)).size).toBe(1);
    expect(new Set(events.map(event => event.schemaVersion === 2 ? event.eventId : "")).size).toBe(events.length);
  } finally {
    await server.stop();
  }
});

test("imports distinguish header-only input, parser quality, resume, and storage failure", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    const events = await collectEvents(page);
    await page.goto(`${server.origin}/activate-ri-2026/hunter/`);
    const upload = async (csv: string) => page.getByLabel("Choose CSV file").setInputFiles({ name: "PRIVATE_FILE.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await upload("Reference\n");
    await expect.poll(() => events.some(event => event.name === "hunter_import_failed" && event.properties?.errorCode === "empty_file")).toBe(true);
    await upload("Reference\nUS-0513\n");
    await expect.poll(() => events.some(event => event.name === "hunter_import_succeeded" && event.properties?.importQuality === "clean" && event.properties?.matchedCount === 1)).toBe(true);
    const success = events.find(event => event.name === "hunter_import_succeeded")!;
    expect(events.some(event => event.name === "hunter_import_attempted" && event.properties?.importAttemptId === success.properties?.importAttemptId)).toBe(true);
    await page.reload();
    await expect.poll(() => events.some(event => event.name === "hunter_checklist_resumed" && event.properties?.entryMode === "imported")).toBe(true);
    await page.locator("[data-hunter-update-import]").click();
    await upload("Reference\nUS-9999\n");
    await expect.poll(() => events.some(event => event.name === "hunter_import_succeeded" && event.properties?.importQuality === "zero_matches")).toBe(true);
    await page.locator("[data-hunter-update-import]").click();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "activate-ri-2026:hunter-checklist:v1") throw new DOMException("Synthetic storage failure", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    const successesBefore = events.filter(event => event.name === "hunter_import_succeeded").length;
    await upload("Reference\nUS-0513\n");
    await expect.poll(() => events.some(event => event.name === "hunter_import_failed" && event.properties?.errorCode === "storage_unavailable" && event.properties?.persistence === "unavailable" && event.properties?.importQuality === "clean")).toBe(true);
    expect(events.filter(event => event.name === "hunter_import_succeeded")).toHaveLength(successesBefore);
    expect(JSON.stringify(events)).not.toContain("PRIVATE_FILE");
    expect(JSON.stringify(events)).not.toContain("US-0513");
  } finally {
    await server.stop();
  }
});

for (const signal of ["globalPrivacyControl", "doNotTrack"] as const) {
  test(`${signal} suppresses the rendered lifecycle and progress collector`, async ({ page }) => {
    const server = await startActivateRiServer();
    try {
      await page.addInitScript((name) => Object.defineProperty(navigator, name, { configurable: true, value: name === "doNotTrack" ? "1" : true }), signal);
      const events = await collectEvents(page);
      await page.goto(`${server.origin}/activate-ri-2026/hunter/`);
      await page.getByRole("button", { name: "Start a blank checklist", exact: true }).click();
      await page.getByLabel(/US-0513 .* hunted/).check();
      await page.reload();
      await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();
      expect(events).toEqual([]);
      expect(await page.evaluate(() => localStorage.getItem("ripota:analytics:subjects:v1"))).toBeNull();
    } finally {
      await server.stop();
    }
  });
}
