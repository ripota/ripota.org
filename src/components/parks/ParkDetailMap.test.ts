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

  it("offers location only after an explicit, accessible user action", () => {
    expect(source).toContain('aria-label="Show my location"');
    expect(source).toContain("data-park-map-location");
    expect(source).toContain("locationSession.start()");
    expect(source.indexOf("addEventListener(\"click\"")).toBeLessThan(
      source.indexOf("locationSession.start()"),
    );
    expect(source).toContain(
      "Used on this device; not saved or sent to RI POTA. Map tiles load from OpenStreetMap.",
    );
  });

  it("renders a blue location dot, accuracy circle, and text result", () => {
    expect(source).toContain("L.circle(latlng");
    expect(source).toContain("radius: location.accuracy");
    expect(source).toContain('fillColor: "#1577c8"');
    expect(source).toContain("classifyLocation(location");
    expect(source).toContain("Accuracy ±${Math.round(accuracy)} m");
    expect(source).toContain('role="status"');
  });

  it("never calls a point-only park inside or outside", () => {
    expect(source).toContain("No mapped boundary available");
    expect(source).toContain("This park has only a reference coordinate");
  });

  it("stops live updates explicitly and when the page is left", () => {
    expect(source).toContain("locationSession.stop()");
    expect(source).toContain('"pagehide"');
    expect(source).toContain("locationSession.destroy()");
  });
});
