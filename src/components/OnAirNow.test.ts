import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import homepageSource from "../pages/index.astro?raw";
import onAirPageSource from "../pages/on-air.astro?raw";
import liveSpotsStoreSource from "../lib/pota/live-spots-store?raw";
import onAirNowSource from "./OnAirNow.astro?raw";
import referenceMapSource from "./ReferenceMap.astro?raw";

const globalStyles = readFileSync(
  new URL("../styles/global.css", import.meta.url),
  "utf8",
);

describe("OnAirNow", () => {
  it("renders an accessible live list on the homepage without treating schedules as live", () => {
    expect(homepageSource).toContain('<OnAirNow variant="compact" />');
    expect(homepageSource).toContain("data-on-air-section");
    expect(homepageSource).toContain("hidden");
    expect(homepageSource.indexOf('id="on-air"')).toBeLessThan(
      homepageSource.indexOf('id="paths"'),
    );
    expect(onAirNowSource).toContain('href="/on-air/"');
    expect(onAirNowSource).toContain('aria-live="polite"');
    expect(onAirNowSource).not.toContain("separate from planned event schedules");
    expect(onAirNowSource).toContain("data-on-air-list");
    expect(onAirNowSource).toContain("No Rhode Island parks have a current active spot");
  });

  it("loads the homepage widget and live map without a preview query gate", () => {
    expect(homepageSource).not.toContain("PreviewGate");
    expect(onAirNowSource).not.toContain("isPreviewFeatureEnabled");
    expect(referenceMapSource).not.toContain("isPreviewFeatureEnabled");
    expect(referenceMapSource).toContain('if (payload.variant === "home")');
  });

  it("offers a dedicated activity dashboard without a reference map", () => {
    expect(onAirPageSource).toContain('canonicalPath="/on-air/"');
    expect(onAirPageSource).toContain('<OnAirNow variant="full" />');
    expect(onAirPageSource).not.toContain("ReferenceMap");
    expect(onAirPageSource).not.toContain("On-air actions");
    expect(onAirPageSource).not.toContain("What this page shows");
    expect(onAirPageSource).toContain("official POTA app");
    expect(onAirPageSource).toContain("<Notice />");
  });

  it("reuses the spot list as table-like rows on the full page and tiles on mobile", () => {
    expect(onAirNowSource).toContain("data-on-air-table-header");
    expect(onAirNowSource).toContain("Frequency / mode");
    expect(onAirNowSource).toContain("spots.map(renderSpot)");
    expect(globalStyles).toContain(".on-air-now--full .on-air-now__list li");
    expect(globalStyles).toContain(
      "grid-template-columns: minmax(280px, 2fr) 100px 150px 150px minmax(120px, 0.7fr)",
    );
  });

  it("shares one one-minute poller and gives each surface an appropriate unavailable state", () => {
    expect(liveSpotsStoreSource).toContain("refreshIntervalMilliseconds = 30_000");
    expect(onAirNowSource).toContain("livePotaSpotsStore.subscribe");
    expect(referenceMapSource).toContain("livePotaSpotsStore.subscribe");
    expect(onAirNowSource).toContain("list?.replaceChildren(...spots.map(renderSpot))");
    expect(onAirNowSource).toContain("renderUnavailable(root)");
    expect(onAirNowSource).toContain("panel.hidden = !visible");
    expect(onAirNowSource).toContain("Live spots are temporarily unavailable.");
    expect(onAirNowSource).toContain('root.classList.contains("on-air-now--full")');
  });

  it("disables pulsing marker animation when reduced motion is requested", () => {
    expect(globalStyles).toContain("reference-map-marker--live");
    expect(globalStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(globalStyles).toContain("animation: none");
  });
});
