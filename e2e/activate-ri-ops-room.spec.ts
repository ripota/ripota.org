import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("approved activators acknowledge rules and exchange a live room message", async ({
  browser,
  request,
}) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const callsign = randomCallsign();
  const email = `${callsign.toLowerCase()}@example.com`;
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const adminContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const admin = await adminContext.newPage();

  try {
    const submit = await request.post(`${server.origin}/api/activate-ri-2026/plans`, {
      headers: {
        "content-type": "application/json",
        origin: server.origin,
      },
      data: {
        submitterCallsign: callsign,
        submitterName: "Ops Room Activator",
        submitterEmail: email,
        stops: [{
          parkReference: "US-2868",
          plannedDate: "2026-09-11",
          timeBlock: "09:00-12:00",
          bands: ["40m"],
          modes: ["SSB"],
        }],
      },
    });
    const submitBody = await submit.json() as { editUrl: string };

    const pending = await request.get(`${server.origin}/api/activate-ri-2026/admin/plans`, {
      headers: { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org" },
    });
    const pendingBody = await pending.json() as { plans: Array<{ id: string; submitter_callsign: string }> };
    const plan = pendingBody.plans.find((candidate) => candidate.submitter_callsign === callsign);
    expect(plan).toBeDefined();
    const approval = await request.post(
      `${server.origin}/api/activate-ri-2026/admin/plans/${encodeURIComponent(plan!.id)}/approve`,
      { headers: { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org" } },
    );
    expect(approval.ok()).toBe(true);

    const mode = await request.patch(`${server.origin}/api/activate-ri-2026/admin/ops/settings`, {
      headers: {
        "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org",
        "content-type": "application/json",
        origin: server.origin,
      },
      data: { roomMode: "full" },
    });
    expect(mode.ok(), await mode.text()).toBe(true);

    await first.goto(submitBody.editUrl);
    await expect(first).toHaveURL(`${server.origin}/activate-ri-2026/activator/plan/`);
    await first.goto(`${server.origin}/activate-ri-2026/activator/`);
    await expect(first.locator(".event-nav").first().getByRole("link", { name: "Activator", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(first.getByRole("navigation", { name: "Activator tools" })).toBeVisible();
    await expect(first.getByRole("dialog", { name: "Coordinate clearly. Operate safely." })).toBeVisible();
    await first.getByRole("button", { name: "Enter the Ops Room" }).click();
    await expect(first.getByRole("dialog", { name: "Coordinate clearly. Operate safely." })).toBeHidden();
    await expect(first.locator("[data-ops-connection-label]")).toHaveText("Live");

    await second.goto(submitBody.editUrl);
    await expect(second).toHaveURL(`${server.origin}/activate-ri-2026/activator/plan/`);
    await second.goto(`${server.origin}/activate-ri-2026/activator/`);
    await expect(second.locator("[data-ops-connection-label]")).toHaveText("Live");

    await second.locator("[data-ops-email-preferences] summary").click();
    const emailPreference = second.getByLabel("Email me every new room message");
    await expect(emailPreference).not.toBeChecked();
    await emailPreference.check();
    await second.getByRole("button", { name: "Save preferences" }).click();
    await expect(second.locator("[data-ops-email-status]")).toContainText("every new room message");
    await second.goto(`${server.origin}/activate-ri-2026/activator/account/#ops-email-notifications`);
    await expect(second.getByLabel("Email me every new room message")).toBeChecked();
    await second.getByLabel("Turn off all Ops Room emails").check();
    await second.getByRole("button", { name: "Save preferences" }).click();
    await expect(second.locator("[data-ops-email-status]")).toHaveText("Saved. All Ops Room emails are off.");
    await second.goto(`${server.origin}/activate-ri-2026/activator/`);
    await expect(second.locator("[data-ops-connection-label]")).toHaveText("Live");

    await first.locator("[data-ops-body]").fill("Checking in from Beavertail.");
    await first.locator("[data-ops-options] summary").click();
    const stopOption = first.locator("[data-ops-context] option").filter({
      hasText: /US-2868.*Beavertail/,
    }).first();
    await first.locator("[data-ops-context]").selectOption(await stopOption.getAttribute("value") ?? "");
    await first.getByRole("button", { name: "Send", exact: true }).click();
    await expect(first.locator("[data-ops-send-state]")).toHaveText("Sent");
    await expect(second.locator("[data-ops-feed]")).toContainText(
      "Checking in from Beavertail.",
    );
    await expect(second.locator("[data-ops-feed]")).toContainText("US-2868");
    await expect(second.locator("[data-ops-feed]")).toContainText(
      `${callsign} - Ops`,
    );

    await firstContext.setOffline(true);
    await first.locator("[data-ops-body]").fill("Drafted while offline.");
    await first.getByRole("button", { name: "Send", exact: true }).click();
    await expect(first.locator("[data-ops-unsent]")).toBeVisible();
    await firstContext.setOffline(false);
    await expect(first.locator("[data-ops-connection-label]")).toHaveText("Live");
    await expect(second.locator("[data-ops-feed]")).not.toContainText("Drafted while offline.");
    await first.getByRole("button", { name: "Send", exact: true }).click();
    await expect(second.locator("[data-ops-feed]")).toContainText("Drafted while offline.");

    await admin.goto(`${server.origin}/activate-ri-2026/admin/`);
    await expect(admin.locator("[data-admin-ops-status]")).toHaveText(
      "Ops Room state is current.",
    );
    await admin.locator("[data-ops-email-preferences] summary").click();
    await admin.getByLabel("Email me every new room message").check();
    await admin.getByRole("button", { name: "Save preferences" }).click();
    await expect(admin.locator("[data-ops-email-status]")).toContainText("every new room message");
    await admin.reload();
    await admin.locator("[data-ops-email-preferences] summary").click();
    await expect(admin.getByLabel("Email me every new room message")).toBeChecked();
    await first.locator("[data-ops-body]").fill("Can an organizer help with my next stop?");
    await first.getByRole("button", { name: "Send", exact: true }).click();
    await expect(first.locator("[data-ops-send-state]")).toHaveText("Sent");
    const notificationMessage = first.locator("[data-ops-feed] > li").filter({ hasText: "Can an organizer help with my next stop?" });
    const notificationId = await notificationMessage.getAttribute("id");
    const notificationEmail = await server.waitForEmailText(`Ops Room: ${callsign} - Ops posted a new message`);
    expect(notificationEmail).toContain("Can an organizer help with my next stop?");
    expect(notificationEmail).toContain(`/activate-ri-2026/admin/?view=ops#${notificationId}`);
    await admin.evaluate(() => localStorage.setItem("activate-ri-admin-workspace", "plans"));
    await admin.goto(`${server.origin}/activate-ri-2026/admin/?view=ops#${notificationId}`);
    await expect(admin.locator(`#${notificationId}`)).toBeInViewport();
    await expect(admin.locator("[data-admin-ops-status]")).toHaveText("Ops Room state is current.");
    await admin.locator("[data-admin-ops-announcement] textarea").fill(
      "Organizer test announcement.",
    );
    await admin.locator("[data-admin-ops-announcement] input[name=pin]").check();
    admin.once("dialog", (dialog) => dialog.accept());
    await admin.getByRole("button", { name: "Post announcement" }).click();
    await expect(second.locator("[data-ops-pin]")).toContainText(
      "Organizer test announcement.",
    );
    await expect(admin.locator("[data-admin-current-announcement]")).toContainText(
      "Organizer test announcement.",
    );
    admin.once("dialog", (dialog) => dialog.accept());
    await admin.getByRole("button", { name: "Clear pinned announcement" }).click();
    await expect(second.locator("[data-ops-pin]")).toBeHidden();
    await expect(admin.locator("[data-admin-current-announcement]")).toBeHidden();

    // Updates hidden by a filter remain unread, including across a reload.
    await second.locator('input[name="ops-filter"][value="need-backup"]').check();
    for (let index = 1; index <= 12; index += 1) {
      const posted = await request.post(`${server.origin}/api/activate-ri-2026/admin/ops/messages`, {
        headers: { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org", origin: server.origin },
        data: { clientNonce: crypto.randomUUID(), kind: "chat", context: null,
          body: `Field update ${index}: park access is clear and the next station is setting up on 40 meters.` },
      });
      expect(posted.ok()).toBe(true);
    }
    await second.reload();
    await expect(second.getByRole("button", { name: /Jump to unread/ })).toBeVisible();
    await second.getByRole("button", { name: /Jump to unread/ }).click();
    await expect(second.locator("[data-ops-feed] > li").first()).toContainText("Field update 12:");
    await expect(second.locator("[data-ops-feed] > li").first()).toHaveAttribute("data-unread", "false");
    const newestId = await second.locator("[data-ops-feed] > li").first().getAttribute("data-message-id");
    await second.reload();
    await expect(second.locator(`[data-message-id="${newestId}"]`)).toHaveAttribute("data-unread", "false");
    const feed = second.locator("[data-ops-feed]");
    await feed.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const anchor = await feed.locator("li").last().boundingBox();
    const latest = await request.post(`${server.origin}/api/activate-ri-2026/admin/ops/messages`, {
      headers: { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org", origin: server.origin },
      data: { clientNonce: crypto.randomUUID(), kind: "chat", context: null, body: "Fresh update while reading history." },
    });
    expect(latest.ok()).toBe(true);
    await expect(feed.locator("li").first()).toContainText("Fresh update while reading history.");
    expect(Math.abs((await feed.locator("li").last().boundingBox())!.y - anchor!.y)).toBeLessThan(3);
    await second.getByRole("button", { name: "Latest", exact: true }).click();
    await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(0);
    await second.screenshot({ path: test.info().outputPath("ops-mobile.png"), fullPage: true });
    expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await first.screenshot({ path: test.info().outputPath("ops-desktop.png"), fullPage: true });
    await second.setViewportSize({ width: 320, height: 740 });
    await second.screenshot({ path: test.info().outputPath("ops-small-mobile.png"), fullPage: true });
    const smallScreenLayout = await second.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      overflowing: [...document.querySelectorAll("body *")]
        .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
        .map((element) => ({ tag: element.tagName, className: element.className,
          right: element.getBoundingClientRect().right, text: element.textContent?.slice(0, 40) })),
    }));
    expect(smallScreenLayout.width, JSON.stringify(smallScreenLayout)).toBeLessThanOrEqual(320);
    await second.setViewportSize({ width: 390, height: 844 });

    await admin.getByRole("button", { name: /Messages/ }).click();
    const messageCard = admin.locator("[data-admin-ops-messages] .admin-card").filter({
      hasText: "Checking in from Beavertail.",
    });
    admin.once("dialog", (dialog) => dialog.accept("Superseded during E2E."));
    await messageCard.getByRole("button", { name: "Remove" }).click();
    await expect(second.locator("[data-ops-feed]")).toContainText("Message removed.");

    await admin.getByRole("button", { name: /People/ }).click();
    const memberCard = admin.locator("[data-admin-ops-members] .admin-card").filter({
      hasText: callsign,
    });
    admin.once("dialog", (dialog) => dialog.accept("E2E mute check."));
    await memberCard.getByRole("button", { name: "Mute", exact: true }).click();
    await expect(second.locator("[data-ops-send]")).toBeDisabled();

    await first.getByRole("button", { name: "Sign out", exact: true }).click();
    const signoutDialog = first.getByRole("dialog", { name: "Sign out of this browser?" });
    await expect(signoutDialog).toBeVisible();
    await expect(signoutDialog).toContainText("a passkey, an email sign-in link, or your existing private link");
    await signoutDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(signoutDialog).toBeHidden();
    await expect(first).toHaveURL(`${server.origin}/activate-ri-2026/activator/`);

    await first.getByRole("button", { name: "Sign out", exact: true }).click();
    await signoutDialog.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(first).toHaveURL(
      `${server.origin}/account/sign-in/?returnTo=%2Factivate-ri-2026%2Factivator%2F`,
    );
    await expect(first.getByRole("heading", { name: "Sign in" })).toBeVisible();
  } finally {
    await firstContext.close();
    await secondContext.close();
    await adminContext.close();
    await server.stop();
  }
});

function randomCallsign(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return `N0${Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join("")}`;
}
