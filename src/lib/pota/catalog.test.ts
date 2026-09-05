import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dataset, displayReferences, getDisplayReference } from "@ripota/parks/display";
import type { Catalog, CatalogRecord, DisplayReference, GeoJsonFeatureCollection } from "@ripota/parks/types";
import { getCanonicalGeometryUrl, getWebGeometry, readGeometryArtifact } from "./geometry-assets";
import { references, getReference } from "@ripota/parks";
import { describe, expect, expectTypeOf, it } from "vitest";

import packageLock from "../../../package-lock.json";
import packageManifest from "../../../package.json";
import publicParks from "../../../public/data/activate-ri-2026/parks.json";
import { buildReferenceMapItems } from "../reference-map";
import { parksCatalog } from "./catalog";

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
    const entry = createRequire(import.meta.url).resolve("@ripota/parks");
    const installed = JSON.parse(readFileSync(new URL("../package.json", `file://${entry}`), "utf8"));
    expect(installed.version).toBe("3.1.1");
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
    expect(displayReferences).toHaveLength(61);
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
      displayReferences,
    });
    expect(items).toHaveLength(61);
    expect(new Set(items.map((item) => item.geometryKind))).toEqual(
      new Set(["boundary", "activation-zone"]),
    );
    const trail = parksCatalog.references.find(({ reference }) => reference === "US-4582");
    expect(trail?.source.url).toContain("Washington_Rochambeau");
    expect(trail?.geojson.features).toHaveLength(1);
    expect(trail?.geojson.features[0]).not.toHaveProperty("properties.bufferPart");
    expect(items.find((item) => item.reference === "US-4582")).toMatchObject({
      name: "Washington-Rochambeau Revolutionary Route National Historic Trail",
      geometryKind: "activation-zone",
      marker: { latitude: 41.6475389998586, longitude: -71.52119549967506 },
    });
    expect(items.find((item) => item.reference === "US-6980")).toMatchObject({
      name: "Beach Pond Wildlife Management Area",
      counties: ["Washington County"],
      geometryKind: "boundary",
      marker: { latitude: 41.57271847647021, longitude: -71.77973081100671 },
    });
  });

  it("adopts readonly public contracts and handles unknown display lookups", () => {
    expectTypeOf<Catalog["references"]>().toEqualTypeOf<readonly CatalogRecord[]>();
    expectTypeOf<typeof displayReferences>().toEqualTypeOf<readonly DisplayReference[]>();
    expectTypeOf<CatalogRecord["geojson"]>().toEqualTypeOf<GeoJsonFeatureCollection>();
    expectTypeOf<CatalogRecord["counties"]>().toEqualTypeOf<readonly string[]>();
    expect(getDisplayReference("US-UNKNOWN")).toBeUndefined();
    expect(getReference("US-UNKNOWN")).toBeUndefined();
    expect(getDisplayReference("us-4582")).toMatchObject({
      displayPoint: { latitude: 41.7445710002769, longitude: -71.594458000176, source: "reviewed" },
      status: "available", geometryKind: "activation-zone",
    });
    expect(dataset).toMatchObject({ referenceCount: 61, attribution: expect.stringContaining("National Park Service"), disclaimer: expect.stringContaining("valid activation areas") });
    const displaySource = readFileSync(createRequire(import.meta.url).resolve("@ripota/parks/display"), "utf8");
    expect(displaySource).not.toMatch(/(?:import |coordinates|FeatureCollection)/);
  });

  it("retains every canonical feature from the verified v3.0.3 baseline", () => {
    const digest = createHash("sha256").update(JSON.stringify(
      parksCatalog.references.map(({ reference, geojson }) => [reference, geojson.features]),
    )).digest("hex");
    expect(digest).toBe("1db0f2b134d89217f5bf4b47356a884393237577852f275321a4ad3cdc69f93a");
  });

  it("opts into web artifacts and leaves detailed geometry at a separate versioned URL", () => {
    for (const display of displayReferences) {
      const web = getWebGeometry(display.reference);
      expect(web.properties).toMatchObject({ fidelity: "web", potaReference: display.reference });
      expect(web.bbox).toHaveLength(4);
      expect(web.bbox![0]).toBeGreaterThanOrEqual(display.bbox![0]);
      expect(web.bbox![1]).toBeGreaterThanOrEqual(display.bbox![1]);
      expect(web.bbox![2]).toBeLessThanOrEqual(display.bbox![2]);
      expect(web.bbox![3]).toBeLessThanOrEqual(display.bbox![3]);
      expect(getCanonicalGeometryUrl(display.reference)).toBe(`/data/parks/3.1.1/boundaries/${display.reference.toLowerCase()}.geojson`);
      const detailed = JSON.parse(readGeometryArtifact(display.artifact!));
      expect(detailed.properties.fidelity).not.toBe("web");
      expect(detailed.features).toEqual(parksCatalog.references.find(({ reference }) => reference === display.reference)?.geojson.features);
    }
    const detailedTrail = parksCatalog.references.find(({ reference }) => reference === "US-4582")!;
    expect(getWebGeometry("US-4582").features.map(({ geometry }) => geometry))
      .toEqual(detailedTrail.geojson.features.map(({ geometry }) => geometry));
    expect(getCanonicalGeometryUrl()).toBe("/data/parks/3.1.1/all.geojson");
    expect(() => getWebGeometry("US-UNKNOWN")).toThrow("Missing park geometry");
  });

  it("reduces initial US-2870 map geometry by at least thirty percent gzip", () => {
    const detailed = parksCatalog.references.find(({ reference }) => reference === "US-2870")!.geojson;
    const compressed = (value: unknown) => gzipSync(JSON.stringify([value])).length;
    expect(compressed(getWebGeometry("US-2870"))).toBeLessThan(compressed(detailed) * 0.7);
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
        coordinates: readonly (readonly (readonly (readonly number[])[])[])[];
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
