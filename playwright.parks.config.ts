import { defineConfig } from "@playwright/test";

// The same read-only browser contract runs against local Wrangler or production.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "parks-web-geometry.spec.ts",
  fullyParallel: true,
  globalSetup: process.env.RIPOTA_PARKS_BASE_URL ? undefined : "./e2e/global-setup.ts",
  workers: 2,
  use: {
    actionTimeout: 10_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
