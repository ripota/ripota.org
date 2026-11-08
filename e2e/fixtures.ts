import { test as base } from "@playwright/test";
import { mockThirdPartyAssets } from "./helpers/third-party";

export * from "@playwright/test";
export { createTestContext } from "./helpers/third-party";
export const test = base.extend({
  context: async ({ context }, use) => {
    await mockThirdPartyAssets(context);
    await use(context);
  },
});
