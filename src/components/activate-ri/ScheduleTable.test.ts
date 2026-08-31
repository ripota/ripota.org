import { describe, expect, it } from "vitest";
import source from "./ScheduleTable.astro?raw";

describe("ScheduleTable markup", () => {
  it("uses a native timezone select for mobile schedule filtering", () => {
    expect(source).toContain("data-timezone");
    expect(source).toContain('name="schedule-timezone"');
    expect(source).not.toContain("updateTimezoneUrl");
  });

  it("renders live schedule rows in EDT immediately", () => {
    expect(source).toContain('appendCell(row, "Time", formatActivationTimeRange(stop));');
    expect(source).not.toContain('`${stop.startTime}-${stop.endTime} UTC`');
  });

  it("links directly to the parks that still need coverage", () => {
    expect(source).toContain('href="/activate-ri-2026/parks/?coverage=needed"');
    expect(source).toContain('Find parks that still need coverage');
    expect(source).toContain('summarizeParkCoverage(parks, stops).gaps');
  });

  it("filters by activator and keeps schedule controls in the URL", () => {
    expect(source).toContain('data-filter="activator"');
    expect(source).toContain("Any activator");
    expect(source).toContain("row.dataset.activator = stop.activatorCallsign");
    expect(source).toContain("restoreFiltersFromUrl(controls, timezone, hunterScope)");
    expect(source).toContain("url.searchParams.set(key, control.value)");
    expect(source).toContain('url.searchParams.set("timezone", timezone.value)');
    expect(source).toContain('window.history.replaceState({}, "", url)');
  });

  it("filters against the browser-local remaining parks without putting park IDs in the URL", () => {
    expect(source).toContain('data-hunter-scope');
    expect(source).toContain('My remaining parks');
    expect(source).toContain('readHunterChecklistState(localStorage, parks)');
    expect(source).toContain('remainingHunterReferences(state, parks)');
    expect(source).toContain('row.dataset.parkReference = stop.parkReference');
    expect(source).toContain('url.searchParams.set("scope", "remaining")');
    expect(source).toContain('No Hunter checklist has been saved in this browser yet.');
    expect(source).toContain('Not currently scheduled');
    expect(source).not.toContain('url.searchParams.set("parks"');
  });

  it("prints the current personalized schedule with human-readable context", () => {
    expect(source).toContain('data-print-schedule');
    expect(source).toContain('Print filtered schedule');
    expect(source).toContain('data-schedule-print-heading');
    expect(source).toContain('data-schedule-print-summary');
    expect(source).toContain('window.print()');
    expect(source).toContain('Activation windows are planned estimates');
    expect(source).toContain('{siteIdentity.disclaimer}');
  });

  it("offers public activator details and schedule links without private data", () => {
    expect(source).toContain("stop.activatorName?.trim() || stop.activatorCallsign");
    expect(source).toContain("https://www.qrz.com/db/");
    expect(source).toContain("dataset.activatorScheduleLink");
    expect(source).toContain("setupActivatorPopovers(body)");
    expect(source).toContain('event.key === "Escape"');
    expect(source).not.toMatch(/submitterEmail|submitterPhone|organizerNotes/);
  });
});
