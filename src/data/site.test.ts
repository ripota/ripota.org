import { describe, expect, it } from "vitest";
import {
  defaultShareImage,
  referenceMapZoomBehavior,
  referenceMapZoomOffset,
  resourceIntro,
  officialLinks,
  primaryCallsToAction,
  siteFeedbackLink,
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

  it("routes site feedback to the GitHub issue form", () => {
    expect(siteFeedbackLink).toEqual(
      expect.objectContaining({
        label: "Suggest a site improvement",
        href: "https://github.com/ripota/ripota.org/issues/new?template=site-suggestion.yml",
      }),
    );
    expect(siteFeedbackLink.description).toMatch(/ripota\.org/i);
  });

  it("states that Rhode Island POTA is unofficial", () => {
    expect(siteIdentity.isOfficialPotaSite).toBe(false);
    expect(siteIdentity.disclaimer).toMatch(/not an official Parks on the Air/i);
  });

  it("uses a large landscape image for social share previews", () => {
    expect(defaultShareImage).toEqual(
      expect.objectContaining({
        src: "/assets/ripota-share-card.png",
        width: 1600,
        height: 900,
        type: "image/png",
      }),
    );
    expect(defaultShareImage.alt).toMatch(/RI POTA logo and Rhode Island POTA title/i);
  });

  it("uses public-ready resource copy instead of launch placeholders", () => {
    expect(resourceIntro).toMatch(/Browse the current Parks on the Air references/i);
    expect(resourceIntro).toMatch(/Use the map to get oriented/i);
    expect(resourceIntro).not.toMatch(/preview only|for launch|placeholder/i);
    expect(resourceIntro).not.toMatch(/local convenience|source of truth/i);
  });

  it("starts the reference map one zoom level tighter than default bounds fitting", () => {
    expect(referenceMapZoomOffset).toBe(1);
    expect(referenceMapZoomBehavior).toBe("always-after-fit");
  });
});
