import { describe, expect, it } from "vitest";
import { normalizeRiPotaSpots } from "./spots";

const parkNames = new Map([
  ["US-10545", "Hillsdale Preserve Management Area"],
  ["US-2868", "Beavertail State Park"],
]);

function spot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    spotId: 55398684,
    activator: "n1bs",
    frequency: "14052.0",
    mode: "cw",
    reference: "us-10545",
    name: "Hillsdale Preserve Management Area",
    spotTime: "2026-08-19T13:27:46",
    spotter: "kw7mm-#",
    comments: "RBN 5 dB 24 WPM",
    source: "RBN",
    invalid: null,
    expire: 561,
    ...overrides,
  };
}

describe("normalizeRiPotaSpots", () => {
  it("projects verified upstream fields into the public RI live shape", () => {
    expect(normalizeRiPotaSpots([spot()], { parkNames })).toEqual([
      {
        id: "55398684",
        parkReference: "US-10545",
        parkName: "Hillsdale Preserve Management Area",
        activatorCallsign: "N1BS",
        frequency: "14052.0",
        mode: "CW",
        spotTime: "2026-08-19T13:27:46",
        spotterCallsign: "KW7MM-#",
        comments: "RBN 5 dB 24 WPM",
        sourceLabel: "RBN",
        expiresInSeconds: 561,
        parkUrl: "https://pota.app/#/park/US-10545",
        spotsUrl: "https://pota.app/",
      },
    ]);
  });

  it("uses checked-in RI membership and removes QRT, expired, and invalid spots", () => {
    const result = normalizeRiPotaSpots(
      [
        spot({ spotId: 1, reference: "US-9999" }),
        spot({ spotId: 2, comments: "Qrt" }),
        spot({ spotId: 3, expire: 0 }),
        spot({ spotId: 4, invalid: "invalid reference" }),
        spot({ spotId: 5, reference: "US-2868", name: "" }),
      ],
      { parkNames },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "5",
      parkReference: "US-2868",
      parkName: "Beavertail State Park",
    });
  });

  it("drops malformed rows and sorts newest spots first", () => {
    const result = normalizeRiPotaSpots(
      [
        null,
        "not a spot",
        spot({ spotId: 1, activator: "" }),
        spot({ spotId: 2, spotTime: "2026-08-19T13:20:00" }),
        spot({ spotId: 3, spotTime: "2026-08-19T13:30:00" }),
      ],
      { parkNames },
    );

    expect(result.map((item) => item.id)).toEqual(["3", "2"]);
  });

  it("returns an empty list for a non-array upstream payload", () => {
    expect(normalizeRiPotaSpots({ error: "changed schema" }, { parkNames })).toEqual([]);
  });
});
