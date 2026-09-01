import { readFileSync } from "node:fs";
import { references } from "@ripota/parks";
import { describe, expect, it } from "vitest";
import { GET, sitemapPaths } from "../../pages/sitemap.xml";
import { parkGuidePath } from "./directory";

const detailPage = readFileSync(
  new URL("../../pages/parks/[reference].astro", import.meta.url),
  "utf8",
);
const directoryPage = readFileSync(
  new URL("../../pages/parks/index.astro", import.meta.url),
  "utf8",
);

describe("park field-guide routes", () => {
  it("provides one unique lowercase canonical path for every POTA reference", () => {
    const paths = references.map(({ reference }) => parkGuidePath(reference));

    expect(references).toHaveLength(61);
    expect(paths).toHaveLength(61);
    expect(new Set(paths).size).toBe(61);
    expect(paths.every((path) => /^\/parks\/us-\d+\/$/.test(path))).toBe(true);
    expect(detailPage).toContain("params: { reference: park.reference.toLowerCase() }");
    expect(detailPage).toContain("canonicalPath={parkGuidePath(park.reference)}");
  });

  it("is indexable after final review while retaining canonical metadata", () => {
    expect(directoryPage).not.toContain("noIndex");
    expect(detailPage).not.toContain("noIndex");
    expect(directoryPage).toContain('canonicalPath="/parks/"');
    expect(detailPage).toContain("canonicalPath={parkGuidePath(park.reference)}");
  });

  it("keeps the interim community state neutral and read-only", () => {
    expect(detailPage).toContain("No community reports yet.");
    expect(detailPage.match(/No community reports yet\./g)).toHaveLength(1);
    expect(detailPage).not.toContain("park report form");
    expect(detailPage).not.toContain("write path");
    expect(detailPage).not.toContain("Existing account sign-in");
  });

  it("keeps prototype and rollout narration out of public park pages", () => {
    const publicParkPages = `${detailPage}\n${directoryPage}`;
    const removedPhrases = [
      "0 community reports",
      "0 · be the first",
      "Why reports are empty",
      "Catalog facts",
      "What exists now",
      "Calculated first, contributed second",
      "Everything practical is still open",
      "First-report queue",
      "park report form",
      "account requirement",
      "write path",
      "Nothing is being inferred from silence",
      "Receipts, not mystery data",
      "No same-geometry candidate found",
      "No same-geometry match detected",
      "How these pages grow",
      "Community reports later",
    ];

    for (const phrase of removedPhrases) {
      expect(publicParkPages).not.toContain(phrase);
    }
  });

  it("renders map facts once and guards the relationship section", () => {
    expect(detailPage.match(/id="map-facts"/g)).toHaveLength(1);
    expect(detailPage.match(/id="overlap"/g)).toHaveLength(1);
    expect(detailPage).toContain("{relatedParks.length > 0 && (");
    expect(detailPage).toContain("Possible 2-fer");
    expect(detailPage).toContain("relationshipParks.map");
    expect(detailPage).toContain("parkGuidePath(relationshipPark.reference)");
    expect(detailPage).toContain("relationshipPark.potaUrl");
    expect(detailPage).toContain("keep the entire");
    expect(detailPage).toContain("station valid for both");
  });

  it("retains official sources, map attribution, and the site notice", () => {
    expect(detailPage).toContain("Official POTA page");
    expect(detailPage).toContain("Official POTA reference");
    expect(detailPage).toContain("Open map source");
    expect(detailPage).toContain("park.source.url");
    expect(detailPage).toContain("<Notice />");
    expect(directoryPage).toContain("<Notice />");
  });

  it("hides uniform zero-report counts from the park directory", () => {
    expect(directoryPage).not.toContain("0 reports");
    expect(directoryPage).not.toContain("Community reports</dt>");
    expect(directoryPage).not.toContain('data-variant="empty"');
    expect(directoryPage).toContain("Activation zones");
  });

  it("includes every park route in the generated sitemap", async () => {
    const paths = sitemapPaths();
    const parkPaths = paths.filter((path) => path.startsWith("/parks/") && path !== "/parks/");
    const response = GET();
    const xml = await response.text();

    expect(parkPaths).toHaveLength(61);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    for (const path of parkPaths) {
      expect(xml).toContain(`<loc>https://ripota.org${path}</loc>`);
    }
  });
});
