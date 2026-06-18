import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bimiLogo = readFileSync(
  new URL("../public/assets/logos/ri-pota-bimi.svg", import.meta.url),
  "utf8",
);
const bimiLogoStats = statSync(
  new URL("../public/assets/logos/ri-pota-bimi.svg", import.meta.url),
);

describe("BIMI logo asset", () => {
  it("uses BIMI-compatible SVG Tiny PS metadata", () => {
    expect(bimiLogo).toContain('version="1.2"');
    expect(bimiLogo).toContain('baseProfile="tiny-ps"');
    expect(bimiLogo).toContain('width="96"');
    expect(bimiLogo).toContain('height="96"');
    expect(bimiLogo).toContain("<title>RI POTA</title>");
    expect(bimiLogo).toContain("<desc>");
  });

  it("stays within Gmail's recommended BIMI SVG size", () => {
    expect(bimiLogoStats.size).toBeLessThanOrEqual(32 * 1024);
  });
});
