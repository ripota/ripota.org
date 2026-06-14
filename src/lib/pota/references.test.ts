import { describe, expect, it } from "vitest";
import { normalizePotaReferences } from "./references";

describe("normalizePotaReferences", () => {
  it("keeps community map data focused on official POTA reference fields", () => {
    const references = normalizePotaReferences([
      {
        reference: " us-0514 ",
        name: "John H. Chafee National Wildlife Refuge",
        latitude: "41.443",
        longitude: "-71.4707",
        grid: "FN41gk",
        locationDesc: "US-RI",
        extraField: "ignored",
      },
    ]);

    expect(references).toEqual([
      {
        reference: "US-0514",
        name: "John H. Chafee National Wildlife Refuge",
        latitude: 41.443,
        longitude: -71.4707,
        grid: "FN41gk",
        locationDesc: "US-RI",
        potaUrl: "https://pota.app/#/park/US-0514",
      },
    ]);
  });
});
