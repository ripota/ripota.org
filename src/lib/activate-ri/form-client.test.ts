import { describe, expect, it } from "vitest";
import { parkOptionMatchesFilters } from "./form-client";

describe("parkOptionMatchesFilters", () => {
  it("combines text and coverage filters", () => {
    const search = "us-2868 beavertail state park newport county";

    expect(parkOptionMatchesFilters(search, "beavertail", false, false)).toBe(true);
    expect(parkOptionMatchesFilters(search, "newport", true, true)).toBe(true);
    expect(parkOptionMatchesFilters(search, "newport", true, false)).toBe(false);
    expect(parkOptionMatchesFilters(search, "providence", false, true)).toBe(false);
  });
});
