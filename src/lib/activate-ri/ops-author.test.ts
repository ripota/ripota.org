import { describe, expect, it } from "vitest";
import { opsActivatorAuthorLabel } from "./ops-author";

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
});
