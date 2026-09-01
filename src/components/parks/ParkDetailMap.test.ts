import { describe, expect, it } from "vitest";
import source from "./ParkDetailMap.astro?raw";

describe("ParkDetailMap", () => {
  it("uses honest labels for boundaries, activation zones, and point fallbacks", () => {
    expect(source).toContain('boundary: "park boundary"');
    expect(source).toContain('"activation-zone": "activation zone"');
    expect(source).toContain('point: "reference coordinate"');
    expect(source).toContain("Map geometry");
  });

  it("initializes the map before adding vectors and renders points without a duplicate marker", () => {
    expect(source.indexOf("map.setView")).toBeLessThan(source.indexOf("L.geoJSON"));
    expect(source).toContain("pointToLayer:");
    expect(source).toContain('payload.park.geometryKind !== "point"');
  });

  it("keeps zoom controls away from the floating identity card", () => {
    expect(source).toContain('position: "bottomright"');
  });
});
