import { describe, expect, it } from "vitest";
import { readHunterView, writeHunterView } from "./hunter-view";

describe("hunter filter URLs", () => {
  it.each(["all", "hunted", "remaining"] as const)("round-trips the %s status and special search characters", (status) => {
    const original = new URL("https://ripota.org/activate-ri-2026/hunter/?source=club&source=email#hunter-requested-parks");
    const state = { status, query: "Block & Island + refuge" };
    const result = writeHunterView(original, state);

    expect(readHunterView(result)).toEqual(state);
    expect(result.searchParams.getAll("source")).toEqual(["club", "email"]);
    expect(result.hash).toBe("#hunter-requested-parks");
    expect(original.searchParams.has("q")).toBe(false);
  });

  it("defaults unknown statuses and normalizes surrounding search whitespace", () => {
    expect(readHunterView(new URL("https://ripota.org/activate-ri-2026/hunter/?status=bad&q=%20US-0513%20")))
      .toEqual({ status: "all", query: "US-0513" });
    expect(readHunterView(new URL("https://ripota.org/activate-ri-2026/hunter/")))
      .toEqual({ status: "all", query: "" });
  });

  it("removes default filters while retaining unrelated parameters", () => {
    const result = writeHunterView(new URL("https://ripota.org/activate-ri-2026/hunter/?status=remaining&q=Block&source=club#main"), {
      status: "all", query: " ",
    });
    expect(result.href).toBe("https://ripota.org/activate-ri-2026/hunter/?source=club#main");
  });
});
