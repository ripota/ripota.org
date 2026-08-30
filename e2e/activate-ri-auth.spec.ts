import { expect, test } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("an existing private link can enroll and later use a real passkey", async ({ page }) => {
  const server = await startActivateRiServer();
  const cdp = await page.context().newCDPSession(page);
  try {
    await addVirtualAuthenticator(cdp);

    const submission = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
      headers: { origin: server.origin },
      data: volunteerPayload(),
    });
    expect(submission.status(), await submission.text()).toBe(202);
    const submitted = await submission.json();
    expect(isRecord(submitted) && typeof submitted.editUrl === "string").toBe(true);
    if (!isRecord(submitted) || typeof submitted.editUrl !== "string") throw new Error("Missing edit URL");
    const token = new URL(submitted.editUrl).hash.slice(1);

    await page.goto(`${server.origin}/activate-ri-2026/edit/${encodeURIComponent(token)}/`);
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/activator/plan/`);
    await page.goto(`${server.origin}/account/security/`);
    await page.getByRole("button", { name: "Add another passkey" }).click();
    await expect(page.getByText("Passkey added.")).toBeVisible();

    const logout = await page.request.post(`${server.origin}/api/auth/logout`, {
      headers: { origin: server.origin },
    });
    expect(logout.ok()).toBe(true);
    await page.goto(`${server.origin}/account/sign-in/?returnTo=%2Faccount%2Fsecurity%2F`);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).toHaveURL(`${server.origin}/account/security/`);
    await expect(page.getByRole("heading", { name: "Account security" })).toBeVisible();
  } finally {
    await cdp.send("WebAuthn.disable").catch(() => undefined);
    await server.stop();
  }
});

test("an Access-bootstrap administrator can enroll and sign in with a passkey", async ({ page }) => {
  const server = await startActivateRiServer();
  const cdp = await page.context().newCDPSession(page);
  try {
    await addVirtualAuthenticator(cdp);
    await page.goto(`${server.origin}/activate-ri-2026/admin/recovery/`);
    await page.getByRole("button", { name: "Continue to passkey setup" }).click();
    await expect(page).toHaveURL(`${server.origin}/account/security/`);
    await page.getByRole("button", { name: "Add another passkey" }).click();
    await expect(page.getByText("Passkey added.")).toBeVisible();

    await page.request.post(`${server.origin}/api/auth/logout`, { headers: { origin: server.origin } });
    await page.goto(`${server.origin}/account/sign-in/?returnTo=%2Factivate-ri-2026%2Fadmin%2F`);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/admin/`);
    const accounts = await page.request.get(`${server.origin}/api/activate-ri-2026/admin/accounts`);
    expect(accounts.status(), await accounts.text()).toBe(200);
  } finally {
    await cdp.send("WebAuthn.disable").catch(() => undefined);
    await server.stop();
  }
});

test("an activator can use only an emailed sign-in link", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await submitVolunteer(page, server.origin, "N1EML", "email-only@example.com");
    const requested = await page.request.post(`${server.origin}/api/auth/email-login`, {
      headers: { origin: server.origin },
      data: { email: "email-only@example.com", turnstileToken: "" },
    });
    expect(requested.ok()).toBe(true);
    const email = await server.waitForEmailText("Your RI POTA sign-in link");
    const link = email.split("\n").find((line) => line.startsWith(`${server.origin}/account/access/#`));
    if (!link) throw new Error("Local sign-in email did not contain its fragment link.");
    await page.goto(link);
    await expect(page).toHaveURL(`${server.origin}/account/security/`);
    await expect(page.getByText(/signed in with an email link/i)).toBeVisible();
    await expect(page.getByText(/Activator access is ready now/i)).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("a dual-role email session cannot use administrator APIs", async ({ page }) => {
  const server = await startActivateRiServer();
  const cdp = await page.context().newCDPSession(page);
  try {
    await addVirtualAuthenticator(cdp);
    await page.goto(`${server.origin}/activate-ri-2026/admin/recovery/`);
    await page.getByRole("button", { name: "Continue to passkey setup" }).click();
    await page.getByRole("button", { name: "Add another passkey" }).click();
    await expect(page.getByText("Passkey added.")).toBeVisible();
    await submitVolunteer(page, server.origin, "N1ADM", "local-admin@ripota.org");
    await page.request.post(`${server.origin}/api/auth/logout`, { headers: { origin: server.origin } });

    await page.request.post(`${server.origin}/api/auth/email-login`, {
      headers: { origin: server.origin },
      data: { email: "local-admin@ripota.org", turnstileToken: "" },
    });
    const email = await server.waitForEmailText("Your RI POTA sign-in link");
    const link = email.split("\n").find((line) => line.startsWith(`${server.origin}/account/access/#`));
    if (!link) throw new Error("Local sign-in email did not contain its fragment link.");
    await page.goto(link);
    await expect(page).toHaveURL(`${server.origin}/account/security/`);
    const denied = await page.request.get(`${server.origin}/api/activate-ri-2026/admin/accounts`);
    expect(denied.status()).toBe(401);
  } finally {
    await cdp.send("WebAuthn.disable").catch(() => undefined);
    await server.stop();
  }
});

test("reset completion revokes the previous passkey and session", async ({ browser }) => {
  const server = await startActivateRiServer();
  const adminContext = await browser.newContext();
  const subjectContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const subjectPage = await subjectContext.newPage();
  const adminCdp = await adminContext.newCDPSession(adminPage);
  const subjectCdp = await subjectContext.newCDPSession(subjectPage);
  try {
    await addVirtualAuthenticator(adminCdp);
    let subjectAuthenticatorId = await addVirtualAuthenticator(subjectCdp);

    await adminPage.goto(`${server.origin}/activate-ri-2026/admin/recovery/`);
    await adminPage.getByRole("button", { name: "Continue to passkey setup" }).click();
    await adminPage.getByRole("button", { name: "Add another passkey" }).click();
    await expect(adminPage.getByText("Passkey added.")).toBeVisible();

    const editUrl = await submitVolunteer(subjectPage, server.origin, "N1RST", "reset@example.com");
    const editToken = new URL(editUrl).hash.slice(1);
    await subjectPage.goto(`${server.origin}/activate-ri-2026/edit/${encodeURIComponent(editToken)}/`);
    await subjectPage.goto(`${server.origin}/account/security/`);
    await subjectPage.getByRole("button", { name: "Add another passkey" }).click();
    await expect(subjectPage.getByText("Passkey added.")).toBeVisible();
    const before = await subjectCdp.send("WebAuthn.getCredentials", {
      authenticatorId: subjectAuthenticatorId,
    });
    expect(before.credentials).toHaveLength(1);
    const oldCredential = before.credentials[0];
    const oldSession = (await subjectContext.cookies(server.origin))
      .find(({ name }) => name === "__Host-ripota-session");
    if (!oldSession) throw new Error("Subject session cookie missing before reset.");

    const accountsResponse = await adminPage.request.get(`${server.origin}/api/activate-ri-2026/admin/accounts`);
    const accountsBody = await accountsResponse.json();
    if (!isRecord(accountsBody) || !Array.isArray(accountsBody.accounts)) throw new Error("Admin account list missing.");
    const subject = accountsBody.accounts.find((value) => isRecord(value) && value.callsign === "N1RST");
    if (!isRecord(subject) || typeof subject.userId !== "string") throw new Error("Reset subject missing.");
    const reset = await adminPage.request.post(
      `${server.origin}/api/activate-ri-2026/admin/accounts/${encodeURIComponent(subject.userId)}/passkey-reset`,
      {
        headers: { origin: server.origin },
        data: { confirmation: "N1RST" },
      },
    );
    expect(reset.status(), await reset.text()).toBe(200);
    const resetEmail = await server.waitForEmailText("Reset your RI POTA passkey");
    const resetLink = resetEmail.split("\n").find((line) => line.startsWith(`${server.origin}/account/access/?purpose=passkey-reset#`));
    if (!resetLink) throw new Error("Local reset email did not contain its fragment link.");

    await subjectPage.goto(resetLink);
    await expect(subjectPage).toHaveURL(`${server.origin}/account/security/`);
    await subjectCdp.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: subjectAuthenticatorId,
    });
    subjectAuthenticatorId = await addVirtualAuthenticator(subjectCdp);
    await subjectPage.getByRole("button", { name: "Add another passkey" }).click();
    await expect(subjectPage.getByText("Passkey added.")).toBeVisible();
    const after = await subjectCdp.send("WebAuthn.getCredentials", {
      authenticatorId: subjectAuthenticatorId,
    });
    expect(after.credentials).toHaveLength(1);

    const oldSessionResponse = await fetch(`${server.origin}/api/auth/session`, {
      headers: { cookie: `${oldSession.name}=${oldSession.value}` },
    });
    await expect(oldSessionResponse.json()).resolves.toMatchObject({ signedIn: false });

    await subjectPage.request.post(`${server.origin}/api/auth/logout`, { headers: { origin: server.origin } });
    await subjectCdp.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: subjectAuthenticatorId,
    });
    const replayAuthenticatorId = await addVirtualAuthenticator(subjectCdp);
    await subjectCdp.send("WebAuthn.addCredential", {
      authenticatorId: replayAuthenticatorId,
      credential: oldCredential,
    });
    await subjectPage.goto(`${server.origin}/account/sign-in/`);
    await subjectPage.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(subjectPage.getByText(/could not verify that passkey/i)).toBeVisible();
  } finally {
    await adminCdp.send("WebAuthn.disable").catch(() => undefined);
    await subjectCdp.send("WebAuthn.disable").catch(() => undefined);
    await adminContext.close();
    await subjectContext.close();
    await server.stop();
  }
});

function volunteerPayload() {
  return {
    submitterCallsign: "N1RIP",
    submitterName: "Auth Test",
    submitterEmail: "auth-test@example.com",
    club: "RI POTA",
    organizerNotes: "Authentication end-to-end test.",
    turnstileToken: "test",
    stops: [{
      parkReference: "US-2868",
      plannedDate: "2026-09-12",
      timeBlock: "09:00-12:00",
      bands: ["40m"],
      modes: ["SSB"],
      publicNotes: "",
    }],
  };
}

async function submitVolunteer(page: Page, origin: string, callsign: string, email: string): Promise<string> {
  const submission = await page.request.post(`${origin}/api/activate-ri-2026/plans`, {
    headers: { origin },
    data: {
      ...volunteerPayload(),
      submitterCallsign: callsign,
      submitterEmail: email,
    },
  });
  expect(submission.status(), await submission.text()).toBe(202);
  const body = await submission.json();
  if (!isRecord(body) || typeof body.editUrl !== "string") throw new Error("Volunteer edit URL missing.");
  return body.editUrl;
}

async function addVirtualAuthenticator(cdp: CDPSession): Promise<string> {
  await cdp.send("WebAuthn.enable");
  const result = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return result.authenticatorId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
