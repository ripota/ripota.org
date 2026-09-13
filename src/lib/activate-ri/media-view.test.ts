import { describe, expect, it } from "vitest";
import { readMediaFilters, writeMediaFilters } from "./media-view";

const defaults = { park: "", kind: "" as const, featured: false };

describe("media filter URLs", () => {
  it("round trips the organizer's featured selection without changing unrelated filters, detail links, or anchors", () => {
    const original = new URL("https://ripota.org/activate-ri-2026/admin/?view=media&source=recap&mediaId=photo-id&mediaPark=general#photos");
    const selected = { ...defaults, featured: true };
    const url = writeMediaFilters(original, selected, "admin");
    expect(url.searchParams.get("mediaFeatured")).toBe("1");
    expect(readMediaFilters(url, "admin")).toEqual(selected);
    expect(url.searchParams.get("view")).toBe("media");
    expect(url.searchParams.get("source")).toBe("recap");
    expect(url.searchParams.get("mediaId")).toBe("photo-id");
    expect(url.searchParams.get("mediaPark")).toBe("general");
    expect(url.hash).toBe("#photos");
    expect(original.searchParams.has("mediaFeatured")).toBe(false);
    expect(writeMediaFilters(url, defaults, "admin").href).toBe(original.href);
  });

  it("normalizes every organizer default or invalid featured value to an omitted parameter", () => {
    for (const query of ["", "mediaFeatured=", "mediaFeatured=0", "mediaFeatured=true", "mediaFeatured=2", "mediaFeatured=photo"]) {
      const url = new URL(`https://ripota.org/activate-ri-2026/admin/?view=media&${query}#photos`);
      const selected = readMediaFilters(url, "admin");
      expect(selected).toEqual(defaults);
      expect(writeMediaFilters(url, selected, "admin").href).toBe("https://ripota.org/activate-ri-2026/admin/?view=media#photos");
    }
  });

  it("keeps existing public park and type filters combined and preserves unrelated parameters", () => {
    const url = new URL("https://ripota.org/activate-ri-2026/media/?mediaPark=US-2868&mediaKind=photo&source=recap#photos");
    const selected = readMediaFilters(url, "public");
    expect(selected).toEqual({ park: "US-2868", kind: "photo", featured: false });
    expect(writeMediaFilters(url, selected, "public").href).toBe(url.href);
    expect(writeMediaFilters(url, defaults, "public").href).toBe("https://ripota.org/activate-ri-2026/media/?source=recap#photos");
    expect(readMediaFilters(new URL("https://ripota.org/?mediaPark=general&mediaKind=video"), "public"))
      .toEqual({ park: "general", kind: "video", featured: false });
    expect(readMediaFilters(new URL("https://ripota.org/?mediaPark=US-INVALID&mediaKind=all"), "public"))
      .toEqual(defaults);
  });

  it("does not activate the organizer filter for personal or public galleries", () => {
    const url = new URL("https://ripota.org/?mediaFeatured=1&mediaPark=general&mediaKind=video#photos");
    expect(readMediaFilters(url, "public")).toEqual({ park: "general", kind: "video", featured: false });
    expect(readMediaFilters(url, "activator")).toEqual(defaults);
    expect(readMediaFilters(url, "admin")).toEqual({ ...defaults, featured: true });
    expect(writeMediaFilters(url, defaults, "activator").href).toBe(url.href);
    // Another workspace's namespaced filter is preserved, never applied.
    expect(writeMediaFilters(url, defaults, "public").searchParams.get("mediaFeatured")).toBe("1");
  });
});
