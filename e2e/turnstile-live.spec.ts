// This opt-in provider contract deliberately uses Playwright without the
// deterministic third-party fixtures used by the application suite.
import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.skip(process.env.RIPOTA_E2E_LIVE_SERVICES !== "1", "Opt-in live Turnstile provider check.");
test.setTimeout(60_000);

test("the real Turnstile test widget supplies a token to the sign-in form", async ({ page }) => {
  const server = await startActivateRiServer();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${server.origin}/account/sign-in/`);
    await page.getByText("Email me a sign-in link", { exact: true }).click();
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 });
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
