import { describe, expect, it } from "vitest";
import references from "./ri-references.json";
import boundaries from "./ri-reference-boundaries.json";

const referencesById = new Set(references.map((reference) => reference.reference));
const geojsonByPath = import.meta.glob("./boundaries/*.geojson", {
  eager: true,
  query: "?raw",
  import: "default",
});

type BoundaryRecord = {
  reference: string;
  status: "available" | "point-only" | "research-needed";
  geometryKind?: "boundary" | "activation-zone" | "point";
  sourceName: string;
  sourceUrl: string;
  sourceFeatureIds?: Array<string | number>;
  localGeojson?: string;
  notes?: string;
};

describe("Rhode Island POTA reference boundaries", () => {
  it("tracks researched boundary status against known POTA references", () => {
    expect(boundaries.length).toBe(references.length);

    const boundaryReferences = new Set<string>();

    for (const boundary of boundaries as BoundaryRecord[]) {
      expect(boundaryReferences.has(boundary.reference)).toBe(false);
      boundaryReferences.add(boundary.reference);

      expect(referencesById.has(boundary.reference)).toBe(true);
      expect(boundary.sourceName).toEqual(expect.any(String));
      expect(boundary.sourceUrl).toMatch(/^https:\/\//);
      expect(boundary.notes ?? "").not.toMatch(/todo/i);

      if (boundary.status === "available" || boundary.status === "point-only") {
        expect(boundary.geometryKind).toEqual(expect.any(String));
        expect(boundary.localGeojson).toMatch(
          new RegExp(`^./boundaries/${boundary.reference.toLowerCase()}\\.geojson$`),
        );
        expect(boundary.sourceFeatureIds?.length).toBeGreaterThan(0);
      } else if (boundary.status === "research-needed") {
        expect(boundary.localGeojson).toBeUndefined();
      }
    }

    expect(boundaryReferences).toEqual(referencesById);
  });

  it("stores available boundaries as local GeoJSON FeatureCollections", () => {
    const availableBoundaries = (boundaries as BoundaryRecord[]).filter(
      (boundary) => boundary.status === "available" || boundary.status === "point-only",
    );

    expect(availableBoundaries.length).toBeGreaterThan(25);

    for (const boundary of availableBoundaries) {
      const geojson = JSON.parse(geojsonByPath[boundary.localGeojson!] as string) as {
        type: string;
        features: unknown[];
        properties: Record<string, string>;
      };

      expect(geojson.type).toBe("FeatureCollection");
      expect(geojson.features.length).toBeGreaterThan(0);
      expect(geojson.properties).toEqual(
        expect.objectContaining({
          potaReference: boundary.reference,
          sourceName: boundary.sourceName,
          sourceUrl: boundary.sourceUrl,
          geometryKind: boundary.geometryKind,
        }),
      );
    }
  });

  it("uses both reviewed Silver Spring candidate locations", () => {
    const boundary = (boundaries as BoundaryRecord[]).find(
      (candidate) => candidate.reference === "US-10547",
    );

    expect(boundary).toEqual(
      expect.objectContaining({
        status: "available",
        geometryKind: "boundary",
        sourceFeatureIds: expect.arrayContaining([646, 31599]),
      }),
    );
  });

  it("uses all RI DEM Blackstone River records for Blackstone River State Park", () => {
    const boundary = (boundaries as BoundaryRecord[]).find(
      (candidate) => candidate.reference === "US-2869",
    );

    expect(boundary).toEqual(
      expect.objectContaining({
        status: "available",
        geometryKind: "boundary",
        sourceName: "Rhode Island DEM State Conservation Land",
        sourceFeatureIds: [
          5,
          26,
          31,
          33,
          51,
          54,
          314,
          327,
          439,
          502,
          563,
          564,
          590,
          591,
          678,
          679,
          726,
          731,
          965,
          22917,
          27011,
          27012,
          27013,
          38157,
        ],
      }),
    );
  });

  it("stores Washington-Rochambeau as a 100-foot trail activation zone", () => {
    const boundary = (boundaries as BoundaryRecord[]).find(
      (candidate) => candidate.reference === "US-4582",
    );
    const geojson = JSON.parse(geojsonByPath[boundary!.localGeojson!] as string) as {
      features: unknown[];
      properties: Record<string, string | number>;
    };

    expect(boundary).toEqual(
      expect.objectContaining({
        status: "available",
        geometryKind: "activation-zone",
      }),
    );
    expect(geojson.properties.bufferDistanceFeet).toBe(100);
    expect(geojson.properties.bufferRuleSourceUrl).toBe(
      "https://docs.pota.app/docs/activator_reference/activator_guide-english.html#special-considerations-for-trails",
    );
    expect(geojson.features.length).toBeGreaterThan(0);
  });

  it("keeps Beach Pond tied to the POTA coordinate when no boundary source is available", () => {
    const boundary = (boundaries as BoundaryRecord[]).find(
      (candidate) => candidate.reference === "US-6980",
    );

    expect(boundary).toEqual(
      expect.objectContaining({
        status: "point-only",
        geometryKind: "point",
        sourceName: "Parks on the Air reference coordinate",
        sourceUrl: "https://pota.app/#/park/US-6980",
        sourceFeatureIds: ["US-6980"],
      }),
    );
    expect(boundary?.notes).toMatch(/41\.5739, -71\.7864/);
  });
});
