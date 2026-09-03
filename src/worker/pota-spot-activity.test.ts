import { describe, expect, it } from "vitest";
import { frequencyToAmateurBand } from "./pota-spot-activity";

describe("frequencyToAmateurBand", () => {
  it.each([
    ["14315", "20m"],
    ["14.315", "20m"],
    ["7,200", "40m"],
    ["146520", "2m"],
    ["", null],
    ["not-a-frequency", null],
  ])("maps %s to %s", (frequency, expected) => {
    expect(frequencyToAmateurBand(frequency)).toBe(expected);
  });
});
