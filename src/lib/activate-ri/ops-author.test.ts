import { describe, expect, it } from "vitest";
import { opsActivatorAuthorLabel, opsActivatorDisplayName } from "./ops-author";

describe("Ops Room author labels", () => {
  it("pairs a normalized callsign with the activator's first name", () => {
    expect(opsActivatorAuthorLabel("n1rwj", "Rob Jackson")).toBe("N1RWJ - Rob");
    expect(opsActivatorAuthorLabel("K1ABC", "  María-José Rivera  ")).toBe(
      "K1ABC - María-José",
    );
  });

  it("falls back to the callsign when a useful first name is unavailable", () => {
    expect(opsActivatorAuthorLabel(" n1rwj ", "")).toBe("N1RWJ");
    expect(opsActivatorAuthorLabel("N1RWJ", "n1rwj")).toBe("N1RWJ");
  });

  it("uses the complete chosen name and preserves callsign-only choices", () => {
    expect(opsActivatorAuthorLabel("n1rwj", "Rob Jackson", "  Rob J.  ")).toBe("N1RWJ - Rob J.");
    expect(opsActivatorAuthorLabel("K1ABC", "María Rivera", "María José")).toBe("K1ABC - María José");
    expect(opsActivatorAuthorLabel("N1RWJ", "Rob Jackson", "")).toBe("N1RWJ");
    expect(opsActivatorAuthorLabel("N1RWJ", "Rob Jackson", null)).toBe("N1RWJ - Rob");
  });

  it("exposes a default display name without treating blank as a default", () => {
    expect(opsActivatorDisplayName("N1RWJ", "Rob Jackson", null)).toBe("Rob");
    expect(opsActivatorDisplayName("N1RWJ", "Rob Jackson", "")).toBe("");
    expect(opsActivatorDisplayName("N1RWJ", "n1rwj")).toBe("");
  });
});
