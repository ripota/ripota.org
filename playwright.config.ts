import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 2,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
