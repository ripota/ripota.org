import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import homepageSource from "../pages/index.astro?raw";
import liveSpotsStoreSource from "../lib/pota/live-spots-store?raw";
import onAirNowSource from "./OnAirNow.astro?raw";
import previewGateSource from "./PreviewGate.astro?raw";
import referenceMapSource from "./ReferenceMap.astro?raw";

const globalStyles = readFileSync(
  new URL("../styles/global.css", import.meta.url),
  "utf8",
);

describe("OnAirNow", () => {
  it("renders an accessible live list on the homepage without treating schedules as live", () => {
    expect(homepageSource).toContain('<PreviewGate feature="on-air">');
    expect(homepageSource).toContain("<OnAirNow />");
    expect(homepageSource).toContain("data-on-air-section");
    expect(homepageSource).toContain("hidden");
    expect(homepageSource.indexOf('<PreviewGate feature="on-air">')).toBeLessThan(
      homepageSource.indexOf('id="paths"'),
    );
    expect(onAirNowSource).toContain('aria-live="polite"');
    expect(onAirNowSource).toContain("separate from planned event schedules");
    expect(onAirNowSource).toContain("data-on-air-list");
    expect(onAirNowSource).toContain("No Rhode Island parks have a current active spot");
  });

  it("only reveals and polls the live preview after an explicit query opt-in", () => {
    expect(previewGateSource).toContain("data-preview-feature={feature}");
    expect(previewGateSource).toContain("hidden");
    expect(previewGateSource).toContain("element.hidden = false");
    expect(onAirNowSource).toContain('isPreviewFeatureEnabled("on-air")');
    expect(referenceMapSource).toContain(
      'payload.variant === "home" && isPreviewFeatureEnabled("on-air")',
    );
  });

  it("shares one one-minute poller and hides the panel when data is unavailable", () => {
    expect(liveSpotsStoreSource).toContain("refreshIntervalMilliseconds = 60_000");
    expect(onAirNowSource).toContain("livePotaSpotsStore.subscribe");
    expect(referenceMapSource).toContain("livePotaSpotsStore.subscribe");
    expect(onAirNowSource).toContain("list?.replaceChildren(...spots.map(renderSpot))");
    expect(onAirNowSource).toContain("renderUnavailable(root)");
    expect(onAirNowSource).toContain("panel.hidden = !visible");
  });

  it("disables pulsing marker animation when reduced motion is requested", () => {
    expect(globalStyles).toContain("reference-map-marker--live");
    expect(globalStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(globalStyles).toContain("animation: none");
  });
});
