import type { FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";
import { classifyLocation } from "./classify";

const square: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-0.01, -0.01],
            [0.01, -0.01],
            [0.01, 0.01],
            [-0.01, 0.01],
            [-0.01, -0.01],
          ],
        ],
      },
    },
  ],
};

describe("classifyLocation", () => {
  it("reports inside only when the accuracy circle fits inside the boundary", () => {
    const result = classifyLocation(
      { latitude: 0, longitude: 0, accuracy: 100 },
      square,
      "boundary",
    );

    expect(result.status).toBe("inside");
    expect(result.signedDistanceMeters).toBeLessThan(-1_000);
  });

  it("reports outside only when the accuracy circle misses the boundary", () => {
    const result = classifyLocation(
      { latitude: 0, longitude: 0.02, accuracy: 100 },
      square,
      "boundary",
    );

    expect(result.status).toBe("outside");
    expect(result.signedDistanceMeters).toBeGreaterThan(1_000);
  });

  it("reports near-boundary when the accuracy circle crosses the boundary", () => {
    const result = classifyLocation(
      { latitude: 0, longitude: 0.0099, accuracy: 50 },
      square,
      "activation-zone",
    );

    expect(result.status).toBe("near-boundary");
    expect(result.geometryKind).toBe("activation-zone");
  });

  it("treats a point on the edge as uncertain", () => {
    expect(
      classifyLocation(
        { latitude: 0, longitude: 0.01, accuracy: 0 },
        square,
        "boundary",
      ).status,
    ).toBe("near-boundary");
  });

  it("does not make an inside/outside claim for point-only park data", () => {
    const result = classifyLocation(
      { latitude: 0, longitude: 0, accuracy: 12 },
      square,
      "point",
    );

    expect(result).toEqual({
      status: "unavailable",
      geometryKind: "point",
      accuracyMeters: 12,
      signedDistanceMeters: null,
    });
  });

  it("reports unavailable when area geometry is missing", () => {
    const result = classifyLocation(
      { latitude: 0, longitude: 0, accuracy: 12 },
      { type: "FeatureCollection", features: [] },
      "boundary",
    );

    expect(result.status).toBe("unavailable");
  });

  it("treats a polygon hole as outside the mapped area", () => {
    const withHole: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-0.02, -0.02],
                [0.02, -0.02],
                [0.02, 0.02],
                [-0.02, 0.02],
                [-0.02, -0.02],
              ],
              [
                [-0.005, -0.005],
                [-0.005, 0.005],
                [0.005, 0.005],
                [0.005, -0.005],
                [-0.005, -0.005],
              ],
            ],
          },
        },
      ],
    };

    expect(
      classifyLocation(
        { latitude: 0, longitude: 0, accuracy: 10 },
        withHole,
        "boundary",
      ).status,
    ).toBe("outside");
  });

  it("handles disconnected multipolygon areas", () => {
    const multipolygon: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [[[-0.02, -0.02], [-0.01, -0.02], [-0.01, -0.01], [-0.02, -0.01], [-0.02, -0.02]]],
              [[[0.01, 0.01], [0.02, 0.01], [0.02, 0.02], [0.01, 0.02], [0.01, 0.01]]],
            ],
          },
        },
      ],
    };

    expect(
      classifyLocation(
        { latitude: 0.015, longitude: 0.015, accuracy: 10 },
        multipolygon,
        "boundary",
      ).status,
    ).toBe("inside");
  });
});
