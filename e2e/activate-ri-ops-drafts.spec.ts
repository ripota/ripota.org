import { expect, test, type Page } from "@playwright/test";
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("room drafts survive navigation and pending sends, and sent messages are revealed", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  let releaseSend: (() => void) | undefined;
  try {
    const roomUrl = await openRoom(page, server);
    const body = page.locator("[data-ops-body]");
    const status = page.locator("[data-ops-send-state]");
    await body.fill("Checking access at Beavertail.");
    await page.locator("[data-ops-options] summary").click();
    await page.locator("[data-ops-kind]").selectOption("access-note");
    await page.locator("[data-ops-context]").selectOption("park:US-2868");
    await expect(status).toHaveText("Draft saved on this device.");

    await page.goto(`${server.origin}/activate-ri-2026/activator/plan/`);
    await page.goto(roomUrl);
    await expect(body).toHaveValue("Checking access at Beavertail.");
    await expect(page.locator("[data-ops-kind]")).toHaveValue("access-note");
    await expect(page.locator("[data-ops-context]")).toHaveValue("park:US-2868");

    await page.locator("[data-ops-kind]").selectOption("chat");
    await page.locator('input[name="ops-filter"][value="need-backup"]').check();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(status).toHaveText("Sent");
    await expect(page.locator('input[name="ops-filter"][value="all"]')).toBeChecked();
    await expect(page.locator("[data-ops-feed]")).toContainText("Checking access at Beavertail.");
    await expect(body).toHaveValue("");
    await page.reload();
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    await expect(body).toHaveValue("");
    await expect(page.locator("[data-ops-unsent]")).toBeHidden();

    const waiting = new Promise<void>((resolve) => { releaseSend = resolve; });
    let sendStarted = false;
    await page.route("**/api/activate-ri-2026/ops/messages", async (route) => {
      sendStarted = true;
      await waiting;
      await route.continue();
    });
    await body.fill("My first update is ready.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => sendStarted).toBe(true);
    await body.fill("My next update is still a draft.");
    releaseSend?.();
    await expect(status).toHaveText("Sent. Your new draft is still here.");
    await expect(body).toHaveValue("My next update is still a draft.");
    await page.reload();
    await expect(body).toHaveValue("My next update is still a draft.");
    await expect(page.locator("[data-ops-feed]")).toContainText("My first update is ready.");
    await expect(page.locator("[data-ops-feed]")).not.toContainText("My next update is still a draft.");

    await page.unroute("**/api/activate-ri-2026/ops/messages");
    const anotherSend = new Promise<void>((resolve) => { releaseSend = resolve; });
    sendStarted = false;
    await page.route("**/api/activate-ri-2026/ops/messages", async (route) => {
      sendStarted = true;
      await anotherSend;
      await route.continue();
    });
    await body.fill("Sending from the first tab.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => sendStarted).toBe(true);
    const otherTab = await page.context().newPage();
    try {
      await otherTab.goto(roomUrl);
      await expect(otherTab.locator("[data-ops-body]")).toHaveValue("Sending from the first tab.");
      await otherTab.locator("[data-ops-body]").fill("A newer draft from the second tab.");
      await expect(otherTab.locator("[data-ops-send-state]")).toHaveText("Draft saved on this device.");
      releaseSend?.();
      await expect(status).toHaveText("Sent");
      await otherTab.reload();
      await expect(otherTab.locator("[data-ops-body]")).toHaveValue("A newer draft from the second tab.");
    } finally {
      await otherTab.close();
    }
  } finally {
    releaseSend?.();
    await server.stop();
  }
});

test("unchanged retries deduplicate while edited drafts get a fresh message nonce", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    await openRoom(page, server);
    const requests: Array<{ clientNonce: string; body: string }> = [];
    let loseResponse = true;
    await page.route("**/api/activate-ri-2026/ops/messages", async (route) => {
      requests.push(route.request().postDataJSON());
      if (loseResponse) {
        loseResponse = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });
    const body = page.locator("[data-ops-body]");
    const send = page.getByRole("button", { name: "Send", exact: true });
    const status = page.locator("[data-ops-send-state]");

    await body.fill("Response lost, message received.");
    await send.click();
    await expect(status).toContainText("Not sent");
    await send.click();
    await expect(status).toHaveText("Sent");
    expect(requests[1].clientNonce).toBe(requests[0].clientNonce);
    await expect(page.locator("[data-ops-feed] > li").filter({ hasText: "Response lost, message received." })).toHaveCount(1);

    loseResponse = true;
    await body.fill("Original access information.");
    await send.click();
    await expect(status).toContainText("Not sent");
    await body.fill("Updated access information.");
    await send.click();
    await expect(status).toHaveText("Sent");
    expect(requests[3].clientNonce).not.toBe(requests[2].clientNonce);
    await expect(page.locator("[data-ops-feed]")).toContainText("Updated access information.");
  } finally {
    await server.stop();
  }
});

test("unresponsive device storage stays bounded and does not block sending or claim a saved draft", async ({ page, context }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { value: { open: () => new EventTarget() } });
    });
    await openRoom(page, server);
    const body = page.locator("[data-ops-body]");
    const status = page.locator("[data-ops-send-state]");
    // Each key produces a save request; a hung database must not add a timeout per key.
    await body.pressSequentially("Sending without device storage.");
    await expect(status).toContainText("Device storage is unavailable");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(status).toHaveText("Sent");
    await expect(page.locator("[data-ops-feed]")).toContainText("Sending without device storage.");

    await context.setOffline(true);
    await body.fill("Keep this draft in the tab.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("[data-ops-unsent]")).toContainText("only in this tab");
    await expect(page.locator("[data-ops-unsent]")).not.toContainText("saved on this device");
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false);
    await server.stop();
  }
});

async function openRoom(page: Page, server: ActivateRiServer): Promise<string> {
  const submit = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
    headers: { origin: server.origin },
    data: {
      submitterCallsign: "N1DRF", submitterName: "Draft Tester", submitterEmail: "drafts@example.com",
      stops: [{ parkReference: "US-2868", plannedDate: "2026-09-11", timeBlock: "09:00-12:00", bands: ["40m"], modes: ["SSB"] }],
    },
  });
  expect(submit.ok()).toBe(true);
  const submitted = await submit.json() as { editUrl: string };
  const adminHeaders = { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org", origin: server.origin };
  const plans = await page.request.get(`${server.origin}/api/activate-ri-2026/admin/plans`, { headers: adminHeaders });
  const planList = await plans.json() as { plans: Array<{ id: string }> };
  const approval = await page.request.post(`${server.origin}/api/activate-ri-2026/admin/plans/${planList.plans[0].id}/approve`, { headers: adminHeaders });
  expect(approval.ok()).toBe(true);
  const mode = await page.request.patch(`${server.origin}/api/activate-ri-2026/admin/ops/settings`, { headers: adminHeaders, data: { roomMode: "full" } });
  expect(mode.ok()).toBe(true);
  await page.goto(submitted.editUrl);
  await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/activator/plan/`);
  const accepted = await page.request.post(`${server.origin}/api/activate-ri-2026/ops/rules/accept`, { headers: { origin: server.origin }, data: {} });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  const roomUrl = `${server.origin}/activate-ri-2026/activator/`;
  await page.goto(roomUrl);
  await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
  return roomUrl;
}
