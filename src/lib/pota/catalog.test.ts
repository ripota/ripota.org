import { references } from "@ripota/parks";
import { describe, expect, it } from "vitest";

import publicParks from "../../../public/data/activate-ri-2026/parks.json";
import { buildReferenceMapItems } from "../reference-map";
import {
  parksCatalog,
  referenceBoundaries,
  referenceGeojsonByPath,
} from "./catalog";

describe("@ripota/parks package contract", () => {
  it("keeps the v2 metadata API byte-for-byte aligned with the catalog", () => {
    expect(parksCatalog).toMatchObject({
      schemaVersion: 1,
      referenceCount: 61,
      featureCount: 690,
    });
    expect(references).toEqual(
      parksCatalog.references.map(
        ({ status: _status, geometryKind: _geometryKind, source: _source, geojson: _geojson, ...reference }) =>
          reference,
      ),
    );
    expect(references).toHaveLength(61);
    expect(referenceBoundaries).toHaveLength(61);
    expect(publicParks).toEqual(
      references.map(
        ({ reference, name, counties, latitude, longitude, grid, potaUrl }) => ({
          reference,
          name,
          counties,
          latitude,
          longitude,
          grid,
          potaUrl,
        }),
      ),
    );

    const items = buildReferenceMapItems({
      references,
      boundaries: referenceBoundaries,
      geojsonByPath: referenceGeojsonByPath,
    });
    expect(items).toHaveLength(61);
    expect(new Set(items.map((item) => item.geometryKind))).toEqual(
      new Set(["boundary", "activation-zone", "point"]),
    );
    expect(items.find((item) => item.reference === "US-4582")).toMatchObject({
      name: "Washington-Rochambeau Revolutionary Route National Historic Trail",
      geometryKind: "activation-zone",
      sourceUrl: expect.stringContaining("Washington_Rochambeau"),
      marker: {
        latitude: expect.any(Number),
        longitude: expect.any(Number),
      },
    });
    expect(items.find((item) => item.reference === "US-6980")).toMatchObject({
      name: "Beach Pond Wildlife Management Area",
      counties: ["Washington County"],
      geometryKind: "point",
      marker: { latitude: 41.5739, longitude: -71.7864 },
    });
  });
});
