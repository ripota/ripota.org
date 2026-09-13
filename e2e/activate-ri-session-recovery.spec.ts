import { expect, test } from "@playwright/test";
import type { Cookie, Page } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";
import type { ActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);
test.use({ ignoreHTTPSErrors: true });

let server: ActivateRiServer;
let activatorSequence = 0;

test.beforeAll(async () => {
  server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true, seedAccountOnly: true, https: true });
});

test.afterAll(async () => {
  await server?.stop();
});

const destinations = [
  { name: "chat", path: "/activate-ri-2026/activator/?source=email#ops-message-11111111-1111-4111-8111-111111111111" },
  { name: "plan", path: "/activate-ri-2026/activator/plan/?source=email#plan-title" },
  { name: "media", path: "/activate-ri-2026/activator/media/?source=email#upload" },
];

for (const destination of destinations) {
  test(`an external ${destination.name} link resumes a saved Strict session and preserves its destination`, async ({ page }) => {
    const cookie = await signInActivator(page);
    const target = new URL(destination.path, server.origin);
    const external = new URL("/session-recovery-source/", server.origin);
    external.hostname = "127.0.0.1";
    await page.route(external.href, (route) => route.fulfill({
      contentType: "text/html",
      body: `<a href="${target.href}">Open activator destination</a>`,
    }));
    await page.goto(external.href);

    const navigations: string[] = [];
    let authenticationAttempts = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    page.on("request", (request) => {
      if (request.url().includes("/api/auth/passkey/authentication/")) authenticationAttempts++;
    });
    const entryRequest = page.waitForRequest((request) =>
      request.isNavigationRequest() && request.url() === `${target.origin}${target.pathname}${target.search}`,
    );
    const sessionProbe = page.waitForResponse(`${server.origin}/api/auth/session`);
    await page.getByRole("link", { name: "Open activator destination" }).click();

    // The first cross-site navigation really omits the cookie. The recovery
    // must come from the subsequent same-origin session check, not the fixture.
    expect((await (await entryRequest).allHeaders()).cookie ?? "").not.toContain(cookie.name);
    const probe = await sessionProbe;
    expect(probe.status()).toBe(200);
    expect(await probe.request().headerValue("cookie")).toContain(cookie.name);
    await expect(page).toHaveURL(target.href);
    await expect(page.getByRole("navigation", { name: "Activator tools" })).toBeVisible();
    expect(navigations.some((url) => new URL(url).pathname === "/account/sign-in/")).toBe(true);
    expect(authenticationAttempts).toBe(0);
    expect((await page.context().cookies(server.origin)).find(({ name }) => name === cookie.name)?.value).toBe(cookie.value);
  });
}

test("opening sign-in directly resumes an authenticated activator without a new passkey ceremony", async ({ page }) => {
  const cookie = await signInActivator(page);
  const returnTo = "/activate-ri-2026/activator/media/?source=bookmark#upload";
  let authenticationAttempts = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/auth/passkey/authentication/")) authenticationAttempts++;
  });
  await page.goto(signInUrl(returnTo));
  await expect(page).toHaveURL(`${server.origin}${returnTo}`);
  await expect(page.getByRole("navigation", { name: "Activator tools" })).toBeVisible();
  await page.goto(`${server.origin}/account/sign-in/`);
  await expect(page).toHaveURL(`${server.origin}/account/security/`);
  expect(authenticationAttempts).toBe(0);
  expect((await page.context().cookies(server.origin)).find(({ name }) => name === cookie.name)?.value).toBe(cookie.value);
});

for (const sessionState of ["missing", "expired"] as const) {
  test(`${sessionState === "expired" ? "An expired" : "A missing"} browser cookie leaves sign-in available`, async ({ page }) => {
    if (sessionState === "expired") {
      const cookie = await signInActivator(page);
      await page.context().addCookies([{ ...cookie, expires: Math.floor(Date.now() / 1000) - 60 }]);
      expect((await page.context().cookies(server.origin)).some(({ name }) => name === cookie.name)).toBe(false);
    }
    const url = signInUrl("/activate-ri-2026/activator/media/");
    const sessionProbe = page.waitForResponse(`${server.origin}/api/auth/session`);
    await page.goto(url);
    expect(await (await sessionProbe).json()).toMatchObject({ signedIn: false });
    await expectSignIn(page, url);
  });
}

test("an account without activator membership does not loop through the portal", async ({ page }) => {
  if (!server.accountOnlySessionToken) throw new Error("Account-only fixture session missing.");
  await page.context().addCookies([{
    name: "__Host-ripota-session",
    value: server.accountOnlySessionToken,
    domain: "localhost",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  }]);
  const url = signInUrl("/activate-ri-2026/activator/media/");
  let portalNavigations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && new URL(request.url()).pathname.startsWith("/activate-ri-2026/activator/")) portalNavigations++;
  });
  const sessionProbe = page.waitForResponse(`${server.origin}/api/auth/session`);
  await page.goto(url);
  expect(await (await sessionProbe).json()).toMatchObject({ signedIn: true, activator: null });
  await expectSignIn(page, url);
  expect(portalNavigations).toBe(0);
});

test("explicit passkey reauthentication does not automatically resume an existing session", async ({ page }) => {
  await signInActivator(page);
  const url = new URL(signInUrl("/account/security/#passkeys-title"));
  url.searchParams.set("reauth", "passkey");
  let sessionProbes = 0;
  page.on("request", (request) => {
    if (request.url() === `${server.origin}/api/auth/session`) sessionProbes++;
  });
  await page.goto(url.href);
  await expect(page.getByRole("button", { name: "Sign in with a passkey", exact: true })).toBeEnabled();
  await expect(page.locator("[data-sign-in-controls]")).toBeVisible();
  await expect(page.locator("[data-email-sign-in-option]")).toBeHidden();
  await expect(page).toHaveURL(url.href);
  expect(sessionProbes).toBe(0);
});

test("an activator session cannot automatically resume an administrator destination", async ({ page }) => {
  await signInActivator(page);
  const url = signInUrl("/activate-ri-2026/admin/?view=ops#ops-message-11111111-1111-4111-8111-111111111111");
  const sessionProbe = page.waitForResponse(`${server.origin}/api/auth/session`);
  await page.goto(url);
  expect(await (await sessionProbe).json()).toMatchObject({ signedIn: true, adminAuthorized: false });
  await expectSignIn(page, url);
});

test("a failed session check falls back to usable sign-in", async ({ page }) => {
  await signInActivator(page);
  await page.route(`${server.origin}/api/auth/session`, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Session check temporarily unavailable" }),
  }));
  const url = signInUrl("/activate-ri-2026/activator/media/");
  const sessionProbe = page.waitForResponse(`${server.origin}/api/auth/session`);
  await page.goto(url);
  expect((await sessionProbe).status()).toBe(503);
  await expectSignIn(page, url);
});

function signInUrl(returnTo: string): string {
  return `${server.origin}/account/sign-in/?${new URLSearchParams({ returnTo })}`;
}

async function expectSignIn(page: Page, url: string): Promise<void> {
  await expect(page).toHaveURL(url);
  const passkey = page.getByRole("button", { name: "Sign in with a passkey", exact: true });
  await expect(passkey).toBeVisible();
  await expect(passkey).toBeEnabled();
  await page.getByText("Email me a sign-in link", { exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send sign-in link", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(url);
}

async function signInActivator(page: Page): Promise<Cookie> {
  const callsign = `N1R${String.fromCharCode(65 + activatorSequence++)}`;
  const submission = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
    headers: { origin: server.origin },
    data: {
      submitterCallsign: callsign,
      submitterName: "Session Recovery Test",
      submitterEmail: `${callsign.toLowerCase()}@example.invalid`,
      turnstileToken: "test",
      stops: [{
        parkReference: "US-2868",
        plannedDate: "2026-09-12",
        timeBlock: "09:00-12:00",
        bands: ["40m"],
        modes: ["SSB"],
      }],
    },
  });
  expect(submission.status(), await submission.text()).toBe(202);
  const body = await submission.json() as { editUrl?: string };
  if (!body.editUrl) throw new Error("Activator fixture did not issue a private link.");
  await page.goto(body.editUrl);
  await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/activator/plan/`);
  const cookie = (await page.context().cookies(server.origin)).find(({ name }) => name === "__Host-ripota-session");
  if (!cookie) throw new Error("Activator fixture did not establish a unified session.");
  expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: "Strict" });
  // Do not let the legacy compatibility cookie mask broken unified recovery.
  await page.context().clearCookies({ name: "__Host-activate-ri-session" });
  return cookie;
}
