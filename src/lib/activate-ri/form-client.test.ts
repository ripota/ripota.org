import { describe, expect, it } from "vitest";
import { parkOptionMatchesSearch } from "./form-client";

describe("parkOptionMatchesSearch", () => {
  it("matches references, names, and counties using all search terms", () => {
    const search = "us-2868 beavertail state park newport county";

    expect(parkOptionMatchesSearch(search, "beavertail")).toBe(true);
    expect(parkOptionMatchesSearch(search, "US-2868 Newport")).toBe(true);
    expect(parkOptionMatchesSearch(search, "  State   park ")).toBe(true);
    expect(parkOptionMatchesSearch(search, "providence")).toBe(false);
    expect(parkOptionMatchesSearch(search, "beavertail providence")).toBe(false);
  });
});
