import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";
import type { OpsMessageDto } from "../src/lib/activate-ri/ops-types";

test.setTimeout(90_000);

test("records foreground exposure, retries failures, and opens an older linked message", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const submit = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
      headers: { origin: server.origin },
      data: { submitterCallsign: "N1EXP", submitterName: "Exposure", submitterEmail: "exposure@example.com",
        stops: [{ parkReference: "US-2868", plannedDate: "2026-09-11", timeBlock: "09:00-12:00", bands: ["40m"], modes: ["SSB"] }] },
    });
    expect(submit.ok()).toBe(true);
    const { editUrl } = await submit.json() as { editUrl: string };
    await page.goto(editUrl);
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/activator/plan/`);
    const linked: OpsMessageDto = { id: "11111111-1111-4111-8111-111111111111", kind: "chat", body: "Older linked message",
      authorType: "admin", authorLabel: "Organizer", createdAt: "2026-09-10T12:00:00.000Z", resolved: false, removed: false };
    const pinned: OpsMessageDto = { ...linked, id: "22222222-2222-4222-8222-222222222222", kind: "announcement", body: "Pinned instructions" };
    const posts: Array<{ messageIds: string[]; entrySource: string }> = [];
    let failFirst = true;
    await page.route("**/api/activate-ri-2026/ops/engagement", (route) => {
      posts.push(route.request().postDataJSON() as typeof posts[number]);
      const status = failFirst ? 503 : 200;
      failFirst = false;
      return route.fulfill({ status, json: { ok: status === 200 } });
    });
    await page.route("**/api/activate-ri-2026/ops/bootstrap", (route) => route.fulfill({ json: {
      ok: true, membership: { status: "active", acceptedRulesVersion: "test" }, rulesVersion: "test",
      roomMode: "full", pinnedMessage: pinned, messages: [], upcomingStops: [], cursor: 0,
    } }));
    let lookups = 0;
    await page.route(`**/api/activate-ri-2026/ops/messages/${linked.id}`, (route) => {
      lookups += 1;
      return route.fulfill({ json: { ok: true, message: linked } });
    });
    await page.routeWebSocket("**/api/activate-ri-2026/ops/socket", (socket) => {
      socket.send(JSON.stringify({ type: "hello", highWatermark: 0, roomMode: "full" }));
    });
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.clock.install({ time: new Date("2026-09-11T12:00:00Z") });
    await page.goto(`${server.origin}/activate-ri-2026/activator/#ops-message-${linked.id}`);
    await expect(page.locator(`#ops-message-${linked.id}`)).toBeFocused();
    expect(lookups).toBe(1);
    await page.clock.runFor(600);
    expect(posts).toHaveLength(0);
    await page.clock.runFor(2400);
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ messageIds: expect.arrayContaining([linked.id, pinned.id]), entrySource: "message_link" });
    expect(JSON.stringify(posts)).not.toContain(linked.body);
    await page.clock.runFor(31_000);
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1].messageIds).toEqual(posts[0].messageIds);

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(61_000);
    expect(posts).toHaveLength(2);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
      document.querySelector<HTMLDialogElement>("[data-ops-edit-dialog]")!.showModal();
    });
    await page.clock.runFor(31_000);
    expect(posts).toHaveLength(2);
    await page.evaluate(() => document.querySelector<HTMLDialogElement>("[data-ops-edit-dialog]")!.close());
    await page.clock.runFor(2400);
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2].messageIds).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await server.stop(); }
});
