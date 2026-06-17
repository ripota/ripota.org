import { describe, expect, it } from "vitest";
import references from "./ri-references.json";

describe("Rhode Island POTA references", () => {
  it("contains official POTA links for each Rhode Island reference", () => {
    expect(references.length).toBeGreaterThan(50);

    for (const reference of references) {
      expect(reference.reference).toMatch(/^US-\d+$/);
      expect(reference.potaUrl).toBe(
        `https://pota.app/#/park/${reference.reference}`,
      );
      expect(reference.latitude).toEqual(expect.any(Number));
      expect(reference.longitude).toEqual(expect.any(Number));
      expect(reference.counties.length).toBeGreaterThan(0);
      expect(reference.counties).toEqual(
        [...reference.counties].sort((left, right) => left.localeCompare(right)),
      );
      for (const county of reference.counties) {
        expect(county).toMatch(/ County$/);
      }
    }
  });

  it("includes county metadata for representative Rhode Island references", () => {
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: "US-0789",
          counties: ["Providence County"],
        }),
        expect.objectContaining({
          reference: "US-2872",
          counties: ["Bristol County"],
        }),
        expect.objectContaining({
          reference: "US-2868",
          counties: ["Newport County"],
        }),
        expect.objectContaining({
          reference: "US-2876",
          counties: ["Kent County"],
        }),
        expect.objectContaining({
          reference: "US-2871",
          counties: ["Washington County"],
        }),
      ]),
    );
  });
});
