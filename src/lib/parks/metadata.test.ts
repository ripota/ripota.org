import { describe, expect, it } from "vitest";
import { parkMatchesFilters } from "./metadata";

const park = {
  reference: "US-2878", name: "Lincoln Woods State Park", manager: "Rhode Island DEM",
  type: "park" as const, counties: ["Providence County"], amenities: ["parking", "picnic-tables"] as const,
};
const all = { query: "", county: "all", type: "all", amenity: "all" };

describe("park research filters", () => {
  it("combines name or manager search with county, type, and documented amenities", () => {
    expect(parkMatchesFilters(park, { query: " lincoln ", county: "Providence County", type: "park", amenity: "picnic-tables" })).toBe(true);
    expect(parkMatchesFilters(park, { ...all, query: "rhode island dem" })).toBe(true);
    expect(parkMatchesFilters(park, { ...all, county: "Newport County" })).toBe(false);
    expect(parkMatchesFilters(park, { ...all, type: "management-area" })).toBe(false);
    expect(parkMatchesFilters(park, { ...all, amenity: "drinking-water" })).toBe(false);
    expect(parkMatchesFilters({ ...park, amenities: [] }, { ...all, amenity: "parking" })).toBe(false);
  });
});
