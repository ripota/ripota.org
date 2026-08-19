import { describe, expect, it } from "vitest";

import {
  enabledPreviewFeatures,
  isPreviewFeatureEnabled,
  previewQueryParameter,
} from "./preview";

describe("preview features", () => {
  it("uses a stable opt-in query parameter", () => {
    expect(previewQueryParameter).toBe("preview");
  });

  it("accepts repeated and comma-separated feature names", () => {
    expect(
      enabledPreviewFeatures(
        new URLSearchParams("preview=on-air,agenda&preview=faq"),
      ),
    ).toEqual(new Set(["on-air", "agenda", "faq"]));
  });

  it("normalizes names and requires an exact feature match", () => {
    expect(isPreviewFeatureEnabled("on-air", "?preview=%20ON-AIR%20")).toBe(
      true,
    );
    expect(isPreviewFeatureEnabled("on-air", "?preview=on")).toBe(false);
    expect(isPreviewFeatureEnabled("on-air", "")).toBe(false);
  });
});
