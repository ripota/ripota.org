import { describe, expect, it } from "vitest";
import referenceMapSource from "./ReferenceMap.astro?raw";
import eventHeroSource from "./activate-ri/EventHero.astro?raw";
import volunteerPageSource from "../pages/activate-ri-2026/volunteer.astro?raw";
import editPageSource from "../pages/activate-ri-2026/activator/plan.astro?raw";

describe("ReferenceMap volunteer links", () => {
  it("carries the selected park reference from coverage popups to the volunteer form", () => {
    expect(referenceMapSource).toContain("Volunteer for this park");
    expect(referenceMapSource).toContain(
      'href="/activate-ri-2026/volunteer/?park=${encodeURIComponent(item.reference)}"',
    );
  });

  it("lets volunteers hide parks that already have coverage", () => {
    expect(referenceMapSource).toContain("Only show parks needing coverage");
    expect(referenceMapSource).toContain("data-map-coverage-filter");
    expect(referenceMapSource).toContain('item.coverage?.status === "uncovered"');
    expect(referenceMapSource).toContain('item.coverage?.status === "cancelled-needs-replacement"');
    expect(referenceMapSource).toContain("map.removeLayer(layer)");
    expect(referenceMapSource).toContain("applyCoverageFilter();");
  });

  it("keeps the event volunteer action last when local field-guide links are added", () => {
    const popupStart = referenceMapSource.indexOf("const volunteerAction =");
    const popupEnd = referenceMapSource.indexOf(
      "function potaStatusLabel",
      popupStart,
    );
    const coveragePopup = referenceMapSource.slice(popupStart, popupEnd);

    expect(coveragePopup).toContain('data-analytics-action="volunteer"');
    expectVolunteerActionLast(coveragePopup);

    const representativeParkChange = coveragePopup.replace(
      "${volunteerAction}",
      "${localFieldGuideLink(item)}\n        ${volunteerAction}",
    );
    expectVolunteerActionLast(representativeParkChange);
  });
});

describe("Activate All RI maps", () => {
  it("renders park pins without sending boundary geometry to the browser", () => {
    for (const source of [eventHeroSource, volunteerPageSource, editPageSource]) {
      expect(source).toContain("showBoundaries={false}");
    }
    expect(referenceMapSource).toContain("geojson: showBoundaries ? item.geojson : null");
  });
});

describe("homepage live spots map", () => {
  it("subscribes to shared live POTA spots and replaces active marker state", () => {
    expect(referenceMapSource).toContain("livePotaSpotsStore.subscribe");
    expect(referenceMapSource).not.toContain("window.setInterval");
    expect(referenceMapSource).not.toContain("isPreviewFeatureEnabled");
    expect(referenceMapSource).toContain('item.liveSpots = spotsByReference.get(item.reference) ?? []');
    expect(referenceMapSource).toContain('"reference-map-marker--live"');
    expect(referenceMapSource).toContain("On air now");
  });

  it("links every park popup to its local field guide", () => {
    expect(referenceMapSource).toContain("Open local field guide");
    expect(referenceMapSource).toContain("localFieldGuideLink(item)");
    expect(referenceMapSource).toContain(
      '/parks/${encodeURIComponent(item.reference.toLowerCase())}/',
    );
  });
});

describe("park directory map", () => {
  it("uses a static discovery variant without event coverage or live-spot semantics", () => {
    expect(referenceMapSource).toContain('payload.variant === "home" || payload.variant === "directory"');
    expect(referenceMapSource).toContain('payload.variant === "home" ? liveSpotsHtml(item) : ""');
    expect(referenceMapSource).toContain(
      'payload.variant === "coverage" || payload.variant === "volunteer"',
    );
    expect(referenceMapSource).toContain('payload.variant === "directory"');
    expect(referenceMapSource).toContain('paddingTopLeft: [Math.min(760, window.innerWidth * 0.52), 32]');
    expect(referenceMapSource).toContain("references: parksCatalog.references");
    expect(referenceMapSource).toContain("bounds.extend([item.marker.latitude, item.marker.longitude])");
  });

  it("loads the location experience only for the all-parks directory", () => {
    expect(referenceMapSource).toContain('variant === "directory" && (');
    expect(referenceMapSource).toContain('aria-label="Show my location"');
    expect(referenceMapSource).toContain("data-reference-location-results");
    expect(referenceMapSource).toContain(
      'if (payload.variant === "directory")',
    );
    expect(referenceMapSource).toContain(
      'import("../lib/location/reference-map-location")',
    );
    expect(referenceMapSource).toContain(
      'markerPlacement: variant === "directory" ? "reference-coordinate" : "geometry-center"',
    );
  });

  it("provides accessible ordered result groups and an explicit mode exit", () => {
    expect(referenceMapSource).toContain('role="status"');
    expect(referenceMapSource).toContain("Mapped matches");
    expect(referenceMapSource).toContain("Boundary uncertainty");
    expect(referenceMapSource).toContain("Closest parks");
    expect(referenceMapSource).toContain("data-reference-location-more");
    expect(referenceMapSource).toContain("Location mode");
    expect(referenceMapSource).toContain("Exit location mode");
    expect(referenceMapSource).toContain("data-reference-location-stop");
    expect(referenceMapSource).toContain("Park map point");
    expect(referenceMapSource).toContain("Your location");
    expect(referenceMapSource).not.toContain('aria-label="Hide location results"');
  });
});

function expectVolunteerActionLast(popupSource: string): void {
  const volunteerIndex = popupSource.lastIndexOf("${volunteerAction}");
  const localGuideIndex = popupSource.indexOf("${localFieldGuideLink(item)}");

  expect(volunteerIndex).toBeGreaterThan(popupSource.indexOf("Open coverage table"));
  if (localGuideIndex >= 0) {
    expect(volunteerIndex).toBeGreaterThan(localGuideIndex);
  }
}
