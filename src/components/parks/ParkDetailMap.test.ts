import { describe, expect, it } from "vitest";
import source from "./ParkDetailMap.astro?raw";
import parkPageSource from "../../pages/parks/[reference].astro?raw";

describe("ParkDetailMap", () => {
  it("renders opt-in web geometry and uses canonical metadata for the camera", () => {
    expect(source).toContain("getDisplayReference(reference.reference)");
    expect(source).toContain("geojson: getWebGeometry(reference.reference)");
    expect(source).toContain("displayPoint: display.displayPoint");
    expect(source).toContain("bbox: display.bbox");
    expect(source).toContain("map.fitBounds(parkBounds");
    expect(source).not.toContain("JSON.stringify({ park, relatedParks })");
  });

  it("uses only lazy detailed geometry for location checks and invalidates pending sessions", () => {
    expect(source).toContain("createCanonicalGeometryLoader(park.canonicalGeometryUrl, {");
    expect(source).toContain("expectedReferences: [park.reference]");
    expect(source).toContain("requireCanonicalGeometry(geometry, park.reference)");
    expect(source).not.toContain("classifyLocation(location, park.geojson");
    expect(source).toContain("classificationRequest.invalidate()");
    expect(source).toContain("classificationRequest.request(latestLocation)");
    expect(source).toContain("Loading mapped boundaries…");
    expect(source).toContain("Mapped boundaries could not load");
  });

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

  it("fits the reported accuracy and park geometry in an unobstructed location mode", () => {
    expect(source).toContain('parkHero?.setAttribute("data-location-mode", "active")');
    expect(source).toContain("accuracyLayer?.getBounds()");
    expect(source).toContain("bounds.extend(parkBounds)");
    expect(source).toContain("map.fitBounds(bounds");
    expect(source).toContain("afterLayout(resetView)");
  });

  it("never calls a point-only park inside or outside", () => {
    expect(source).toContain("No mapped boundary available");
    expect(source).toContain("This park has only a reference coordinate");
  });

  it("stops live updates explicitly and when the page is left", () => {
    expect(source).toContain("data-park-location-mode-controls");
    expect(source).toContain("Location mode");
    expect(source).toContain('href="/parks/?location=1"');
    expect(source).toContain("Back to all parks");
    expect(source).toContain("Exit location mode");
    expect(source).toContain("locationSession.stop()");
    expect(source).toContain('destination.searchParams.delete("location")');
    expect(source).toContain('destination.searchParams.delete("from")');
    expect(source).toContain('window.history.scrollRestoration = "auto"');
    expect(source).toContain("window.history.replaceState(");
    expect(source).toContain('"pagehide"');
    expect(source).toContain("locationSession.destroy()");
  });

  it("uses browser history when returning to the originating parks map", () => {
    expect(source).toContain("data-park-location-return");
    expect(source).toContain('get("from") === "parks-map"');
    expect(source).toContain('window.history.scrollRestoration = "manual"');
    expect(source).toContain('referrer.pathname === "/parks/"');
    expect(source).toContain("window.history.back()");
  });

  it("uses wheel zoom while location mode is active", () => {
    expect(source).toContain("map.scrollWheelZoom.enable()");
    expect(source).toContain("map.scrollWheelZoom.disable()");
  });

  it("resumes location mode when navigation carries the opt-in", () => {
    expect(source).toContain(
      'new URLSearchParams(window.location.search).get("location") === "1"',
    );
    expect(source).toContain("locationSession.start()");
  });

  it("uses a full-viewport map in mobile location mode", () => {
    expect(parkPageSource).toContain(
      '.park-hero[data-location-mode="active"]',
    );
    expect(parkPageSource).toContain("min-height: 100svh");
    expect(parkPageSource).toContain("height: 100svh");
  });

  it("gives the return action its own row on narrow phones", () => {
    expect(source).toContain("@media (max-width: 360px)");
    expect(source).toContain("display: contents");
    expect(source).toContain("grid-row: 3");
  });
});
