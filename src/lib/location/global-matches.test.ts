import type { FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";
import {
  findGlobalLocationMatches,
  formatLocationDistance,
  globalLocationSummary,
  type GlobalLocationPark,
} from "./global-matches";

function square(reference: string, west: number, east: number): GlobalLocationPark {
  const geojson: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [west, -0.01],
              [east, -0.01],
              [east, 0.01],
              [west, 0.01],
              [west, -0.01],
            ],
          ],
        },
      },
    ],
  };

  return {
    reference,
    name: `${reference} park`,
    geometryKind: "boundary",
    geojson,
    marker: { latitude: 0, longitude: (west + east) / 2 },
  };
}

const location = { latitude: 0, longitude: 0, accuracy: 25 };

describe("findGlobalLocationMatches", () => {
  it("returns every definite overlapping reference separately", () => {
    const sharedArea = square("US-0001", -0.01, 0.01);
    const results = findGlobalLocationMatches(location, [
      sharedArea,
      { ...sharedArea, reference: "US-0002", name: "Second reference" },
    ]);

    expect(results.inside.map(({ reference }) => reference)).toEqual([
      "US-0001",
      "US-0002",
    ]);
    expect(results.nearby).toEqual([]);
  });

  it("orders uncertain edge matches before nearby parks", () => {
    const edge = square("US-EDGE", -0.01, 0);
    const nearby = square("US-NEAR", 0.01, 0.02);
    const results = findGlobalLocationMatches(location, [nearby, edge]);

    expect(results.uncertain.map(({ reference }) => reference)).toEqual([
      "US-EDGE",
    ]);
    expect(results.nearby.map(({ reference }) => reference)).toEqual([
      "US-NEAR",
    ]);
  });

  it("includes point-only references only as nearby field guides", () => {
    const results = findGlobalLocationMatches(location, [
      {
        reference: "US-POINT",
        name: "Point park",
        geometryKind: "point",
        geojson: null,
        marker: { latitude: 0, longitude: 0.001 },
      },
    ]);

    expect(results.inside).toEqual([]);
    expect(results.uncertain).toEqual([]);
    expect(results.nearby[0]).toMatchObject({
      reference: "US-POINT",
      geometryKind: "point",
      status: "unavailable",
    });
  });

  it("keeps activation-zone language available for definite matches", () => {
    const zone = {
      ...square("US-ZONE", -0.01, 0.01),
      geometryKind: "activation-zone" as const,
    };
    const results = findGlobalLocationMatches(location, [zone]);

    expect(results.inside[0]).toMatchObject({
      reference: "US-ZONE",
      geometryKind: "activation-zone",
      status: "inside",
    });
  });

  it("ranks nearby areas by boundary distance and limits the result", () => {
    const results = findGlobalLocationMatches(
      location,
      [
        square("US-FAR", 0.04, 0.05),
        square("US-CLOSE", 0.012, 0.02),
        square("US-MIDDLE", 0.025, 0.03),
      ],
      2,
    );

    expect(results.nearby.map(({ reference }) => reference)).toEqual([
      "US-CLOSE",
      "US-MIDDLE",
    ]);
  });
});

describe("globalLocationSummary", () => {
  it("summarizes definite, uncertain, and no-match states", () => {
    const inside = findGlobalLocationMatches(location, [
      square("US-0001", -0.01, 0.01),
    ]);
    const uncertain = findGlobalLocationMatches(location, [
      square("US-EDGE", -0.01, 0),
    ]);
    const noMatch = findGlobalLocationMatches(location, [
      square("US-FAR", 0.02, 0.03),
    ]);

    expect(globalLocationSummary(inside, 25).primary).toBe(
      "Inside 1 mapped area",
    );
    expect(globalLocationSummary(uncertain, 25).primary).toBe(
      "Near 1 mapped boundary",
    );
    expect(globalLocationSummary(noMatch, 25)).toMatchObject({
      primary: "No mapped RI park contains this location",
      secondary: "Accuracy ±25 m",
    });
  });
});

describe("formatLocationDistance", () => {
  it("uses readable meter and kilometer labels", () => {
    expect(formatLocationDistance(321.4)).toBe("321 m away");
    expect(formatLocationDistance(1_250)).toBe("1.3 km away");
    expect(formatLocationDistance(12_600)).toBe("13 km away");
  });
});
