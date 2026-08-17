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
});
