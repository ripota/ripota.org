import { describe, expect, it } from "vitest";
import {
  parkGeometryDescription,
  parkGeometryLabel,
  parkGuideNavigationItems,
  parkGuidePath,
  sameGeometryReferences,
  sameGeometryReferenceSet,
} from "./directory";
import { parksCatalog, type ParksCatalogReference } from "../pota/catalog";

describe("park directory helpers", () => {
  it("builds stable lowercase reference paths", () => {
    expect(parkGuidePath(" US-2878 ")).toBe("/parks/us-2878/");
  });

  it("uses one public label for either kind of mapped area", () => {
    expect(parkGeometryLabel(park("US-1", "boundary"))).toBe("Mapped area");
    expect(parkGeometryLabel(park("US-2", "activation-zone"))).toBe("Mapped area");
    expect(parkGeometryLabel(park("US-3", "point"))).toBe("Reference location");
  });

  it("uses short public descriptions for every map state", () => {
    expect(parkGeometryDescription(park("US-1", "boundary"))).toBe(
      "The highlighted area is based on the linked public map source. Confirm current POTA requirements before activating.",
    );
    expect(parkGeometryDescription(park("US-2", "point"))).toBe(
      "The map shows the official POTA reference location because a local mapped area is not available.",
    );
    expect(parkGeometryDescription(park("US-3", "activation-zone"))).toBe(
      "The highlighted area is based on the linked public map source. Confirm current POTA requirements before activating.",
    );
  });

  it("adds relationship navigation only when a relationship exists", () => {
    expect(parkGuideNavigationItems(false)).toEqual([
      { href: "#map-facts", label: "Map facts" },
      { href: "#community-reports", label: "Community reports" },
      { href: "#sources", label: "Sources" },
    ]);
    expect(parkGuideNavigationItems(true)).toContainEqual({
      href: "#overlap",
      label: "Possible 2-fer",
    });
  });

  it("finds references that use the same reviewed source features", () => {
    const parks = [
      park("US-2878", "boundary", [53, 61]),
      park("US-5483", "boundary", [61, 53]),
      park("US-9999", "boundary", [70]),
      park("US-8888", "activation-zone", [53, 61]),
      park("US-7777", "boundary", [53, 61], "https://example.com/other-geometry"),
    ];

    expect(sameGeometryReferences(parks, "US-2878").map(({ reference }) => reference))
      .toEqual(["US-5483"]);
    expect([...sameGeometryReferenceSet(parks)].sort()).toEqual(["US-2878", "US-5483"]);
  });

  it("covers the representative live relationship states", () => {
    expect(sameGeometryReferences(parksCatalog.references, "US-6979")).toEqual([]);
    expect(
      sameGeometryReferences(parksCatalog.references, "US-2878").map(
        ({ reference }) => reference,
      ),
    ).toEqual(["US-5483"]);
  });
});

function park(
  reference: string,
  geometryKind: ParksCatalogReference["geometryKind"],
  featureIds: Array<string | number> = [1],
  sourceUrl = "https://example.com/geometry",
): ParksCatalogReference {
  return {
    reference,
    name: reference,
    latitude: 41.7,
    longitude: -71.4,
    grid: "FN41",
    counties: ["Providence County"],
    locationDesc: "US-RI",
    potaUrl: `https://pota.app/#/park/${reference}`,
    status: geometryKind === "point" ? "point-only" : "available",
    geometryKind,
    source: {
      name: "Test source",
      url: sourceUrl,
      featureIds,
      artifact: `source-features/${reference.toLowerCase()}.geojson`,
    },
    geojson: {
      $schema: "https://ripota.org/schemas/v2/display-geojson.schema.json",
      type: "FeatureCollection",
      properties: {
        schemaVersion: 2,
        geometryRole: "display",
        geometryKind,
        potaReference: reference,
        potaName: reference,
        sourceName: "Test source",
        sourceUrl,
        sourceFeatureIds: featureIds,
      },
      features: [],
    },
  };
}
