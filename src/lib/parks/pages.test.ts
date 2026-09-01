import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET, sitemapPaths } from "../../pages/sitemap.xml";
import { parksCatalog } from "../pota/catalog";
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
  it("provides one unique lowercase canonical path for every catalog reference", () => {
    const paths = parksCatalog.references.map(({ reference }) => parkGuidePath(reference));

    expect(parksCatalog.referenceCount).toBe(61);
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

  it("keeps Phase 1 read-only and explains honest zero-report states", () => {
    expect(detailPage).toContain("No community reports yet");
    expect(detailPage).toContain("does not mean a facility");
    expect(detailPage).toContain("has no park report form, account requirement");
    expect(detailPage).not.toContain("Existing account sign-in");
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
