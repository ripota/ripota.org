import { describe, expect, it } from "vitest";
import { isOrangeNoticeSeason } from "./orange-season";

describe("seasonal orange reminders", () => {
  it.each([
    ["2026-06-01T03:59:59Z", true], // May 31 in Rhode Island.
    ["2026-06-01T04:00:00Z", false],
    ["2026-06-15T16:00:00Z", false],
    ["2026-07-15T16:00:00Z", false],
    ["2026-08-15T03:59:59Z", false],
    ["2026-08-15T04:00:00Z", true],
    ["2026-12-31T23:00:00Z", true],
    ["2027-01-01T05:00:00Z", true],
    ["2027-03-15T16:00:00Z", true],
  ])("uses the current Rhode Island date at %s", (date, expected) => {
    expect(isOrangeNoticeSeason(new Date(date))).toBe(expected);
  });
});
