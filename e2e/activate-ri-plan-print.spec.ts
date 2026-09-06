import { expect, type Page, test } from "@playwright/test";
import parks from "../public/data/activate-ri-2026/parks.json" with { type: "json" };
import { startActivateRiServer } from "./helpers/activate-ri-server";
import { readPrintedPdf } from "./helpers/printed-pdf";

test.setTimeout(90_000);

type SavedStop = {
  id: string;
  park_reference: string;
  planned_date: string;
  start_time: string;
  end_time: string;
  bands: string[];
  modes: string[];
  public_notes: string;
  organizer_notes: string;
  status: string;
};

type SavedPlan = {
  id: string;
  submitter_callsign: string;
  submitter_name: string;
  submitter_email: string;
  club: string;
  public_notes: string;
  organizer_notes: string;
  status: string;
  stops: SavedStop[];
};

const planPath = "/activate-ri-2026/activator/plan/";
const plansPath = "/api/activate-ri-2026/activator/plans";
const privateEmail = "PRINT_EMAIL_MUST_NOT_EXPORT@example.invalid";
const longNamedParks = [...parks].sort((left, right) => right.name.length - left.name.length);

for (const format of ["Letter", "A4"] as const) {
  test(`${format} activator plan PDF preserves complete saved stops across portrait pages`, async ({ page }, testInfo) => {
    const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
    try {
      const { plan, token } = await signInWithPlan(page, server.origin);
      const stops = longNamedParks.slice(0, 24).map((park, index): SavedStop => ({
        id: `saved-print-stop-${index}`,
        park_reference: park.reference,
        planned_date: "2026-09-12",
        start_time: index === 0 ? "23:45" : index === 1 ? "01:15" : "13:00",
        end_time: index === 0 ? "01:15" : index === 1 ? "03:30" : "16:00",
        bands: ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m"],
        modes: ["CW", "SSB", "FT8", "FM"],
        public_notes: `PRINT_STOP_${String(index + 1).padStart(2, "0")} Bring a spare battery and check the trail entrance before setting up the station.`,
        organizer_notes: `Organizer stop note ${String(index + 1).padStart(2, "0")}: available to help another activator after this stop.`,
        status: index === 0 ? "delayed" : index === 1 ? "completed" : index === 2 ? "cancelled" : "scheduled",
      }));
      const printedPlan: SavedPlan = {
        ...plan,
        submitter_name: "Synthetic saved activator name for a field itinerary",
        club: "Rhode Island print verification group",
        public_notes: "Saved plan public note for the full weekend.",
        organizer_notes: "Saved plan organizer note for coordinating the rove.",
        status: "approved",
        stops,
      };
      await page.route(`**${plansPath}`, (route) => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, plans: [printedPlan] }),
      }));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`${server.origin}${planPath}`);
      await expect(page.locator("[data-print-plan]")).toBeEnabled();
      await expect(page.locator("[data-plan-print-stop]")).toHaveCount(stops.length);
      await expect(page.locator("[data-activator-plan-print]")).toBeHidden();

      await page.locator('[name="submitterName"]').fill("UNSAVED_NAME_MUST_NOT_EXPORT");
      await page.locator('[name="organizerNotes"]').fill("UNSAVED_NOTE_MUST_NOT_EXPORT");
      await page.locator("[data-stop-card] [data-public-notes]").first().fill("UNSAVED_STOP_MUST_NOT_EXPORT");
      await page.emulateMedia({ media: "print" });
      await expect(page.locator("#plan-print-title")).toHaveCSS("color", "rgb(17, 17, 17)");
      await page.setViewportSize({ width: 816, height: 1056 });
      const screenshot = testInfo.outputPath(`activator-plan-${format}.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach(`activator-plan-${format}-preview`, { path: screenshot, contentType: "image/png" });
      const path = testInfo.outputPath(`activator-plan-${format}.pdf`);
      const bytes = await page.pdf({ path, format, preferCSSPageSize: true, printBackground: true });
      await testInfo.attach(`activator-plan-${format}`, { path, contentType: "application/pdf" });
      const printedPages = await readPrintedPdf(bytes);
      const text = printedPages.map((printedPage) => printedPage.text).join(" ");

      expect(printedPages.length).toBeGreaterThan(1);
      for (const value of [
        "My activation plan", "Activate All RI 2026", printedPlan.submitter_callsign,
        printedPlan.submitter_name, printedPlan.club, "Approved", "Prepared", "EDT", "UTC",
        printedPlan.public_notes, printedPlan.organizer_notes, "Delayed", "Cancelled", "Completed",
        "23:45-01:15 UTC (+1 day)", "Sep 13, 2026", "not an official Parks on the Air property",
      ]) expect(text).toContain(value);
      expect(text).toMatch(/organizer/i);
      expect(text).not.toMatch(/MUST_NOT_EXPORT|example\.invalid|Save changes|Cancel plan|Choose a park from the map/);
      expect(text).not.toContain(token);

      for (const [index, printedPage] of printedPages.entries()) {
        expect(printedPage.width).toBeCloseTo(format === "Letter" ? 612 : 595, -1);
        expect(printedPage.height).toBeCloseTo(format === "Letter" ? 792 : 842, -1);
        for (const item of printedPage.textItems) {
          expect(item.x, `Page ${index + 1}: ${item.text}`).toBeGreaterThanOrEqual(34);
          expect(item.x + item.width, `Page ${index + 1}: ${item.text}`).toBeLessThanOrEqual(printedPage.width - 34);
          expect(item.y, `Page ${index + 1}: ${item.text}`).toBeGreaterThanOrEqual(34);
          expect(item.y + item.height, `Page ${index + 1}: ${item.text}`).toBeLessThanOrEqual(printedPage.height - 34);
        }
        expect(printedPage.urls.join(" ")).not.toMatch(/MUST_NOT_EXPORT|example\.invalid|token=|email=|phone=|notes=/i);
        expect(printedPage.urls.join(" ")).not.toContain(token);
      }
      for (const [index, stop] of stops.entries()) {
        const marker = `PRINT_STOP_${String(index + 1).padStart(2, "0")}`;
        const containingPages = printedPages.filter((printedPage) => printedPage.text.includes(marker));
        expect(containingPages, `${marker} remains with its complete stop`).toHaveLength(1);
        expect(containingPages[0].text).toContain(stop.park_reference);
        expect(containingPages[0].text).toContain(longNamedParks[index].name);
        expect(containingPages[0].text).toContain(stop.organizer_notes);
        expect(containingPages[0].text).toContain("160m");
        expect(containingPages[0].text).toContain("FT8");
      }
      await expect(page.locator("html")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(page.locator("[data-activator-edit]")).toBeHidden();
      await page.emulateMedia({ media: "screen" });
      await expect(page.locator("[data-activator-plan-print]")).toBeHidden();
      await expect(page.locator('[name="submitterName"]')).toHaveValue("UNSAVED_NAME_MUST_NOT_EXPORT");

      const longNoteLines = Array.from({ length: 100 }, (_, index) =>
        `LONG_NOTE_${String(index + 1).padStart(3, "0")} Field note documenting the entrance, equipment, and coordination for this activation stop.`,
      );
      printedPlan.stops = [{ ...stops[0], public_notes: longNoteLines.join("\n") }];
      await page.reload();
      await expect(page.locator("[data-plan-print-stop]")).toHaveCount(1);
      await page.emulateMedia({ media: "print" });
      const longNotePath = testInfo.outputPath(`activator-plan-long-note-${format}.pdf`);
      const longNoteBytes = await page.pdf({ path: longNotePath, format, preferCSSPageSize: true, printBackground: true });
      await testInfo.attach(`activator-plan-long-note-${format}`, { path: longNotePath, contentType: "application/pdf" });
      const longNotePages = await readPrintedPdf(longNoteBytes);
      const longNoteText = longNotePages.map((printedPage) => printedPage.text).join(" ");
      expect(longNotePages.length).toBeGreaterThan(1);
      for (const line of longNoteLines) expect(longNoteText).toContain(line);
      expect(longNoteText).toContain(stops[0].organizer_notes);
      expect(longNoteText).toContain("not an official Parks on the Air property");
    } finally {
      await server.stop();
    }
  });
}

test("Print my plan uses saved changes, handles native printing, and refreshes after saving and cancelling", async ({ page }, testInfo) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    const { plan } = await signInWithPlan(page, server.origin);
    const printButton = page.getByRole("button", { name: "Print my plan", exact: true });
    const printView = page.locator("[data-activator-plan-print]");
    await expect(printButton).toBeEnabled();
    await expect(page.getByText("Prints your saved plan. Save changes before printing.", { exact: true })).toBeVisible();
    await expect(printView).toContainText(plan.submitter_name);
    await expect(printView).toContainText("Awaiting organizer approval");
    await expect(printView).not.toContainText(privateEmail);

    await page.clock.install({ time: new Date("2026-09-06T12:00:00Z") });
    await page.evaluate(() => {
      window.print = () => {
        window.dispatchEvent(new Event("beforeprint"));
        document.body.dataset.planPrintCalled = "true";
      };
    });
    await page.locator('[name="submitterName"]').fill("Updated saved print name");
    await page.locator('[name="organizerNotes"]').fill("Updated saved organizer note");
    await printButton.click();
    await expect(page.locator("body")).toHaveAttribute("data-plan-print-called", "true");
    await expect(printView).toContainText("Prepared");
    await expect(printView).toContainText(plan.submitter_name);
    await expect(printView).not.toContainText("Updated saved print name");
    await page.emulateMedia({ media: "print" });
    await page.setViewportSize({ width: 816, height: 1056 });
    const shortPath = testInfo.outputPath("activator-plan-short.pdf");
    const shortBytes = await page.pdf({ path: shortPath, format: "Letter", preferCSSPageSize: true, printBackground: true });
    await testInfo.attach("activator-plan-short", { path: shortPath, contentType: "application/pdf" });
    const shortPages = await readPrintedPdf(shortBytes);
    expect(shortPages).toHaveLength(1);
    expect(shortPages[0].text).toContain(plan.submitter_name);
    expect(shortPages[0].text).toContain("US-2868");
    expect(shortPages[0].text).not.toContain("Updated saved print name");
    const screenshot = testInfo.outputPath("activator-plan-short.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("activator-plan-short-preview", { path: screenshot, contentType: "image/png" });
    await page.emulateMedia({ media: "screen" });
    const firstPrintText = await printView.textContent();
    await page.clock.setFixedTime(new Date("2026-09-07T12:00:00Z"));
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect.poll(() => printView.textContent()).not.toBe(firstPrintText);

    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const confirmation = page.locator("[data-edit-confirmation]");
    await expect(confirmation).toBeVisible();
    await expect(printView).toContainText("Updated saved print name");
    await expect(printView).toContainText("Updated saved organizer note");
    await page.emulateMedia({ media: "print" });
    await expect(confirmation).toBeHidden();
    await expect(printView).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cancel plan", exact: true }).click();
    await expect(page.locator("[data-edit-plan-state]")).toContainText("All stops cancelled");
    await expect(page.locator("[data-plan-print-stop]")).toHaveCount(1);
    await expect(printView).toContainText("Cancelled");
    await expect(printView).toContainText("US-2868");
    await expect(printButton).toBeEnabled();
  } finally {
    await server.stop();
  }
});

test("printing stays unavailable before a plan loads and when the account has no printable plan", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  let releaseLoad: (() => void) | undefined;
  try {
    await signInWithPlan(page, server.origin);
    const gate = new Promise<void>((resolve) => { releaseLoad = resolve; });
    let responseKind: "empty" | "error" = "empty";
    await page.route(`**${plansPath}`, async (route) => {
      await gate;
      await route.fulfill({
        status: responseKind === "error" ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(responseKind === "error"
          ? { ok: false, error: "Synthetic plan loading failure." }
          : { ok: true, plans: [] }),
      });
    });
    await page.goto(`${server.origin}${planPath}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-edit-status]")).toContainText("Loading plan");
    await expect(page.locator("[data-print-plan]")).toBeDisabled();
    releaseLoad?.();
    await expect(page.locator("[data-edit-status]")).toContainText("No activation plans were found");
    await expect(page.locator("[data-print-plan]")).toBeDisabled();
    await expect(page.locator("[data-plan-print-stop]")).toHaveCount(0);

    responseKind = "error";
    await page.reload();
    await expect(page.locator("[data-edit-status]")).toContainText("Synthetic plan loading failure");
    await expect(page.locator("[data-print-plan]")).toBeDisabled();
    await expect(page.locator("[data-plan-print-stop]")).toHaveCount(0);
  } finally {
    releaseLoad?.();
    await server.stop();
  }
});

async function signInWithPlan(page: Page, origin: string): Promise<{ plan: SavedPlan; token: string }> {
  const response = await page.request.post(`${origin}/api/activate-ri-2026/plans`, {
    headers: { origin },
    data: {
      submitterCallsign: "N1PRT",
      submitterName: "Saved print activator",
      submitterEmail: privateEmail,
      club: "RI POTA",
      organizerNotes: "Saved organizer note for field coordination.",
      turnstileToken: "test",
      stops: [{
        parkReference: "US-2868",
        plannedDate: "2026-09-12",
        timeBlock: "09:00-12:00",
        bands: ["40m", "20m"],
        modes: ["SSB", "CW"],
        publicNotes: "Saved public stop note.",
      }],
    },
  });
  expect(response.status(), await response.text()).toBe(202);
  const submitted = await response.json() as { editUrl: string };
  expect(submitted.editUrl).toBeTruthy();
  const token = new URL(submitted.editUrl).hash.slice(1);
  expect(token).not.toBe("");
  await page.goto(submitted.editUrl);
  await expect(page).toHaveURL(`${origin}${planPath}`);
  await expect(page.locator('[name="submitterCallsign"]')).toHaveValue("N1PRT");
  const saved = await page.request.get(`${origin}${plansPath}`);
  expect(saved.ok(), await saved.text()).toBe(true);
  const body = await saved.json() as { plans: SavedPlan[] };
  expect(body.plans).toHaveLength(1);
  return { plan: body.plans[0], token };
}
