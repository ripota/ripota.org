import { describe, expect, it } from "vitest";
import source from "./ParkDetailMap.astro?raw";

describe("ParkDetailMap", () => {
  it("presents both area geometry types with the same public terminology", () => {
    expect(source).toContain('boundary: "mapped area"');
    expect(source).toContain('"activation-zone": "mapped area"');
    expect(source).toContain('point: "reference location"');
    expect(source).toContain('aria-label="Map key"');
    expect(source).not.toContain('"activation-zone": "activation zone"');
    expect(source).toContain("`Detailed ${primaryMapLabel} map for ${park.name}`");
  });

  it("initializes the map before adding vectors and renders points without a duplicate marker", () => {
    expect(source.indexOf("map.setView")).toBeLessThan(source.indexOf("L.geoJSON"));
    expect(source).toContain("pointToLayer:");
    expect(source).toContain('payload.park.geometryKind !== "point"');
  });

  it("keeps zoom controls away from the floating identity card", () => {
    expect(source).toContain('position: "bottomright"');
  });

  it("fits mapped areas more tightly than point-only park locations", () => {
    expect(source).toContain(
      'const maxFitZoom = payload.park.geometryKind === "point" ? 14 : 18;',
    );
    expect(source).toContain("maxZoom: maxFitZoom");
  });
});
