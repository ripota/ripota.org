import { expect, test, type Page } from "@playwright/test";
import parks from "../public/data/activate-ri-2026/parks.json" with { type: "json" };
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

async function mockParkResults(page: Page) {
  const evidence = { qsoDate: "20260912", activeCallsign: "W1AW", totalQsos: 30, qsosCw: 10, qsosPhone: 20, qsosData: 0 };
  await page.route("**/api/activate-ri-2026/public/park-status", route => route.fulfill({ json: {
    ok: true, generatedAt: "2026-09-14T00:00:00Z", lastPotaSyncAt: "2026-09-13T23:59:00Z", lastSpotIngestAt: null,
    stale: false, warning: null, eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: { total: 61, confirmed: 1, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 60, withoutConfirmation: 60 },
    parks: parks.map(park => ({ ...park, potaUrl: "https://pota.app/", status: park.reference === "US-0513" ? "confirmed" : "needed",
      live: park.reference === "US-0513", scheduled: false, observed: false, attemptRecorded: false,
      confirmation: park.reference === "US-0513" ? evidence : null,
      confirmations: park.reference === "US-0513" ? [evidence, { ...evidence, qsoDate: "20260913" }] : [],
      attempts: [], lastObservation: null,
    })),
  } }));
  await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [{
    id: "archive-stop", parkReference: "US-0513", activatorCallsign: "W1AW", plannedDate: "2026-09-12",
    startTime: "13:00", endTime: "15:00", bands: ["20m"], modes: ["SSB"], publicNotes: "", status: "completed",
  }] } }));
  await page.route("**/api/auth/session", route => route.fulfill({ json: {
    ok: true, signedIn: true, user: { id: "archive-user", email: "archive@example.invalid" }, activator: { callsign: "W1AW" },
  } }));
}

test("park results replace planning with recorded activations and preserve the park search at cutoff", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-13T23:59:00Z") });
    await page.clock.pauseAt(new Date("2026-09-13T23:59:59Z"));
    await mockParkResults(page);
    await page.goto(`${server.origin}/activate-ri-2026/parks/?q=US-0513&source=club#park-results`);
    const row = page.locator('[data-live-coverage] [data-park-reference="US-0513"]');
    await expect(row.getByRole("link", { name: "Add an activation", exact: true })).toBeVisible();
    await expect(row).toContainText("On air now");
    await row.getByRole("link", { name: "Add an activation", exact: true }).focus();
    await page.clock.runFor(1500);
    const records = page.locator("[data-activation-results]");
    await expect(records).toBeVisible();
    await expect(records.locator("[data-activation-record]")).toHaveCount(2);
    await expect(records.locator("[data-activation-record]")).toContainText(["W1AW", "W1AW"]);
    await expect(page.locator("[data-park-planning]")).toHaveCount(0);
    await expect(page.locator("#parks-title")).toBeFocused();
    await expect(page.getByRole("link", { name: "Add an activation", exact: true })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Activation plans", exact: true })).toHaveCount(0);
    const after = new URL(page.url());
    expect(after.searchParams.get("results-q")).toBe("US-0513");
    expect(after.searchParams.get("source")).toBe("club");
    expect(after.hash).toBe("#park-results");
    await page.getByText("Show park map", { exact: true }).click();
    await expect(page.locator('#activate-ri-archived-results-map')).toBeVisible();
    await expect(page.locator('#activate-ri-pota-results-map')).toBeHidden();
    await page.reload();
    await expect(records.getByRole("searchbox")).toHaveValue("US-0513");
    await expect(records.locator("[data-activation-record]")).toHaveCount(2);
    await expect(page.locator("[data-park-planning]")).toHaveCount(0);
  } finally { await server.stop(); }
});

test("the retired progress link points to POTA records without loading the old spot dashboard", async ({ page }) => {
  const server = await startActivateRiServer();
  const requests: string[] = [];
  page.on("request", request => { requests.push(new URL(request.url()).pathname); });
  try {
    await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
    await page.goto(`${server.origin}/activate-ri-2026/progress/?q=US-0513`);
    await expect(page.getByRole("heading", { name: "Looking for the weekend’s results?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "See park results", exact: true })).toHaveAttribute("href", "/activate-ri-2026/parks/?results-q=US-0513");
    await expect(page.locator("[data-pota-activity]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Spot archive", exact: true })).toHaveCount(0);
    expect(requests).not.toContain("/api/activate-ri-2026/public/spot-activity");
  } finally { await server.stop(); }
});

test("a progress tab retires with its latest search and stops refreshing spots", async ({ page }) => {
  const server = await startActivateRiServer();
  let spotRequests = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/activate-ri-2026/public/spot-activity") spotRequests += 1;
  });
  try {
    await page.clock.install({ time: new Date("2026-09-13T23:58:00Z") });
    await page.clock.pauseAt(new Date("2026-09-13T23:58:00Z"));
    await page.goto(`${server.origin}/activate-ri-2026/progress/`);
    const search = page.getByRole("searchbox", { name: "Search parks" });
    await search.fill("US-0513");
    await expect(page).toHaveURL(/q=US-0513/);
    await page.clock.runFor(120_001);
    await expect(page.locator("[data-pota-activity]")).toHaveCount(0);
    await expect(page.locator("#progress-wrapup-title")).toBeFocused();
    const results = page.getByRole("link", { name: "See park results", exact: true });
    await expect(results).toHaveAttribute("href", "/activate-ri-2026/parks/?results-q=US-0513");
    await page.waitForLoadState("networkidle");
    const requestsAfterRetirement = spotRequests;
    await page.clock.runFor(120_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(spotRequests).toBe(requestsAfterRetirement);
    await page.goBack();
    await expect(results).toHaveAttribute("href", "/activate-ri-2026/parks/");
    await page.goForward();
    await expect(results).toHaveAttribute("href", "/activate-ri-2026/parks/?results-q=US-0513");
  } finally { await server.stop(); }
});

test("help becomes a useful wrap-up page without the old planning FAQ", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.clock.install({ time: new Date("2026-09-13T23:59:00Z") });
    await page.clock.pauseAt(new Date("2026-09-13T23:59:59Z"));
    await page.goto(`${server.origin}/activate-ri-2026/help/`);
    await expect(page.getByRole("link", { name: "activator signup", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "RSVP for the NCRC cookout", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "RSVP for the NCRC cookout", exact: true }).focus();
    await page.clock.runFor(1500);
    await expect(page.getByRole("heading", { name: "A few things to wrap up", exact: true })).toBeVisible();
    await expect(page.locator("#faq-title")).toBeFocused();
    await expect(page.getByRole("heading", { name: "Still have a log to upload?", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Have a photo to share?", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "A park I hunted hasn’t appeared in POTA yet.", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "activator signup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "RSVP for the NCRC cookout", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "How can I promote the event?", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What seasonal access and facilities should I check?", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "How do I add the Activate All RI widget to my QRZ biography?", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "How can I find participating activators on the air?", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open My Plan", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "browse the event gallery", exact: true })).toHaveAttribute("href", "/activate-ri-2026/media/");
    await expect(page.getByRole("link", { name: "add photos", exact: true })).toHaveAttribute("href", "/activate-ri-2026/activator/media/");
    await expect(page.locator("#corrections")).toContainText("Feel free to reach out to any of us. We’re happy to help.");
    await expect(page.locator("#corrections li")).toHaveText(["Rob Jackson — N1RWJ", "Brian Swann — N1BS", "Brian Maynard — K1NW"]);
    for (const callsign of ["N1RWJ", "N1BS", "K1NW"]) {
      await expect(page.locator("#corrections").getByRole("link", { name: new RegExp(callsign) })).toHaveAttribute("href", `https://www.qrz.com/db/${callsign}`);
    }
    await expect(page.locator('#corrections a[href^="tel:"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "hunter checklist", exact: true })).toHaveCount(0);
    await page.getByText("Which dates do the results cover?", { exact: true }).click();
    await expect(page.locator("main")).toContainText("September 14 at 00:00 UTC");
    await page.getByRole("link", { name: "Hunter credit & corrections", exact: true }).click();
    await expect(page).toHaveURL(/#hunter-faq$/);
    await expect(page.locator("#hunter-faq-title")).toHaveText("Hunter credit and corrections");
  } finally { await server.stop(); }
});
