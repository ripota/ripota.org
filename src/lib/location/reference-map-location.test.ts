import { describe, expect, it } from "vitest";
import source from "./reference-map-location.ts?raw";

describe("statewide reference-map location adapter", () => {
  it("uses the shared session and global matcher without persisting coordinates", () => {
    expect(source).toContain("createLocationSession");
    expect(source).toContain("findGlobalLocationMatches(location, items)");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("trackAnalyticsEvent");
    expect(source).not.toContain("fetch(");
  });

  it("renders the accuracy circle and fixed blue dot", () => {
    expect(source).toContain("L.circle(latlng");
    expect(source).toContain("radius: location.accuracy");
    expect(source).toContain('fillColor: "#1577c8"');
    expect(source).toContain("Math.max(map.getZoom(), 14)");
  });

  it("highlights definite and uncertain references separately", () => {
    expect(source).toContain('? "#237242"');
    expect(source).toContain('? "#b56b18"');
    expect(source).toContain('dashArray: isUncertain ? "6 4" : ""');
    expect(source).toContain("applyHighlights(results)");
  });

  it("links each match and nearby result to its field guide", () => {
    expect(source).toContain(
      "`/parks/${encodeURIComponent(match.reference.toLowerCase())}/`",
    );
    expect(source).toContain("Point only");
    expect(source).toContain("formatLocationDistance(match.distanceMeters)");
  });

  it("supports hiding, stopping, background teardown, and errors", () => {
    expect(source).toContain("resultsHidden = true");
    expect(source).toContain("session.stop()");
    expect(source).toContain('"pagehide"');
    expect(source).toContain("session.destroy()");
    expect(source).toContain("Location access is off");
    expect(source).toContain("Location took too long");
  });
});
