import { references } from "@ripota/parks";
import { describe, expect, it } from "vitest";

import packageLock from "../../../package-lock.json";
import packageManifest from "../../../package.json";
import publicParks from "../../../public/data/activate-ri-2026/parks.json";
import { buildReferenceMapItems } from "../reference-map";
import {
  parksCatalog,
  referenceBoundaries,
  referenceGeojsonByPath,
} from "./catalog";

describe("@ripota/parks package contract", () => {
  it("pins the immutable v3 release tarball", () => {
    const releaseUrl =
      "https://github.com/ripota/parks/releases/download/v3.1.1/ripota-parks-3.1.1.tgz";

    expect(packageManifest.dependencies["@ripota/parks"]).toBe(releaseUrl);
    expect(packageLock.packages["node_modules/@ripota/parks"]).toMatchObject({
      version: "3.1.1",
      integrity: "sha512-+iWAr1NlaK2vVYl0eDYqCVNTNZi+fezKGWdxJHaOR+MZy3S6gqv13YhRQVFCmI3ZUF4GOkgrD/npFfUDD/iE+g==",
      resolved: releaseUrl,
    });
  });

  it("keeps the v3 metadata API byte-for-byte aligned with the display catalog", () => {
    expect(parksCatalog).toMatchObject({
      $schema: expect.stringContaining("/schemas/v2/catalog.schema.json"),
      schemaVersion: 2,
      geometryRole: "display",
      referenceCount: 61,
      featureCount: 61,
      sourceFeatureCount: 446,
    });
    expect(references).toEqual(
      parksCatalog.references.map(
        ({ status: _status, geometryKind: _geometryKind, mapPoint: _mapPoint, source: _source, geojson: _geojson, ...reference }) =>
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
      new Set(["boundary", "activation-zone"]),
    );
    const trail = parksCatalog.references.find(({ reference }) => reference === "US-4582");
    expect(trail?.geojson.features).toHaveLength(1);
    expect(trail?.geojson.features[0]).not.toHaveProperty("properties.bufferPart");
    expect(items.find((item) => item.reference === "US-4582")).toMatchObject({
      name: "Washington-Rochambeau Revolutionary Route National Historic Trail",
      geometryKind: "activation-zone",
      sourceUrl: expect.stringContaining("Washington_Rochambeau"),
      marker: { latitude: 41.6475389998586, longitude: -71.52119549967506 },
    });
    expect(items.find((item) => item.reference === "US-6980")).toMatchObject({
      name: "Beach Pond Wildlife Management Area",
      counties: ["Washington County"],
      geometryKind: "boundary",
      marker: { latitude: 41.57271847647021, longitude: -71.77973081100671 },
    });
  });

  it("uses one dissolved Arcadia display feature while retaining source provenance", () => {
    const arcadia = parksCatalog.references.find(({ reference }) => reference === "US-6979");
    expect(arcadia?.source.featureIds).toHaveLength(127);
    expect(arcadia?.source.artifact).toBe("source-features/us-6979.geojson");
    expect(arcadia?.geojson).toMatchObject({
      $schema: expect.stringContaining("/schemas/v2/display-geojson.schema.json"),
      properties: {
        schemaVersion: 2,
        geometryRole: "display",
        potaReference: "US-6979",
      },
    });
    expect(arcadia?.geojson.features).toHaveLength(1);

    const feature = arcadia?.geojson.features[0] as {
      properties: Record<string, unknown>;
      geometry: {
        type: "MultiPolygon";
        coordinates: number[][][][];
      };
    };
    expect(feature.properties).toMatchObject({
      potaReference: "US-6979",
      geometryRole: "display",
    });
    expect(feature.geometry.type).toBe("MultiPolygon");
    expect(feature.geometry.coordinates).toHaveLength(25);
    expect(
      feature.geometry.coordinates.reduce(
        (holes, polygon) => holes + Math.max(0, polygon.length - 1),
        0,
      ),
    ).toBe(12);
  });
});
