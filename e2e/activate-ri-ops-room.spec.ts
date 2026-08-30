import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("approved activators acknowledge rules and exchange a live room message", async ({
  browser,
  request,
}) => {
  const server = await startActivateRiServer();
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
    await expect(first).toHaveURL(`${server.origin}/activate-ri-2026/activators/plan/`);
    await first.goto(`${server.origin}/activate-ri-2026/activators/`);
    await expect(first.getByRole("dialog", { name: "Activator Ops Room rules" })).toBeVisible();
    await first.getByRole("button", { name: "I understand and agree" }).click();
    await expect(first.getByRole("dialog", { name: "Activator Ops Room rules" })).toBeHidden();
    await expect(first.locator("[data-ops-connection-label]")).toHaveText("Live");

    await second.goto(submitBody.editUrl);
    await second.goto(`${server.origin}/activate-ri-2026/activators/`);
    await expect(second.locator("[data-ops-connection-label]")).toHaveText("Live");

    await first.locator("[data-ops-body]").fill("Checking in from Beavertail.");
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
    await admin.locator("[data-admin-ops-announcement] textarea").fill(
      "Organizer test announcement.",
    );
    await admin.locator("[data-admin-ops-announcement] input[name=pin]").check();
    admin.once("dialog", (dialog) => dialog.accept());
    await admin.getByRole("button", { name: "Post announcement" }).click();
    await expect(second.locator("[data-ops-pin]")).toContainText(
      "Organizer test announcement.",
    );

    const messageCard = admin.locator("[data-admin-ops-messages] .admin-card").filter({
      hasText: "Checking in from Beavertail.",
    });
    admin.once("dialog", (dialog) => dialog.accept("Superseded during E2E."));
    await messageCard.getByRole("button", { name: "Remove" }).click();
    await expect(second.locator("[data-ops-feed]")).toContainText("Message removed.");

    const memberCard = admin.locator("[data-admin-ops-members] .admin-card").filter({
      hasText: callsign,
    });
    admin.once("dialog", (dialog) => dialog.accept("E2E mute check."));
    await memberCard.getByRole("button", { name: "Mute", exact: true }).click();
    await expect(second.locator("[data-ops-send]")).toBeDisabled();
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
