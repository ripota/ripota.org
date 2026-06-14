import { describe, expect, it } from "vitest";
import {
  referenceMapZoomOffset,
  resourceIntro,
  officialLinks,
  primaryCallsToAction,
  siteIdentity,
} from "./site";

describe("site content", () => {
  it("points launch CTAs at local community and official POTA resources", () => {
    expect(primaryCallsToAction).toEqual([
      expect.objectContaining({
        label: "Join the RI POTA community",
        href: "https://groups.io/g/RI-POTA",
      }),
      expect.objectContaining({
        label: "Start with official POTA",
        href: "https://docs.pota.app/",
      }),
    ]);
  });

  it("keeps external resources on HTTPS links", () => {
    for (const link of officialLinks) {
      expect(link.href).toMatch(/^https:\/\//);
    }
  });

  it("states that Rhode Island POTA is unofficial", () => {
    expect(siteIdentity.isOfficialPotaSite).toBe(false);
    expect(siteIdentity.disclaimer).toMatch(/not an official Parks on the Air/i);
  });

  it("uses public-ready resource copy instead of launch placeholders", () => {
    expect(resourceIntro).toMatch(/Browse the current Parks on the Air references/i);
    expect(resourceIntro).not.toMatch(/preview only|for launch|placeholder/i);
  });

  it("starts the reference map one zoom level tighter than default bounds fitting", () => {
    expect(referenceMapZoomOffset).toBe(1);
  });
});
