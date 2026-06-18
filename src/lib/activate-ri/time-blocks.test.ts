import { describe, expect, it } from "vitest";
import { activateRiTimeBlocks } from "./time-blocks";

describe("activation time blocks", () => {
  it("keeps EDT form values while exposing UTC backend ranges", () => {
    expect(activateRiTimeBlocks[0]).toEqual(
      expect.objectContaining({
        value: "00:00-03:00",
        label: "00:00 - 03:00 EDT",
        startTime: "04:00",
        endTime: "07:00",
        easternLabel: "00:00 - 03:00 EDT",
        utcDateOffset: 0,
      }),
    );
    expect(activateRiTimeBlocks.at(-1)).toEqual(
      expect.objectContaining({
        value: "21:00-24:00",
        label: "21:00 - 24:00 EDT",
        startTime: "01:00",
        endTime: "04:00",
        easternLabel: "21:00 - 24:00 EDT",
        utcDateOffset: 1,
      }),
    );
    expect(activateRiTimeBlocks.map((block) => block.easternLabel)).toEqual(
      [
        "00:00 - 03:00 EDT",
        "03:00 - 06:00 EDT",
        "06:00 - 09:00 EDT",
        "09:00 - 12:00 EDT",
        "12:00 - 15:00 EDT",
        "15:00 - 18:00 EDT",
        "18:00 - 21:00 EDT",
        "21:00 - 24:00 EDT",
      ],
    );
  });
});
