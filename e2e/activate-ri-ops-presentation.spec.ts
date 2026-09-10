import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { OpsMessageDto } from "../src/lib/activate-ri/ops-types";
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("room conversations stay compact, readable, and recognizable across screen sizes", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const activatorId = await signInActivator(page, server);
    const messages = conversation(activatorId);
    const initialVisibleCount = messages.filter((message) => !message.removed).length;
    let cursor = 0;
    let pinnedMessage: OpsMessageDto | null = null;
    await page.clock.setFixedTime("2026-09-11T14:21:00Z");
    await page.route("**/api/activate-ri-2026/ops/bootstrap", (route) => route.fulfill({
      json: {
        ok: true, membership: { status: "active", acceptedRulesVersion: "presentation-test" },
        rulesVersion: "presentation-test", roomMode: "full", pinnedMessage,
        messages, upcomingStops: [], cursor,
      },
    }));
    let liveSocket: WebSocketRoute | undefined;
    await page.routeWebSocket("**/api/activate-ri-2026/ops/socket", (socket) => {
      liveSocket = socket;
      socket.send(JSON.stringify({ type: "hello", highWatermark: cursor, roomMode: "full" }));
    });

    const roomUrl = `${server.origin}/activate-ri-2026/activator/`;
    const feed = page.locator("[data-ops-feed]");
    const own = page.locator('[data-message-id="own-start"]');
    const continuation = page.locator('[data-message-id="own-continuation"]');
    const other = page.locator('[data-message-id="other-start"]');
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto(roomUrl);
      await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
      await expect(feed.locator(":scope > li")).toHaveCount(initialVisibleCount);
      await expect(page.locator("[data-ops-body]")).toBeInViewport({ ratio: 1 });
      await expect(page.locator("[data-ops-send]")).toBeInViewport({ ratio: 1 });
      await expect(own).toHaveAttribute("data-own", "true");
      await expect(own.locator(".ops-message__you")).toHaveText("You");
      await expect(own.locator(".ops-message__you")).toBeVisible();
      await expect(own).toHaveAttribute("data-unread", "false");
      await expect(continuation).toHaveAttribute("data-continuation", "true");
      await expect(other).not.toHaveAttribute("data-own", "true");
      await expect(other.locator(".ops-message__header")).toContainText("K1ANN");
      await expect(other).not.toHaveAttribute("data-continuation", "true");
      await expect(own.locator(".ops-message__header")).not.toContainText("Coordination");
      await expect(other.locator(".ops-message__header")).not.toContainText("Coordination");
      await expect(own.locator(".ops-message__header time")).toHaveAttribute("datetime", "2026-09-11T14:20:00.000Z");
      expect((await own.locator(".ops-message__header time").innerText()).trim()).toMatch(/^\d{1,2}:\d{2}\s*[ap](?:m)?$/i);
      await expect(page.locator('[data-message-id="access"]')).toContainText("Access note");
      await expect(page.locator('[data-message-id="backup"]')).toContainText("Resolved");
      await expect(page.locator('[data-message-id="removed"]')).toHaveCount(0);
      await expect(feed).not.toContainText("Message removed.");
      await expect(page.locator('[data-message-id="older-day"]')).not.toHaveAttribute("data-continuation", "true");

      const layout = await page.evaluate(() => {
        const measure = (id: string) => {
          const element = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
          const style = getComputedStyle(element);
          return {
            height: element.getBoundingClientRect().height,
            borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
            corners: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius],
          };
        };
        return {
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
          standalone: measure("other-start"),
          groupStart: measure("own-start"),
          continuation: measure("own-continuation"),
        };
      });
      expect(layout.width).toBeLessThanOrEqual(layout.viewport);
      expect(layout.standalone.borders).toEqual(["0px", "0px", "0px", "0px"]);
      expect(layout.standalone.corners).toEqual(["0px", "0px", "0px", "0px"]);
      if (viewport.width < 500) {
        expect(layout.standalone.height).toBeLessThanOrEqual(70);
        expect(layout.continuation.height).toBeLessThan(layout.groupStart.height);
      }
      await page.screenshot({ path: test.info().outputPath(`ops-chat-${viewport.width}.png`) });
      await feed.screenshot({ path: test.info().outputPath(`ops-chat-feed-${viewport.width}.png`) });
    }

    const actions = own.locator("details.ops-message__actions");
    const menu = actions.locator("summary");
    await expect(menu).toHaveAccessibleName("Message actions");
    await expect(actions).not.toHaveAttribute("open", "");
    await menu.click();
    await menu.focus();
    await expect(actions.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
    expect(liveSocket).toBeDefined();
    const arrival = message("live-arrival", "I can hear both of you on 40 meters.", "2026-09-11T14:21:00Z", { authorActivatorId: "activator-ben", authorLabel: "N1BEN - Ben" });
    messages.unshift(arrival);
    liveSocket!.send(JSON.stringify({
      type: "message-created", sequence: ++cursor, message: arrival,
    }));
    await expect(feed.locator(":scope > li")).toHaveCount(initialVisibleCount + 1);
    await expect(actions).toHaveAttribute("open", "");
    await expect(menu).toBeFocused();
    await expect(actions.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
    await menu.press("Escape");
    await expect(actions).not.toHaveAttribute("open", "");
    await expect(menu).toBeFocused();
    await menu.click();
    await page.locator("[data-ops-body]").click();
    await expect(actions).not.toHaveAttribute("open", "");

    await menu.click();
    await menu.focus();
    removeMessage("own-start");
    await expect(own).toHaveCount(0);
    await expect(feed).toBeFocused();

    pinnedMessage = message("removed-pin", "The north entrance is temporarily closed.", "2026-09-11T14:21:30Z", {
      kind: "announcement", authorType: "admin", authorActivatorId: undefined, authorLabel: "Organizer",
    });
    messages.unshift(pinnedMessage);
    await page.reload();
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    await expect(page.locator("[data-ops-pin]")).toContainText("The north entrance is temporarily closed.");
    removeMessage("removed-pin");
    await expect(page.locator("[data-ops-pin]")).toBeHidden();
    await expect(page.locator('[data-message-id="removed-pin"]')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 700 });
    await page.reload();
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    await expect(own).toHaveCount(0);
    await expect(page.locator("[data-ops-pin]")).toBeHidden();
    const anchor = await feed.evaluate((element) => {
      const target = element.querySelector<HTMLElement>('[data-message-id="access"]')!;
      element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top + 8;
      const top = element.getBoundingClientRect().top;
      const visible = [...element.querySelectorAll<HTMLElement>("[data-message-id]")]
        .filter((message) => message.getBoundingClientRect().bottom > top);
      return {
        removedId: visible[0].dataset.messageId!,
        survivorId: visible[1].dataset.messageId!,
        survivorTop: visible[1].getBoundingClientRect().top,
        scrollTop: element.scrollTop,
      };
    });
    expect(anchor.removedId).toBe("access");
    expect(anchor.scrollTop).toBeGreaterThan(40);
    await page.locator(`[data-message-id="${anchor.removedId}"]`).evaluate((element) => {
      (element as HTMLElement).focus({ preventScroll: true });
    });
    removeMessage(anchor.removedId);
    await expect(page.locator(`[data-message-id="${anchor.removedId}"]`)).toHaveCount(0);
    await expect(feed).toBeFocused();
    const survivor = page.locator(`[data-message-id="${anchor.survivorId}"]`);
    await expect(survivor).toBeInViewport();
    expect(Math.abs((await survivor.boundingBox())!.y - anchor.survivorTop)).toBeLessThan(3);

    // Even an active category filter should show the empty-room state when only removed records remain.
    await page.locator('input[name="ops-filter"][value="need-backup"]').check();
    messages.forEach((message) => { message.removed = true; message.body = ""; });
    await page.reload();
    await expect(feed.locator("[data-message-id]")).toHaveCount(0);
    await expect(feed).toContainText("You're all caught up.");
    await expect(feed).not.toContainText("Choose another filter");
    await expect(page.locator("[data-ops-unread]")).toBeHidden();
    expect(errors).toEqual([]);

    function removeMessage(id: string): void {
      const removed = messages.find((message) => message.id === id)!;
      removed.removed = true;
      removed.body = "";
      liveSocket!.send(JSON.stringify({
        type: "message-removed", sequence: ++cursor, messageId: id,
        removedAt: "2026-09-11T14:22:00.000Z", removedBy: "organizer",
      }));
    }
  } finally {
    await server.stop();
  }
});

test("room filters deep link, restore browser history, and follow internal view changes", async ({ page, browser }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    const activatorId = await signInActivator(page, server);
    const messages = conversation(activatorId);
    messages.push(message("announcement", "Check in here for event updates.", "2026-09-11T14:21:00Z", {
      kind: "announcement", authorType: "admin", authorActivatorId: undefined,
    }));
    let cursor = 0;
    async function mockRoom(target: Page): Promise<void> {
      await target.route("**/api/activate-ri-2026/ops/bootstrap", (route) => route.fulfill({
        json: {
          ok: true, membership: { status: "active", acceptedRulesVersion: "filter-test" },
          rulesVersion: "filter-test", roomMode: "full", pinnedMessage: null,
          messages, upcomingStops: [{ id: "my-stop", parkReference: "US-2868", startAt: "2026-09-11T13:00:00Z", endAt: "2026-09-11T16:00:00Z" }], cursor,
        },
      }));
      await target.routeWebSocket("**/api/activate-ri-2026/ops/socket", (socket) => {
        socket.send(JSON.stringify({ type: "hello", highWatermark: cursor, roomMode: "full" }));
      });
    }
    await mockRoom(page);
    await page.evaluate(() => localStorage.setItem("activate-ri-ops-filter", "need-backup"));
    const roomUrl = `${server.origin}/activate-ri-2026/activator/?campaign=share`;
    const filter = (value: string) => page.locator(`input[name="ops-filter"][value="${value}"]`);
    const feed = page.locator("[data-ops-feed]");
    await page.goto(`${roomUrl}&ops-filter=access-note#ops-message-access`);
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    await expect(filter("access-note")).toBeChecked();
    await expect(feed.locator("[data-message-id]")).toHaveCount(1);
    await expect(feed).toContainText("The upper parking lot is closed.");
    await page.reload();
    await expect(filter("access-note")).toBeChecked();
    await expect(feed.locator('[data-message-id="access"]')).toBeVisible();

    for (const [value, messageId] of [["announcement", "announcement"], ["need-backup", "backup"], ["my-parks", "access"]]) {
      await filter(value).check();
      await expect(page).toHaveURL(`${roomUrl}&ops-filter=${value}#ops-message-access`);
      await expect(feed.locator("[data-message-id]")).toHaveCount(1);
      await expect(feed.locator(`[data-message-id="${messageId}"]`)).toBeVisible();
    }
    await page.goBack();
    await expect(filter("need-backup")).toBeChecked();
    await expect(feed.locator('[data-message-id="backup"]')).toBeVisible();
    await page.goForward();
    await expect(filter("my-parks")).toBeChecked();
    await expect(feed.locator('[data-message-id="access"]')).toBeVisible();

    // Opening the copied URL in a new authenticated browser restores its filter without device preferences.
    const sharedContext = await browser.newContext({
      storageState: { cookies: (await page.context().storageState()).cookies, origins: [] },
    });
    try {
      const shared = await sharedContext.newPage();
      await mockRoom(shared);
      await shared.goto(page.url());
      await expect(shared.locator('input[name="ops-filter"][value="my-parks"]')).toBeChecked();
      await expect(shared.locator('[data-ops-feed] [data-message-id]')).toHaveCount(1);
      await expect(shared.locator('[data-message-id="access"]')).toBeVisible();
    } finally {
      await sharedContext.close();
    }

    await page.locator("[data-ops-unread]").click();
    await expect(filter("all")).toBeChecked();
    await expect(page).toHaveURL(`${roomUrl}#ops-message-access`);
    await expect(feed.locator("[data-message-id]")).toHaveCount(messages.length - 1);
    await page.reload();
    await expect(filter("all")).toBeChecked();
    await expect(feed.locator("[data-message-id]")).toHaveCount(messages.length - 1);

    // Posting a message hidden by the active filter switches to All and updates the shareable URL.
    await filter("need-backup").check();
    await page.route("**/api/activate-ri-2026/ops/messages", async (route) => {
      const posted = message("posted", "I am ready at the park.", new Date().toISOString(), { authorActivatorId: activatorId });
      messages.unshift(posted);
      await route.fulfill({ json: { ok: true, event: { type: "message-created", sequence: ++cursor, message: posted } } });
    });
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    await page.locator("[data-ops-body]").fill("I am ready at the park.");
    await page.locator("[data-ops-send]").click();
    await expect(feed.locator('[data-message-id="posted"]')).toBeVisible();
    await expect(filter("all")).toBeChecked();
    await expect(page).toHaveURL(`${roomUrl}#ops-message-access`);

    await filter("announcement").check();
    await filter("all").check();
    await expect(page).toHaveURL(`${roomUrl}#ops-message-access`);
    await page.goto(`${roomUrl}&ops-filter=not-a-filter#ops-message-access`);
    await expect(filter("all")).toBeChecked();
    await expect(page).toHaveURL(`${roomUrl}#ops-message-access`);
    await expect(feed.locator("[data-message-id]")).toHaveCount(messages.length - 1);
  } finally {
    await server.stop();
  }
});

function conversation(activatorId: string): OpsMessageDto[] {
  const own = { authorActivatorId: activatorId, authorLabel: "N1ME - Morgan" };
  return [
    message("own-start", "Good copy, thanks.", "2026-09-11T14:20:00Z", own),
    message("own-continuation", "I’m ready on 40m.", "2026-09-11T14:19:30Z", own),
    message("other-start", "I’ll bring spare coax.", "2026-09-11T14:18:00Z"),
    message("other-continuation", "See you at the park.", "2026-09-11T14:17:30Z"),
    message("ben-chat", "Great morning for radio!", "2026-09-11T14:17:00Z", { authorActivatorId: "activator-ben", authorLabel: "N1BEN - Ben" }),
    message("access", "The upper parking lot is closed. Use the south entrance.", "2026-09-11T14:16:00Z", { kind: "access-note", parkReference: "US-2868" }),
    message("backup", "Spare battery found — thanks for the help.", "2026-09-11T14:15:00Z", { ...own, kind: "need-backup", resolved: true, parkReference: "US-0513" }),
    message("long-message", "I’m set up near the lower parking area with a clear view toward the water. There is plenty of room for another station, and the picnic tables are dry.\n\nThe path down from the main entrance is a little muddy, so bring something to keep your equipment off the ground. I’ll stay on 40 meters until the next operator arrives, then move to 20 meters to give everyone some space.", "2026-09-11T14:14:00Z", { authorActivatorId: "activator-ben", authorLabel: "N1BEN - Ben" }),
    message("removed", "", "2026-09-11T14:13:00Z", { ...own, removed: true }),
    message("early-today", "First station checked in for the day.", "2026-09-11T04:01:00Z"),
    message("older-day", "All packed for tomorrow.", "2026-09-11T03:59:00Z"),
  ];
}

function message(id: string, body: string, createdAt: string, overrides: Partial<OpsMessageDto> = {}): OpsMessageDto {
  return {
    id, body, createdAt: new Date(createdAt).toISOString(), kind: "chat", authorType: "activator",
    authorActivatorId: "activator-ann", authorLabel: "K1ANN - Ann", resolved: false, removed: false,
    ...overrides,
  };
}

async function signInActivator(page: Page, server: ActivateRiServer): Promise<string> {
  const response = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
    headers: { origin: server.origin },
    data: {
      submitterCallsign: "N1ME", submitterName: "Morgan", submitterEmail: "presentation@example.com",
      stops: [{ parkReference: "US-2868", plannedDate: "2026-09-11", timeBlock: "09:00-12:00", bands: ["40m"], modes: ["SSB"] }],
    },
  });
  expect(response.ok()).toBe(true);
  const submitted = await response.json() as { editUrl: string };
  const adminHeaders = { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org", origin: server.origin };
  const plans = await page.request.get(`${server.origin}/api/activate-ri-2026/admin/plans`, { headers: adminHeaders });
  const planList = await plans.json() as { plans: Array<{ id: string }> };
  const approval = await page.request.post(`${server.origin}/api/activate-ri-2026/admin/plans/${planList.plans[0].id}/approve`, { headers: adminHeaders });
  expect(approval.ok()).toBe(true);
  await page.goto(submitted.editUrl);
  await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/activator/plan/`);
  const session = await page.request.get(`${server.origin}/api/activate-ri-2026/activator/session`);
  expect(session.ok()).toBe(true);
  const identity = await session.json() as { activator: { id: string } };
  return identity.activator.id;
}
