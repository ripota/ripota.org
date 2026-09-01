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

  it("formats the three geometry states", () => {
    expect(parkGeometryLabel(park("US-1", "boundary"))).toBe("Boundary");
    expect(parkGeometryLabel(park("US-2", "activation-zone"))).toBe("Activation zone");
    expect(parkGeometryLabel(park("US-3", "point"))).toBe("Point only");
  });

  it("uses short public descriptions for every map state", () => {
    expect(parkGeometryDescription(park("US-1", "boundary"))).toBe(
      "A mapped boundary is available from the linked public map source.",
    );
    expect(parkGeometryDescription(park("US-2", "point"))).toBe(
      "This record shows a reference coordinate only, not an activation boundary.",
    );
    expect(parkGeometryDescription(park("US-3", "activation-zone"))).toBe(
      "A locally mapped activation zone is shown. Confirm current POTA requirements before activating.",
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
      url: "https://example.com/geometry",
      featureIds,
    },
    geojson: {
      type: "FeatureCollection",
      features: [],
    },
  };
}
