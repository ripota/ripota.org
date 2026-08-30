import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("the Activator tab opens shared sign-in when this browser has no session", async ({ page, request }) => {
  const server = await startActivateRiServer();
  try {
    const removedPluralRoute = await request.get(
      `${server.origin}/activate-ri-2026/activators/`,
    );
    expect(removedPluralRoute.status()).toBe(404);

    await page.goto(`${server.origin}/activate-ri-2026/`);
    await page.getByRole("link", { name: "Activator", exact: true }).click();

    await expect(page).toHaveURL(/\/account\/sign-in\/\?returnTo=/);
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await expect(page.getByText("Email me a sign-in link")).toBeVisible();
  } finally {
    await server.stop();
  }
});
