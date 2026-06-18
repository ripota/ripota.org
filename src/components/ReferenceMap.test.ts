import { describe, expect, it } from "vitest";
import referenceMapSource from "./ReferenceMap.astro?raw";

describe("ReferenceMap volunteer links", () => {
  it("carries the selected park reference from coverage popups to the volunteer form", () => {
    expect(referenceMapSource).toContain("Volunteer for this park");
    expect(referenceMapSource).toContain(
      'href="/activate-ri-2026/volunteer/?park=${encodeURIComponent(item.reference)}"',
    );
  });
});
