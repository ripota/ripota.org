import { describe, expect, it } from "vitest";
import baseLayoutSource from "./BaseLayout.astro?raw";

describe("BaseLayout metadata", () => {
  it("uses the RI POTA coastal signal logo as the site favicon", () => {
    expect(baseLayoutSource).toContain(
      '<link rel="icon" type="image/svg+xml" href="/assets/logos/ri-pota-coastal-signal.svg" />',
    );
    expect(baseLayoutSource).toContain(
      '<link rel="apple-touch-icon" href="/assets/logos/ri-pota-coastal-signal.png" />',
    );
  });
});
