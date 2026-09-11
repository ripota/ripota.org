import { describe, expect, it } from "vitest";
import source from "./ParkCoverageTable.astro?raw";

describe("ParkCoverageTable markup", () => {
  it("keeps times in Rhode Island time", () => {
    expect(source).not.toContain("data-timezone");
    expect(source).toContain("formatActivationTimeRange(stop)");
  });

  it("keeps current coverage unknown until the public request succeeds", () => {
    expect(source).toContain("Loading the event schedule…");
    expect(source).toContain("Live coverage is unavailable");
    expect(source).toContain("Loading activation plans…");
    expect(source).toContain("Activation plans unavailable");
  });

  it("replaces the binary coverage filter with planning controls", () => {
    expect(source).not.toContain("data-coverage-filter");
    expect(source).not.toContain("Only parks needing coverage");
    expect(source).toContain('data-filter="sort"');
    expect(source).toContain("data-my-parks");
  });
});
