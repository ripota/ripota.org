import { expect, test, type Page } from "@playwright/test";
import type { OpsMessageDto } from "../src/lib/activate-ri/ops-types";
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

const ownId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const olderId = "33333333-3333-4333-8333-333333333333";
const secondOlderId = "44444444-4444-4444-8444-444444444444";
const removedId = "55555555-5555-4555-8555-555555555555";
const missingId = "66666666-6666-4666-8666-666666666666";

test("any visible message offers a private-data-free permalink and a selectable clipboard fallback", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    const activatorId = await signInActivator(page, server);
    await mockRoom(page, [
      message(ownId, { authorActivatorId: activatorId }),
      message(otherId),
      message(removedId, { removed: true, body: "" }),
    ]);
    await page.goto(`${server.origin}/activate-ri-2026/activator/?campaign=chat&private-note=do-not-share#ops-message-${ownId}`);
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => { document.documentElement.dataset.copiedLink = text; } },
      });
    });

    for (const [id, canEdit] of [[ownId, true], [otherId, false]] as const) {
      const target = page.locator(`[data-message-id="${id}"]`);
      await target.getByLabel("Message actions", { exact: true }).click();
      await expect(target.getByRole("button", { name: "Edit", exact: true })).toHaveCount(canEdit ? 1 : 0);
      await expect(target.getByRole("button", { name: "Remove", exact: true })).toHaveCount(canEdit ? 1 : 0);
      await target.getByRole("button", { name: "Copy link", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-copied-link", permalink(server, id));
    }
    await expect(page.locator(`[data-message-id="${removedId}"]`)).toHaveCount(0);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new Error("Clipboard permission denied"); } },
      });
    });
    const other = page.locator(`[data-message-id="${otherId}"]`);
    await other.getByLabel("Message actions", { exact: true }).click();
    await other.getByRole("button", { name: "Copy link", exact: true }).click();
    const fallback = page.locator("[data-ops-link-dialog]");
    await expect(fallback).toBeVisible();
    const link = fallback.getByLabel("Message link", { exact: true });
    await expect(link).toHaveValue(permalink(server, otherId));
    await expect(link).toHaveAttribute("readonly", "");
    await expect(link).toBeFocused();
    expect(await link.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe(permalink(server, otherId).length);
    await fallback.getByRole("button", { name: "Close", exact: true }).click();
    await expect(fallback).toBeHidden();
    await expect(other.getByLabel("Message actions", { exact: true })).toBeFocused();
    await other.getByLabel("Message actions", { exact: true }).click();
    await other.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(fallback).toBeVisible();
    await link.press("Escape");
    await expect(fallback).toBeHidden();
    await expect(other.getByLabel("Message actions", { exact: true })).toBeFocused();
  } finally {
    await server.stop();
  }
});

test("older permalinks reveal their message on fresh visits, hash changes, and browser history", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signInActivator(page, server);
    const messages = [
      message(otherId, { kind: "announcement", body: `Current organizer announcement. [Older arrival information](#ops-message-${olderId})` }),
      ...Array.from({ length: 18 }, (_, index) => message(`77777777-7777-4777-8777-${String(index).padStart(12, "0")}`, {
        body: `Recent conversation ${index}. We are setting up by the lower parking lot.`,
        createdAt: new Date(Date.parse("2026-09-11T14:00:00Z") - index * 60_000).toISOString(),
      })),
    ];
    await mockRoom(page, messages);
    const lookups: string[] = [];
    for (const [id, body] of [[olderId, "Older arrival information"], [secondOlderId, "Another older conversation"]]) {
      await page.route(`**/api/activate-ri-2026/ops/messages/${id}`, (route) => {
        lookups.push(id);
        return route.fulfill({ json: { ok: true, message: message(id, { body, createdAt: "2026-09-10T12:00:00.000Z" }) } });
      });
    }
    await page.setViewportSize({ width: 390, height: 740 });
    const roomUrl = `${server.origin}/activate-ri-2026/activator/?campaign=chat`;
    const filter = (value: string) => page.locator(`input[name="ops-filter"][value="${value}"]`);
    const target = (id: string) => page.locator(`#ops-message-${id}`);

    // Following a message link within the room fetches a record outside the initial batch.
    await page.goto(`${roomUrl}&ops-filter=announcement`);
    await expect(filter("announcement")).toBeChecked();
    await expect(target(olderId)).toHaveCount(0);
    await page.getByRole("link", { name: "Older arrival information", exact: true }).click();
    await expect(target(olderId)).toBeFocused();
    await expect(target(olderId)).toBeInViewport({ ratio: 1 });
    await expect(filter("all")).toBeChecked();
    await expect(page).toHaveURL(`${roomUrl}#ops-message-${olderId}`);
    expect(lookups).toEqual([olderId]);

    await page.evaluate((id) => { location.hash = `ops-message-${id}`; }, secondOlderId);
    await expect(target(secondOlderId)).toBeFocused();
    await expect(target(secondOlderId)).toBeInViewport({ ratio: 1 });
    expect(lookups).toEqual([olderId, secondOlderId]);
    await page.goBack();
    await expect(target(olderId)).toBeFocused();
    await expect(target(olderId)).toBeInViewport({ ratio: 1 });
    await page.goForward();
    await expect(target(secondOlderId)).toBeFocused();
    await expect(target(secondOlderId)).toBeInViewport({ ratio: 1 });
    expect(lookups).toEqual([olderId, secondOlderId]);

    // Filter history retains the same anchor without repeatedly forcing the room back to All.
    await filter("announcement").check();
    await expect(target(secondOlderId)).toHaveCount(0);
    await filter("need-backup").check();
    await page.goBack();
    await expect(filter("announcement")).toBeChecked();
    await expect(target(otherId)).toBeVisible();
    await expect(page).toHaveURL(`${roomUrl}&ops-filter=announcement#ops-message-${secondOlderId}`);
    await page.goForward();
    await expect(filter("need-backup")).toBeChecked();
    await expect(target(secondOlderId)).toHaveCount(0);

    // Loading or reloading a permalink fetches the older record and clears a filter that hides it.
    await page.goto(`${roomUrl}&ops-filter=announcement#ops-message-${olderId}`);
    await expect(target(olderId)).toBeFocused();
    await expect(target(olderId)).toBeInViewport({ ratio: 1 });
    await expect(filter("all")).toBeChecked();
    await expect(page).toHaveURL(`${roomUrl}#ops-message-${olderId}`);
    await page.reload();
    await expect(target(olderId)).toBeFocused();
    await expect(target(olderId)).toBeInViewport({ ratio: 1 });
    expect(lookups).toEqual([olderId, secondOlderId, olderId, olderId]);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("missing and removed permalinks explain why a message cannot be opened", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    await signInActivator(page, server);
    await mockRoom(page, [message(otherId)]);
    await page.route(`**/api/activate-ri-2026/ops/messages/${missingId}`, (route) => route.fulfill({
      status: 404, json: { ok: false, error: "Message not found." },
    }));
    await page.route(`**/api/activate-ri-2026/ops/messages/${removedId}`, (route) => route.fulfill({
      json: { ok: true, message: message(removedId, { removed: true, body: "" }) },
    }));
    const status = page.locator("[data-ops-link-status]");
    await page.goto(permalink(server, missingId));
    await expect(status).toHaveText("Message is no longer available.");
    await expect(status).toBeVisible();
    await page.evaluate((id) => { location.hash = `ops-message-${id}`; }, otherId);
    await expect(page.locator(`#ops-message-${otherId}`)).toBeFocused();
    await expect(status).toBeHidden();
    await page.evaluate((id) => { location.hash = `ops-message-${id}`; }, removedId);
    await expect(status).toHaveText("Message is no longer available.");
    await expect(page.locator(`[data-message-id="${removedId}"]`)).toHaveCount(0);
    await page.evaluate((id) => { location.hash = `ops-message-${id}`; }, otherId);
    await expect(page.locator(`#ops-message-${otherId}`)).toBeFocused();
    await expect(status).toBeHidden();
  } finally {
    await server.stop();
  }
});

test("live edits and removals win over a pending older-message lookup", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    await signInActivator(page, server);
    let sendEvent: (event: unknown) => void = () => { throw new Error("Socket is not connected"); };
    await mockRoom(page, [message(otherId)], (send) => { sendEvent = send; });
    await page.goto(`${server.origin}/activate-ri-2026/activator/`);
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");

    for (const [index, id] of [olderId, secondOlderId].entries()) {
      let releaseLookup!: () => void;
      const lookupBlocked = new Promise<void>((resolve) => { releaseLookup = resolve; });
      let lookupStarted = false;
      await page.route(`**/api/activate-ri-2026/ops/messages/${id}`, async (route) => {
        lookupStarted = true;
        await lookupBlocked;
        await route.fulfill({ json: { ok: true, message: message(id, { body: "Stale arrival information" }) } });
      });
      await page.evaluate((messageId) => { location.hash = `ops-message-${messageId}`; }, id);
      await expect.poll(() => lookupStarted).toBe(true);
      const sequence = index + 1;
      sendEvent(index === 0
        ? { sequence, type: "message-edited", messageId: id, body: "Corrected arrival information", editedAt: "2026-09-11T14:21:00.000Z" }
        : { sequence, type: "message-removed", messageId: id, removedAt: "2026-09-11T14:21:00.000Z", removedBy: "organizer" });
      await expect.poll(() => page.evaluate(() => localStorage.getItem("activate-ri-ops-cursor"))).toBe(String(sequence));
      releaseLookup();

      if (index === 0) {
        const target = page.locator(`#ops-message-${id}`);
        await expect(target).toBeFocused();
        await expect(target).toContainText("Corrected arrival information");
      } else {
        await expect(page.locator("[data-ops-link-status]")).toHaveText("Message is no longer available.");
        await expect(page.locator(`#ops-message-${id}`)).toHaveCount(0);
      }
      await expect(page.locator("[data-ops-feed]")).not.toContainText("Stale arrival information");
    }
  } finally {
    await server.stop();
  }
});

test("changing the filter cancels an older-message reveal that is still loading", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    await signInActivator(page, server);
    await mockRoom(page, [message(otherId, { kind: "announcement" })]);
    let releaseLookup!: () => void;
    const lookupBlocked = new Promise<void>((resolve) => { releaseLookup = resolve; });
    let lookupStarted = false;
    await page.route(`**/api/activate-ri-2026/ops/messages/${olderId}`, async (route) => {
      lookupStarted = true;
      await lookupBlocked;
      await route.fulfill({ json: { ok: true, message: message(olderId) } });
    });
    await page.goto(`${server.origin}/activate-ri-2026/activator/`);
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
    await page.evaluate((id) => { location.hash = `ops-message-${id}`; }, olderId);
    await expect.poll(() => lookupStarted).toBe(true);
    const filter = page.locator('input[name="ops-filter"][value="announcement"]');
    await filter.check();
    const responseFinished = page.waitForResponse(`**/api/activate-ri-2026/ops/messages/${olderId}`);
    releaseLookup();
    await (await responseFinished).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(filter).toBeChecked();
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/activator/?ops-filter=announcement#ops-message-${olderId}`);
    await expect(page.locator(`#ops-message-${olderId}`)).toHaveCount(0);
    await expect(page.locator(`#ops-message-${otherId}`)).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("permalinks survive sign-in redirects when a room session expires or is missing", async ({ page, browser }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const signedOutContext = await browser.newContext();
  try {
    await signInActivator(page, server);
    await page.route("**/api/activate-ri-2026/activator/session", (route) => route.fulfill({
      status: 401, json: { ok: false, error: "Session expired." },
    }));
    await page.route("**/api/auth/session", (route) => route.fulfill({
      json: { signedIn: false },
    }));
    const path = "/activate-ri-2026/activator/?campaign=chat";
    const hash = `#ops-message-${olderId}`;
    const destination = `${path}${hash}`;
    await page.goto(`${server.origin}${destination}`);
    const expiredSignIn = `${server.origin}/account/sign-in/?${new URLSearchParams({ returnTo: destination })}`;
    await expect(page).toHaveURL(expiredSignIn);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(destination);
    await expectUsableSignIn(page);

    // The Worker never receives the fragment; the browser inherits it across its redirect.
    const signedOut = await signedOutContext.newPage();
    await signedOut.goto(`${server.origin}${destination}`);
    const missingSignIn = `${server.origin}/account/sign-in/?${new URLSearchParams({ returnTo: path })}${hash}`;
    await expect(signedOut).toHaveURL(missingSignIn);
    const redirected = new URL(signedOut.url());
    expect(`${redirected.searchParams.get("returnTo")}${redirected.hash}`).toBe(destination);
    await expectUsableSignIn(signedOut);
  } finally {
    await signedOutContext.close();
    await server.stop();
  }
});

async function expectUsableSignIn(page: Page): Promise<void> {
  await expect(page.locator("[data-sign-in-controls]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with a passkey", exact: true })).toBeEnabled();
  await page.getByText("Email me a sign-in link", { exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send sign-in link", exact: true })).toBeEnabled();
}

function permalink(server: ActivateRiServer, id: string): string {
  return `${server.origin}/activate-ri-2026/activator/#ops-message-${id}`;
}

function message(id: string, overrides: Partial<OpsMessageDto> = {}): OpsMessageDto {
  return {
    id, body: "The station is ready.", kind: "chat", createdAt: "2026-09-11T14:20:00.000Z",
    authorType: "activator", authorActivatorId: "another-activator", authorLabel: "K1ANN - Ann",
    resolved: false, removed: false, ...overrides,
  };
}

async function mockRoom(page: Page, messages: OpsMessageDto[], onSocket?: (send: (event: unknown) => void) => void): Promise<void> {
  await page.clock.setFixedTime("2026-09-11T14:21:00Z");
  await page.route("**/api/activate-ri-2026/ops/bootstrap", (route) => route.fulfill({ json: {
    ok: true, membership: { status: "active", acceptedRulesVersion: "permalink-test" },
    rulesVersion: "permalink-test", roomMode: "full", pinnedMessage: null,
    messages, upcomingStops: [], cursor: 0,
  } }));
  await page.routeWebSocket("**/api/activate-ri-2026/ops/socket", (socket) => {
    onSocket?.((event) => socket.send(JSON.stringify(event)));
    socket.send(JSON.stringify({ type: "hello", highWatermark: 0, roomMode: "full" }));
  });
}

async function signInActivator(page: Page, server: ActivateRiServer): Promise<string> {
  const response = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
    headers: { origin: server.origin },
    data: {
      submitterCallsign: "N1LNK", submitterName: "Link Tester", submitterEmail: "permalinks@example.com",
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
