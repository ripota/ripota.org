import { describe, expect, it } from "vitest";
import {
  activationTimeZoneOptions,
  formatActivationDate,
  formatActivationTimeRange,
  timeZoneOptionForValue,
} from "./time";

describe("activation time helpers", () => {
  it("defaults schedule display to UTC", () => {
    expect(
      formatActivationDate({
        plannedDate: "2026-09-11",
        startTime: "14:00",
      }),
    ).toBe("Sep 11, 2026");
    expect(
      formatActivationTimeRange({
        plannedDate: "2026-09-11",
        startTime: "14:00",
        endTime: "17:00",
      }),
    ).toBe("14:00-17:00 UTC");
  });

  it("formats UTC stop strings in a selected timezone", () => {
    const eastern = timeZoneOptionForValue("eastern");

    expect(
      formatActivationDate(
        {
          plannedDate: "2026-09-11",
          startTime: "14:00",
        },
        eastern,
      ),
    ).toBe("Sep 11, 2026");
    expect(
      formatActivationTimeRange(
        {
          plannedDate: "2026-09-11",
          startTime: "14:00",
          endTime: "17:00",
        },
        eastern,
      ),
    ).toBe("10:00-13:00 EDT");
  });

  it("uses UTC as the first timezone option", () => {
    expect(activationTimeZoneOptions[0]).toEqual(
      expect.objectContaining({
        value: "utc",
        label: "UTC",
        timeZone: "UTC",
      }),
    );
  });
});
