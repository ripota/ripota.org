import { describe, expect, it } from "vitest";
import { safeLocalReturnPath } from "./auth-return-path";

describe("safeLocalReturnPath", () => {
  it.each([
    "/activate-ri-2026/activator/plan/?park=US-2868&date=2026-09-12",
    "/activate-ri-2026/parks/?mine=1&county=Newport+County&timeline=2026-09-12",
    "/account/security/#community-byline",
  ])("preserves local destinations and selections: %s", (path) => {
    expect(safeLocalReturnPath(path)).toBe(path);
  });

  it.each([
    undefined, null, 4, "", "https://example.com/", "//example.com/", "/\\example.com/",
    "javascript:alert(1)", "/\t/example.com/", "/path/..//example.com/", "/" + "a".repeat(2048),
  ])("rejects unsafe or malformed destinations: %s", (path) => {
    expect(safeLocalReturnPath(path)).toBeNull();
  });
});
