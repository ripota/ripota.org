import { describe, expect, it } from "vitest";
import source from "./reference-map-location.ts?raw";

describe("statewide reference-map location adapter", () => {
  it("uses the shared session and global matcher without persisting coordinates", () => {
    expect(source).toContain("createLocationSession");
    expect(source).toContain("findGlobalLocationMatches(");
    expect(source).toContain("expandedNearbyLimit");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("trackAnalyticsEvent");
    expect(source).not.toContain("fetch(");
  });

  it("renders the accuracy circle and a blue marker above park highlights", () => {
    expect(source).toContain("L.circle(latlng");
    expect(source).toContain("radius: location.accuracy");
    expect(source).toContain("L.marker(latlng");
    expect(source).toContain('className: "reference-map-user-location-marker"');
    expect(source).toContain("zIndexOffset: 1_000");
    expect(source).toContain("accuracyLayer?.getBounds()");
    expect(source).toContain("results?.nearby.slice(0, 1)");
    expect(source).toContain("map.fitBounds(bounds");
  });

  it("coordinates location mode with the hero, results rail, and previous map view", () => {
    expect(source).toContain('hero?.setAttribute("data-location-mode", "active")');
    expect(source).toContain('locationShell.dataset.locationResults = visible ? "visible" : "hidden"');
    expect(source).toContain("browseView = { center: map.getCenter(), zoom: map.getZoom() }");
    expect(source).toContain("map.setView(browseView.center, browseView.zoom");
  });

  it("highlights definite and uncertain references separately", () => {
    expect(source).toContain('color = "#237242"');
    expect(source).toContain('color = "#b56b18"');
    expect(source).toContain('color = "#6f4618"');
    expect(source).toContain('dashArray: !isHovered && isUncertain ? "6 4" : ""');
    expect(source).toContain("applyHighlights(results)");
  });

  it("links result hover and keyboard focus to a distinct map highlight", () => {
    expect(source).toContain("data-reference-location-reference");
    expect(source).toContain('sheet.addEventListener("pointerover"');
    expect(source).toContain('sheet.addEventListener("focusin"');
    expect(source).toContain('color = "#0b6670"');
    expect(source).toContain("layer.bringToFront()");
  });

  it("starts with three closest parks and can reveal up to eight", () => {
    expect(source).toContain("const collapsedNearbyLimit = 3");
    expect(source).toContain("const expandedNearbyLimit = 8");
    expect(source).toContain("nearbyExpanded = !nearbyExpanded");
    expect(source).toContain("Show fewer parks");
  });

  it("links each match and nearby result to its field guide", () => {
    expect(source).toContain(
      "`/parks/${encodeURIComponent(match.reference.toLowerCase())}/?location=1&from=parks-map`",
    );
    expect(source).toContain("Point only");
    expect(source).toContain("formatLocationDistance(match.distanceMeters)");
  });

  it("enables wheel zoom only while location mode is active", () => {
    expect(source).toContain("map.scrollWheelZoom.enable()");
    expect(source).toContain("map.scrollWheelZoom.disable()");
  });

  it("preserves location mode when navigating to a park", () => {
    expect(source).toContain('destination.searchParams.set("location", "1")');
    expect(source).toContain('destination.searchParams.set("from", "parks-map")');
    expect(source).toContain("saveReturnState()");
    expect(source).toContain(
      'document.addEventListener("click", preserveLocationNavigation, true)',
    );
  });

  it("restores the previous camera and scroll state after returning", () => {
    expect(source).toContain('const parksMapReturnStateKey = "ripotaParksMapReturn"');
    expect(source).toContain("camera: { center: [center.lat, center.lng], zoom: map.getZoom() }");
    expect(source).toContain("scroll: [window.scrollX, window.scrollY]");
    expect(source).toContain("resultsScrollTop: sheet.scrollTop");
    expect(source).toContain('window.history.scrollRestoration = "manual"');
    expect(source).toContain("map.setView(stored.camera.center, stored.camera.zoom");
    expect(source).toContain("window.scrollTo(stored.scroll[0], stored.scroll[1])");
    expect(source).toContain('window.addEventListener("pageshow"');
  });

  it("supports an explicit exit, background teardown, and errors", () => {
    expect(source).toContain("session.stop()");
    expect(source).toContain('destination.searchParams.delete("location")');
    expect(source).toContain('window.history.scrollRestoration = "auto"');
    expect(source).toContain("window.history.replaceState(");
    expect(source).toContain('"pagehide"');
    expect(source).toContain("session.destroy()");
    expect(source).toContain("Location access is off");
    expect(source).toContain("Location took too long");
  });
});
