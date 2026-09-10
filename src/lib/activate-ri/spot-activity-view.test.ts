import { describe, expect, it } from "vitest";
import { readSpotActivityView, writeSpotActivityView } from "./spot-activity-view";

describe("spot activity URLs", () => {
  it.each(["all", "spotted", "unspotted"] as const)("round-trips the %s view and special search characters", (view) => {
    const original = new URL("https://ripota.org/activate-ri-2026/progress/?source=club&source=email#pota-activity-title");
    const state = { view, query: "Block & Island + refuge" };
    const result = writeSpotActivityView(original, state);

    expect(readSpotActivityView(result)).toEqual(state);
    expect(result.searchParams.getAll("source")).toEqual(["club", "email"]);
    expect(result.hash).toBe("#pota-activity-title");
    expect(original.searchParams.has("q")).toBe(false);
  });

  it("reads existing shared view/q links and normalizes invalid values", () => {
    expect(readSpotActivityView(new URL("https://ripota.org/activate-ri-2026/progress/?view=unspotted&q=US-0513")))
      .toEqual({ view: "unspotted", query: "US-0513" });
    expect(readSpotActivityView(new URL("https://ripota.org/activate-ri-2026/progress/?view=unknown&q=%20US-0513%20")))
      .toEqual({ view: "spotted", query: "US-0513" });
    expect(readSpotActivityView(new URL("https://ripota.org/activate-ri-2026/progress/")))
      .toEqual({ view: "spotted", query: "" });
  });

  it("removes default filters while retaining unrelated parameters", () => {
    const result = writeSpotActivityView(new URL("https://ripota.org/activate-ri-2026/progress/?view=all&q=Block&source=club#main"), {
      view: "spotted", query: " ",
    });
    expect(result.href).toBe("https://ripota.org/activate-ri-2026/progress/?source=club#main");
  });
});
