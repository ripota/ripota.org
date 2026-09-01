import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("an activator confirms a proposed byline and reauthenticates a callsign change on mobile", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const editUrl = await submitVolunteer(page, server.origin, "N1BYL", "byline@example.com");
    const token = new URL(editUrl).hash.slice(1);
    await page.goto(`${server.origin}/activate-ri-2026/edit/${encodeURIComponent(token)}/`);
    await page.goto(`${server.origin}/account/security/#community-byline`);

    const callsign = page.getByLabel("Callsign", { exact: true });
    const publicName = page.getByLabel("Public name (optional)");
    await expect(callsign).toHaveValue("N1BYL");
    await expect(page.getByText(/Activate RI suggests N1BYL/)).toBeVisible();
    await publicName.fill("Mobile Operator");
    await expect(page.getByText("N1BYL · Mobile Operator", { exact: true })).toBeVisible();

    await callsign.focus();
    await page.keyboard.press("Tab");
    await expect(publicName).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Save community byline" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Community byline saved.")).toBeVisible();
    await expect(page.getByText("Event-linked", { exact: true })).toBeVisible();

    await callsign.fill("W1MOBILE");
    await page.getByRole("button", { name: "Save community byline" }).click();
    await expect(page.getByRole("heading", { name: "Confirm it’s still you" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify with a passkey" })).toBeFocused();
    await expect(page.getByText(/does not prove callsign ownership/)).toBeVisible();

    await page.getByRole("button", { name: "Email my reauthentication link" }).click();
    await expect(page.getByText(/fresh reauthentication link/)).toBeVisible();
    const email = await server.waitForEmailText("Your RI POTA sign-in link");
    const link = email.split("\n").find((line) => line.startsWith(`${server.origin}/account/access/#`));
    if (!link) throw new Error("Local reauthentication email did not contain its fragment link.");
    await page.goto(link);
    await expect(page).toHaveURL(`${server.origin}/account/security/`);
    await expect(callsign).toHaveValue("W1MOBILE");
    await page.getByRole("button", { name: "Save community byline" }).click();
    await expect(page.getByText("Community byline saved.")).toBeVisible();
    await expect(page.getByText("W1MOBILE · Mobile Operator", { exact: true })).toBeVisible();

    const panelBox = await page.locator("[data-community-byline]").boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(390);
    const profileResponse = await page.request.get(`${server.origin}/api/auth/community-profile`);
    const profileText = await profileResponse.text();
    expect(profileText).not.toContain("byline@example.com");
    const plan = await page.request.get(`${server.origin}/api/activate-ri-2026/activator/plans`);
    expect(await plan.text()).toContain("N1BYL");
  } finally {
    await server.stop();
  }
});

test("an account-only user deliberately creates a byline without gaining event navigation", async ({ context, page }) => {
  const server = await startActivateRiServer({ seedAccountOnly: true });
  try {
    if (!server.accountOnlySessionToken) throw new Error("Synthetic account-only session missing.");
    await context.addCookies([{
      name: "__Host-ripota-session",
      value: server.accountOnlySessionToken,
      url: server.origin.replace("http:", "https:"),
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    }]);
    await page.goto(`${server.origin}/account/security/#community-byline`);
    await expect(page.getByText(/Verified email \(kept private\): account-only@example.invalid/)).toBeVisible();
    await expect(page.locator("[data-callsign-proposal]")).toBeHidden();
    await page.getByLabel("Callsign", { exact: true }).fill("W1ONLY");
    await page.getByLabel("Public name (optional)").fill("Account Only");
    await page.getByRole("button", { name: "Save community byline" }).click();
    await expect(page.getByText("Community byline saved.")).toBeVisible();
    await expect(page.getByText("Self-asserted", { exact: true })).toBeVisible();

    const session = await page.request.get(`${server.origin}/api/auth/session`);
    const body = await session.json() as { nextRoutes: Array<{ label: string }> };
    expect(body.nextRoutes.map(({ label }) => label)).toEqual(["Account security"]);
  } finally {
    await server.stop();
  }
});

async function submitVolunteer(
  page: Page,
  origin: string,
  callsign: string,
  email: string,
): Promise<string> {
  const response = await page.request.post(`${origin}/api/activate-ri-2026/plans`, {
    headers: { origin },
    data: {
      submitterCallsign: callsign,
      submitterName: "Byline Test",
      submitterEmail: email,
      club: "RI POTA",
      organizerNotes: "Synthetic byline browser test.",
      turnstileToken: "test",
      stops: [{
        parkReference: "US-2868",
        plannedDate: "2026-09-12",
        timeBlock: "09:00-12:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "",
      }],
    },
  });
  const text = await response.text();
  expect(response.status(), text).toBe(202);
  const body = JSON.parse(text) as { editUrl?: string };
  if (!body.editUrl) throw new Error("Synthetic volunteer response did not include an edit URL.");
  return body.editUrl;
}
