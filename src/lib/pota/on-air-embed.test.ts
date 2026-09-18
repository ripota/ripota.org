import { describe, expect, it } from "vitest";
import { normalizeEmbedCallsign, onAirEmbedPath, onAirEmbedSnippet, parseOnAirEmbedPath } from "./on-air-embed";

describe("on-air widget addresses", () => {
  it("normalizes labels and round trips portable callsigns as a single segment", () => {
    expect(normalizeEmbedCallsign(" k1nw ")).toBe("K1NW");
    expect(onAirEmbedPath(" k1nw/p ")).toBe("/embed/on-air/K1NW%2FP/");
    expect(parseOnAirEmbedPath(onAirEmbedPath("ea8/k1nw/p"))).toEqual({ callsign: "EA8/K1NW/P" });
    expect(parseOnAirEmbedPath("/embed/on-air/k1nw")).toEqual({ callsign: "K1NW" });
  });

  it("keeps generic URLs usable but requires a callsign to generate a snippet", () => {
    expect(onAirEmbedPath()).toBe("/embed/on-air/");
    expect(parseOnAirEmbedPath("/embed/on-air")).toEqual({ callsign: null });
    expect(parseOnAirEmbedPath("/embed/on-air/")).toEqual({ callsign: null });
    expect(() => onAirEmbedSnippet(" ")).toThrow("Enter your callsign");
    expect(onAirEmbedSnippet(" k1nw ")).toContain('src="https://ripota.org/embed/on-air/K1NW/"');
    expect(onAirEmbedSnippet("K1NW/P")).toContain('src="https://ripota.org/embed/on-air/K1NW%2FP/"');
  });

  it.each(["", " ", "/K1NW", "K1NW/", "K1NW//P", "K1 NW", "<script>", "é1nw", "A".repeat(33)])(
    "rejects unsafe or malformed label %j", value => expect(normalizeEmbedCallsign(value)).toBeNull(),
  );

  it.each(["/embed/other/", "/embed/on-air//", "/embed/on-air/K1NW/P/", "/embed/on-air/%E0%A4/", "/embed/on-air/%3Cscript%3E/"])(
    "rejects malformed path %s", path => expect(parseOnAirEmbedPath(path)).toBeNull(),
  );
});
