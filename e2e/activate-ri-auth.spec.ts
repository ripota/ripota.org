import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("an existing private link can enroll and later use a real passkey", async ({ page }) => {
  const server = await startActivateRiServer();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
