import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("the Activator tab opens the recovery flow when this browser has no session", async ({ page, request }) => {
  const server = await startActivateRiServer();
  try {
    const removedPluralRoute = await request.get(
      `${server.origin}/activate-ri-2026/activators/`,
    );
    expect(removedPluralRoute.status()).toBe(404);

    await page.goto(`${server.origin}/activate-ri-2026/`);
    await page.getByRole("link", { name: "Activator", exact: true }).click();

    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/access/`);
    await expect(page.locator(".event-nav a")).toHaveText([
      "Overview",
      "Schedule",
      "Parks",
      "Hunter",
      "Activator",
    ]);
    await expect(page.getByRole("link", { name: "Activator", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("No active activator session was found in this browser.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Plan an activation" })).toHaveAttribute(
      "href",
      "/activate-ri-2026/volunteer/",
    );
    await expect(page.getByRole("heading", { name: "Need your edit link?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send edit link" })).toBeVisible();
  } finally {
    await server.stop();
  }
});
