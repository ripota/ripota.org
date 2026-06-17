import { describe, expect, it } from "vitest";
import {
  activationTimeZoneOptions,
  formatActivationDate,
  formatActivationTimeRange,
  stopTimeRangeToInstants,
  timeZoneOptionForValue,
} from "./time";

describe("activation time helpers", () => {
  it("defaults schedule display to Eastern time", () => {
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
    ).toBe("10:00-13:00 EDT");
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

  it("handles UTC ranges that cross midnight", () => {
    expect(
      formatActivationTimeRange({
        plannedDate: "2026-09-11",
        startTime: "22:00",
        endTime: "01:00",
      }),
    ).toBe("18:00-21:00 EDT");

    expect(
      stopTimeRangeToInstants("2026-09-11", "22:00", "01:00"),
    ).toEqual({
      startAt: "2026-09-11T22:00:00.000Z",
      endAt: "2026-09-12T01:00:00.000Z",
    });
  });

  it("uses Eastern as the first timezone option", () => {
    expect(activationTimeZoneOptions[0]).toEqual(
      expect.objectContaining({
        value: "eastern",
        label: "Eastern",
        timeZone: "America/New_York",
      }),
    );
  });
});
