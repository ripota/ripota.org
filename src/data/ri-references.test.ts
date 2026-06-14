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
    }
  });
});
