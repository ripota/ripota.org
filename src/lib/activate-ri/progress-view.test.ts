import { describe, expect, it } from "vitest";
import { readProgressView, writeProgressView } from "./progress-view";

describe("progress view URLs", () => {
  it.each(["confirmed", "observed", "scheduled", "needed"] as const)("round-trips the %s status and park search without changing planner state or the anchor", (status) => {
    const original = new URL("https://ripota.org/activate-ri-2026/parks/?sort=slots&mode=CW&source=club&source=email#park-planning");
    const view = { status, query: "Block & Island" };
    const result = writeProgressView(original, view);

    expect(readProgressView(result)).toEqual(view);
    expect(result.searchParams.get("sort")).toBe("slots");
    expect(result.searchParams.get("mode")).toBe("CW");
    expect(result.searchParams.getAll("source")).toEqual(["club", "email"]);
    expect(result.hash).toBe("#park-planning");
    expect(original.searchParams.has("progress-status")).toBe(false);
    expect(result).not.toBe(original);
  });

  it("uses All for absent or unknown statuses and normalizes surrounding search whitespace", () => {
    expect(readProgressView(new URL("https://ripota.org/activate-ri-2026/parks/"))).toEqual({ status: "all", query: "" });
    expect(readProgressView(new URL("https://ripota.org/activate-ri-2026/parks/?progress-status=bad&progress-q=%20US-0513%20"))).toEqual({ status: "all", query: "US-0513" });
  });

  it("removes only progress defaults and leaves adjacent search and filter parameters intact", () => {
    const result = writeProgressView(new URL("https://ripota.org/activate-ri-2026/parks/?progress-status=needed&progress-q=Block&q=other&timeline=main"), { status: "all", query: " " });
    expect(Object.fromEntries(result.searchParams)).toEqual({ q: "other", timeline: "main" });
  });
});
