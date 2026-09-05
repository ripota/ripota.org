import { expect, test } from "@playwright/test";
import parks from "../public/data/activate-ri-2026/parks.json" with { type: "json" };
import { startActivateRiServer } from "./helpers/activate-ri-server";
import { readPrintedPdf } from "./helpers/printed-pdf";

test.setTimeout(60_000);

const longNamedParks = [...parks].sort((left, right) => right.name.length - left.name.length);
const cancelledOnlyPark = longNamedParks.at(-2)!;
const unmatchedPark = longNamedParks.at(-1)!;
const requestedReferences = [longNamedParks[0].reference, cancelledOnlyPark.reference, unmatchedPark.reference];
const stops = Array.from({ length: 54 }, (_, index) => ({
  id: `print-stop-${index}`,
  parkReference: longNamedParks[index === 53 ? 0 : index].reference,
  plannedDate: "2026-09-12",
  startTime: index === 0 ? "23:45" : index === 1 ? "01:15" : "14:00",
  endTime: index === 0 ? "01:15" : index === 1 ? "03:30" : "18:00",
  activatorCallsign: `N1PDF${String(index).padStart(2, "0")}/P`,
  activatorName: "Synthetic long activator display name for print verification",
  bands: ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m"],
  modes: ["CW", "SSB", "FT8", "FM"],
  status: index % 3 === 0 ? "delayed" : "scheduled",
  publicNotes: "PUBLIC_NOTE_MUST_NOT_EXPORT https://example.invalid/private-notes",
  organizerNotes: "ORGANIZER_NOTE_MUST_NOT_EXPORT",
  submitterEmail: "PRIVATE_EMAIL_MUST_NOT_EXPORT@example.invalid",
  submitterPhone: "PRIVATE_PHONE_MUST_NOT_EXPORT",
}));

for (const format of ["Letter", "A4"] as const) {
  test(`${format} schedule PDFs preserve rows, repeated headers, margins, and privacy`, async ({ page }, testInfo) => {
    const server = await startActivateRiServer();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: "dark" });
      let currentStops = stops;
      await page.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, stops: currentStops }),
      }));

      for (const scenario of ["long", "overnight", "requested", "empty", "unmatched"] as const) {
        currentStops = scenario === "empty" ? [] : scenario === "overnight" ? stops.slice(0, 2) : scenario === "requested" ? [
          stops[0], stops[53],
          { ...stops[1], parkReference: cancelledOnlyPark.reference, activatorCallsign: "N1CANCEL", status: "cancelled" },
        ] : stops;
        const query = scenario === "unmatched" ? "&q=no-such-park" : scenario === "requested" ? `&parks=${requestedReferences.join(",")}` : "";
        await page.goto(`${server.origin}/activate-ri-2026/schedule/?timezone=utc${query}`);
        await expect(page.locator("[data-schedule-loaded]")).toContainText("Schedule loaded");
        if (scenario === "long") {
          await page.locator(".activator-popover__trigger").first().click();
          await expect(page.locator("[data-activator-popover-card]:visible")).toContainText("PUBLIC_NOTE_MUST_NOT_EXPORT");
        }

        await page.emulateMedia({ media: "print" });
        const path = testInfo.outputPath(`${scenario}-${format}.pdf`);
        const bytes = await page.pdf({ path, format, landscape: true, printBackground: true });
        await testInfo.attach(`${scenario}-${format}`, { path, contentType: "application/pdf" });
        const printedPages = await readPrintedPdf(bytes);
        const text = printedPages.map((printedPage) => printedPage.text).join(" ");
        expect(text).toContain(scenario === "requested" ? "My requested-parks agenda" : "Event schedule");
        expect(text).toContain("Prepared");
        expect(text).toContain("UTC");
        expect(text).toContain("Event-day filters use Rhode Island time.");
        expect(text).toContain("not an official Parks on the Air property");
        expect(text).not.toMatch(/MUST_NOT_EXPORT|example\.invalid|View on QRZ|Shareable agenda link/);

        for (const [index, printedPage] of printedPages.entries()) {
          expect(printedPage.width).toBeCloseTo(format === "Letter" ? 792 : 842, -1);
          expect(printedPage.height).toBeCloseTo(format === "Letter" ? 612 : 595, -1);
          for (const header of ["Date", "Time", "Park", "Activator", "Bands", "Modes", "Status"]) {
            expect(printedPage.text, `Page ${index + 1} repeats ${header}`).toContain(header);
          }
          for (const item of printedPage.textItems) {
            expect(item.x, `Page ${index + 1}: ${item.text}`).toBeGreaterThanOrEqual(30);
            expect(item.x + item.width, `Page ${index + 1}: ${item.text}`).toBeLessThanOrEqual(printedPage.width - 30);
            expect(item.y, `Page ${index + 1}: ${item.text}`).toBeGreaterThanOrEqual(30);
            expect(item.y + item.height, `Page ${index + 1}: ${item.text}`).toBeLessThanOrEqual(printedPage.height - 30);
          }
          expect(printedPage.urls.join(" ")).not.toMatch(/MUST_NOT_EXPORT|example\.invalid|token=|email=|phone=|notes=|qrz\.com/i);
        }

        if (scenario === "long" || scenario === "overnight") {
          expect(text).toContain("23:45-01:15 UTC (+1 day)");
          expect(text).toContain("Sep 13, 2026");
          expect(text).toContain("Delayed");
          for (const stop of currentStops) {
            const containingPages = printedPages.filter((printedPage) => printedPage.text.includes(stop.activatorCallsign));
            expect(containingPages, `${stop.activatorCallsign} prints once without a split row`).toHaveLength(1);
            expect(containingPages[0].text).toContain(stop.parkReference);
          }
          if (scenario === "overnight") expect(printedPages).toHaveLength(1);
          if (scenario === "long") {
            expect(printedPages.length).toBeGreaterThan(1);
            const printedCallsigns = printedPages.flatMap((printedPage) => printedPage.textItems.filter((item) => /N1PDF\d+\/P/.test(item.text)));
            expect(printedCallsigns).toHaveLength(stops.length);
            expect(Math.min(...printedCallsigns.map((item) => item.height))).toBeGreaterThanOrEqual(7.8);
          }
        } else if (scenario === "requested") {
          expect(printedPages).toHaveLength(1);
          expect(text).toContain("2 matching activation windows");
          expect(text).toContain("3 requested parks");
          expect(text).toContain("Requested parks:");
          for (const reference of requestedReferences) expect(text).toContain(reference);
          expect(text).toContain(`${cancelledOnlyPark.reference} · ${cancelledOnlyPark.name} — published windows cancelled`);
          expect(text).toContain(`${unmatchedPark.reference} · ${unmatchedPark.name} — no published window`);
          expect(text).toContain(stops[0].activatorCallsign);
          expect(text).toContain(stops[53].activatorCallsign);
          expect(text).toContain("Delayed");
          expect(text).not.toContain("N1CANCEL");
        } else {
          expect(printedPages).toHaveLength(1);
          expect(text).toContain("0 matching activation windows");
          expect(text).not.toContain("N1PDF");
          expect(text).toContain(scenario === "empty"
            ? "Approved activation windows will appear here after organizer review."
            : "No scheduled activation windows match this search and filters.");
        }

        await expect(page.locator("html")).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await expect(page.locator(".activator-popover").first()).toBeHidden();
        await page.emulateMedia({ media: "screen" });
      }
    } finally {
      await server.stop();
    }
  });
}
