import { describe, expect, it } from "vitest";
import referenceMapSource from "./ReferenceMap.astro?raw";
import eventHeroSource from "./activate-ri/EventHero.astro?raw";
import volunteerPageSource from "../pages/activate-ri-2026/volunteer.astro?raw";
import editPageSource from "../pages/activate-ri-2026/edit/[token].astro?raw";

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
});
