import { describe, expect, it } from "vitest";
import { activateRiTimeBlocks } from "./time-blocks";

describe("activation time blocks", () => {
  it("keeps UTC block values while presenting ascending Eastern labels", () => {
    expect(activateRiTimeBlocks[0]).toEqual(
      expect.objectContaining({
        value: "04:00-07:00",
        label: "04:00 - 07:00",
        easternLabel: "00:00 - 03:00 EDT",
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
      ],
    );
  });
});
