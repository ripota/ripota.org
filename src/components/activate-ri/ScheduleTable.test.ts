import { describe, expect, it } from "vitest";
import source from "./ScheduleTable.astro?raw";

describe("ScheduleTable markup", () => {
  it("does not expose timezone controls for the EDT event schedule", () => {
    expect(source).not.toContain("data-timezone");
    expect(source).not.toContain('name="schedule-timezone"');
    expect(source).not.toContain("updateTimezoneUrl");
  });

  it("renders live schedule rows in EDT immediately", () => {
    expect(source).toContain('appendCell(row, "Time", formatActivationTimeRange(stop));');
    expect(source).not.toContain('`${stop.startTime}-${stop.endTime} UTC`');
  });
});
