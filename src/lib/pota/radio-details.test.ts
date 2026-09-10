import { describe, expect, it } from "vitest";
import { formatRadioDetails } from "./radio-details";

describe("formatRadioDetails", () => {
  it.each([
    ["7178.0", "7178"],
    ["7178.000", "7178"],
    ["7260", "7260"],
    ["14052.50", "14052.5"],
    ["14052.0050", "14052.005"],
    ["14052.123456789", "14052.123456789"],
    [" 7178.0 ", "7178"],
  ])("formats %s kHz as %s kHz without losing precision", (frequency, expected) => {
    expect(formatRadioDetails(frequency, "SSB")).toBe(`${expected} kHz · SSB`);
  });

  it.each(["SSB", "LSB", "USB", "CW", "FT8", "Custom mode"])(
    "preserves the supplied mode %s",
    (mode) => {
      expect(formatRadioDetails("7178.0", mode)).toBe(`7178 kHz · ${mode}`);
    },
  );

  it("preserves unexpected frequency text instead of partially parsing it", () => {
    expect(formatRadioDetails("7178.0 approx", "SSB")).toBe("7178.0 approx kHz · SSB");
  });

  it.each([
    ["", "LSB", "LSB"],
    ["  ", "LSB", "LSB"],
    ["7178.0", "", "7178 kHz"],
    ["", "", "Not provided"],
  ])("handles missing details (%s, %s)", (frequency, mode, expected) => {
    expect(formatRadioDetails(frequency, mode)).toBe(expected);
  });
});
