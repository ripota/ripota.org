import { expect, test, type Locator, type Page } from "@playwright/test";
import type { OpsMessageDto } from "../src/lib/activate-ri/ops-types";
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("corrections update the same message live and persist without changing the composer draft", async ({ page, context }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const otherTab = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  otherTab.on("pageerror", (error) => errors.push(error.message));
  try {
    const roomUrl = await openRoom(page, server);
    const posted = await postMessage(page, server, "The park entrnace is open.");
    const message = page.locator(`[data-message-id="${posted.id}"]`);
    const otherMessage = otherTab.locator(`[data-message-id="${posted.id}"]`);
    await otherTab.goto(roomUrl);
    await expect(otherTab.locator("[data-ops-connection-label]")).toHaveText("Live");
    await expect(otherMessage).toContainText(posted.body);

    const composer = page.locator("[data-ops-body]");
    await composer.fill("An unfinished update for later.");
    await expect(page.locator("[data-ops-send-state]")).toHaveText("Draft saved on this device.");

    let editor = await editMessage(page, message);
    await expect(editor.getByLabel("Message", { exact: true })).toHaveValue(posted.body);
    await expect(editor).toContainText("You can edit this message for 20 minutes after posting.");
    await editor.getByLabel("Message", { exact: true }).fill("A correction I will discard.");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(message).toContainText(posted.body);
    await expect(composer).toHaveValue("An unfinished update for later.");

    editor = await editMessage(page, message);
    const correction = editor.getByLabel("Message", { exact: true });
    await expect(correction).toHaveValue(posted.body);
    await correction.fill("The park entrance is open.");
    await postMessage(page, server, "Another operator is setting up.", true);
    await expect(page.locator("[data-ops-feed]")).toContainText("Another operator is setting up.");
    await expect(correction).toHaveValue("The park entrance is open.");
    await expect(correction).toBeFocused();
    for (const viewport of [{ width: 320, height: 740 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expect(correction).toBeInViewport({ ratio: 1 });
      await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeInViewport({ ratio: 1 });
      await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`ops-edit-${viewport.width}.png`) });
    }

    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toBeHidden();
    for (const updated of [message, otherMessage]) {
      await expect(updated).toHaveCount(1);
      await expect(updated).toContainText("The park entrance is open.");
      await expect(updated).not.toContainText(posted.body);
      await expect(updated.getByText("edited", { exact: true })).toBeVisible();
    }
    await expect(composer).toHaveValue("An unfinished update for later.");
    await page.reload();
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    await expect(message).toContainText("The park entrance is open.");
    await expect(message.getByText("edited", { exact: true })).toBeVisible();
    await expect(composer).toHaveValue("An unfinished update for later.");
    expect(errors).toEqual([]);
  } finally {
    await otherTab.close();
    await server.stop();
  }
});

test("a failed correction keeps the text available for retry", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    await openRoom(page, server);
    const posted = await postMessage(page, server, "We are on 40 metrs.");
    const message = page.locator(`[data-message-id="${posted.id}"]`);
    const editor = await editMessage(page, message);
    const correction = editor.getByLabel("Message", { exact: true });
    const save = editor.getByRole("button", { name: "Save changes", exact: true });
    await correction.fill("We are on 40 meters.");
    await page.route(`**/api/activate-ri-2026/ops/messages/${posted.id}/edit`, (route) => route.fulfill({
      status: 503,
      json: { ok: false, error: "Temporary editing failure. Try again." },
    }), { times: 1 });
    await save.click();
    await expect(editor).toContainText("Temporary editing failure. Try again.");
    await expect(correction).toHaveValue("We are on 40 meters.");
    await expect(message).toContainText(posted.body);
    await expect(save).toBeEnabled();

    await save.click();
    await expect(editor).toBeHidden();
    await expect(message).toContainText("We are on 40 meters.");
    await expect(message.getByText("edited", { exact: true })).toBeVisible();
  } finally {
    await server.stop();
  }
});

for (const failCatchUp of [false, true]) {
  test(`saving a correction recovers missed messages ${failCatchUp ? "by reloading when catch-up fails" : "before advancing the event cursor"}`, async ({ page }) => {
    const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
    let watermark = 0;
    let bootstrapLoads = 0;
    try {
      await page.route("**/api/activate-ri-2026/ops/bootstrap", async (route) => {
        const response = await route.fetch();
        watermark = (await response.json() as { cursor: number }).cursor;
        bootstrapLoads += 1;
        await route.fulfill({ response });
      });
      // Complete the handshake but withhold live events so saving must fill the gap.
      await page.routeWebSocket("**/api/activate-ri-2026/ops/socket", (socket) => {
        socket.send(JSON.stringify({ type: "hello", highWatermark: watermark, roomMode: "full" }));
      });
      await openRoom(page, server);
      const posted = await postMessage(page, server, "Meet at the south entrnace.");
      await page.reload();
      await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
      const message = page.locator(`[data-message-id="${posted.id}"]`);
      const editor = await editMessage(page, message);
      await editor.getByLabel("Message", { exact: true }).fill("Meet at the south entrance.");
      const missed = await postMessage(page, server, "The north entrance is closed.", true);
      const missedMessage = page.locator(`[data-message-id="${missed.id}"]`);
      await expect(missedMessage).toHaveCount(0);

      let eventReads = 0;
      await page.route("**/api/activate-ri-2026/ops/events?**", (route) => {
        eventReads += 1;
        return failCatchUp
          ? route.fulfill({ status: 503, json: { ok: false, error: "Catch-up unavailable." } })
          : route.continue();
      });
      const bootstrapLoadsBeforeSave = bootstrapLoads;
      await editor.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(editor).toBeHidden();
      await expect(message).toContainText("Meet at the south entrance.");
      await expect(message.getByText("edited", { exact: true })).toBeVisible();
      await expect(missedMessage).toContainText(missed.body);
      expect(eventReads).toBe(1);
      expect(bootstrapLoads).toBe(bootstrapLoadsBeforeSave + (failCatchUp ? 1 : 0));
    } finally {
      await server.stop();
    }
  });
}

test("only the author can edit and the open editor expires after 20 minutes", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    await openRoom(page, server);
    const posted = await postMessage(page, server, "The gate is opne.");
    const announcement = await postMessage(page, server, "Keep the entrance clear.", true);
    // Advance only the browser clock; the server deadline is covered by acceptance tests.
    await page.clock.install({ time: new Date(Date.parse(posted.createdAt) + 19 * 60_000) });
    await page.reload();
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    const otherMessage = page.locator(`[data-message-id="${announcement.id}"]`);
    await expect(otherMessage).toBeVisible();
    await expect(otherMessage.getByRole("button", { name: "Edit", exact: true, includeHidden: true })).toHaveCount(0);

    const message = page.locator(`[data-message-id="${posted.id}"]`);
    const editor = await editMessage(page, message);
    const correction = editor.getByLabel("Message", { exact: true });
    const save = editor.getByRole("button", { name: "Save changes", exact: true });
    await correction.fill("The gate is open.");
    await expect(save).toBeEnabled();
    await page.clock.fastForward(60_001);
    await expect(save).toBeDisabled();
    await expect(editor).toContainText("The 20-minute editing window has ended. You can copy your changes before closing.");
    await expect(correction).toHaveValue("The gate is open.");
    await expect(message).toContainText(posted.body);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await message.getByLabel("Message actions", { exact: true }).click();
    await expect(message.getByRole("button", { name: "Edit", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(message.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  } finally {
    await server.stop();
  }
});

async function editMessage(page: Page, message: Locator): Promise<Locator> {
  await message.getByLabel("Message actions", { exact: true }).click();
  await message.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit message", exact: true });
  await expect(editor).toBeVisible();
  return editor;
}

async function postMessage(page: Page, server: ActivateRiServer, body: string, admin = false): Promise<OpsMessageDto> {
  const response = await page.request.post(`${server.origin}/api/activate-ri-2026/${admin ? "admin/" : ""}ops/messages`, {
    headers: {
      origin: server.origin,
      ...(admin ? { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org" } : {}),
    },
    data: { clientNonce: crypto.randomUUID(), kind: "chat", context: null, body },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const result = await response.json() as { event: { message: OpsMessageDto } };
  return result.event.message;
}

async function openRoom(page: Page, server: ActivateRiServer): Promise<string> {
  const submit = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
    headers: { origin: server.origin },
    data: {
      submitterCallsign: "N1EDT", submitterName: "Edit Tester", submitterEmail: "editing@example.com",
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
