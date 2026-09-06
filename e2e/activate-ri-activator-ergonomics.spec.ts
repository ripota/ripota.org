import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("volunteer stop pickers keep keyboard focus and independent error descriptions", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.goto(`${server.origin}/activate-ri-2026/volunteer/`);
    const park = page.getByRole("combobox", { name: "Park", exact: true });
    await park.fill("US-2868");
    await park.press("ArrowDown");
    await expect(page.getByRole("button", { name: "US-2868", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(park).toBeFocused();
    await expect(park).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("combobox", { name: "Planned time (EDT)", exact: true }).selectOption("09:00-12:00");
    await page.getByRole("textbox", { name: "Public notes for hunters", exact: true }).fill("Near the parking area.");
    const bands = page.getByRole("button", { name: /^Bands:/ });
    await bands.click();
    await page.getByLabel("40m", { exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(bands).toBeFocused();
    await expect(bands).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Add another park", exact: true }).click();
    const second = page.getByRole("group", { name: "Activation stop 2", exact: true });
    await expect(second.getByRole("combobox", { name: "Park", exact: true })).toHaveAttribute("aria-describedby", "activate-ri-stop-2-park-error");
    await second.getByRole("button", { name: "Remove activation stop 2", exact: true }).click();
    await expect(park).toBeFocused();
    await expect(park).toHaveAttribute("aria-describedby", "activate-ri-stop-1-park-error");
  } finally {
    await server.stop();
  }
});

test("email sign-in reports rejected requests and allows a fresh challenge retry", async ({ page }) => {
  const server = await startActivateRiServer();
  let releaseFirst!: () => void;
  const firstRequest = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  const returnTo = "/activate-ri-2026/activator/plan/?park=US-2868&date=2026-09-12";
  try {
    await page.route("**/turnstile/v0/api.js", (route) => route.fulfill({
      contentType: "application/javascript",
      body: "window.challengeResets = 0; window.turnstile = { reset() { window.challengeResets++; } };",
    }));
    await page.route("**/api/auth/email-login", async (route) => {
      expect(route.request().postDataJSON().returnTo).toBe(returnTo);
      requests += 1;
      if (requests === 1) await firstRequest;
      await route.fulfill({
        status: requests === 1 ? 429 : 200,
        contentType: "application/json",
        body: JSON.stringify(requests === 1 ? { error: "Too many requests. Try again later." } : { message: "Check your email for a sign-in link." }),
      });
    });
    await page.goto(`${server.origin}/account/sign-in/?${new URLSearchParams({ returnTo })}`);
    await page.getByText("Email me a sign-in link", { exact: true }).click();
    await page.getByLabel("Email address", { exact: true }).fill("operator@example.com");
    const submit = page.getByRole("button", { name: "Send sign-in link", exact: true });
    await submit.click();
    await expect(submit).toBeDisabled();
    releaseFirst();
    await expect(page.locator("[data-email-status]")).toHaveText("Too many requests. Try again later.");
    await expect(page.locator("[data-email-status]")).toHaveAttribute("data-status", "error");
    await expect(submit).toBeEnabled();
    await expect.poll(() => page.evaluate(() => (window as Window & { challengeResets?: number }).challengeResets)).toBe(1);
    await submit.click();
    await expect(page.locator("[data-email-status]")).toHaveText("Check your email for a sign-in link.");
    await expect(page.locator("[data-email-status]")).toHaveAttribute("data-status", "success");
    expect(requests).toBe(2);
  } finally {
    releaseFirst();
    await server.stop();
  }
});

test("My Plan and account settings recover from temporary load failures without losing access", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const response = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
      headers: { origin: server.origin },
      data: {
        submitterCallsign: "N1ERG", submitterName: "Ergonomics Test", submitterEmail: "ergonomics@example.com",
        stops: [{ parkReference: "US-2868", plannedDate: "2026-09-11", timeBlock: "09:00-12:00", bands: ["40m"], modes: ["SSB"] }],
      },
    });
    expect(response.ok()).toBe(true);
    const submitted = await response.json() as { editUrl: string };
    await page.route("**/api/activate-ri-2026/activator/plans", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.goto(submitted.editUrl);
    await expect(page.locator("[data-edit-status]")).toContainText("Unable to load your activation plan");
    await page.unroute("**/api/activate-ri-2026/activator/plans");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.locator('[name="submitterCallsign"]')).toHaveValue("N1ERG");
    await expect(page.getByRole("button", { name: "Print my plan", exact: true })).toBeEnabled();

    for (const endpoint of ["session", "passkeys", "sessions"]) {
      await page.route(`**/api/auth/${endpoint}`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    }
    await page.goto(`${server.origin}/activate-ri-2026/activator/account/`);
    await expect(page.locator("[data-account-identity-status]")).toContainText("Unable to load account details");
    await expect(page.locator("[data-passkey-status]")).toContainText("Unable to load passkeys");
    await expect(page.locator("[data-session-status]")).toContainText("Unable to load signed-in browsers");
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/activator/account/`);
    for (const endpoint of ["session", "passkeys", "sessions"]) await page.unroute(`**/api/auth/${endpoint}`);
    await page.locator("[data-retry-account-identity]").click();
    await page.locator("[data-retry-passkeys]").click();
    await page.locator("[data-retry-sessions]").click();
    await expect(page.locator("[data-account-identity-status]")).toContainText("ergonomics@example.com");
    await expect(page.locator("[data-passkey-list]")).toContainText("No passkeys saved yet.");
    await expect(page.locator("[data-session-list]")).toContainText("This browser");
    await expect(page.locator("[data-passkey-status]")).toBeEmpty();
    await expect(page.locator("[data-session-status]")).toBeEmpty();
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
