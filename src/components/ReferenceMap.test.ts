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
});

describe("Activate All RI maps", () => {
  it("renders park pins without sending boundary geometry to the browser", () => {
    for (const source of [eventHeroSource, volunteerPageSource, editPageSource]) {
      expect(source).toContain("showBoundaries={false}");
    }
    expect(referenceMapSource).toContain("geojson: showBoundaries ? item.geojson : null");
  });
});
