import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("organizer tabs work by keyboard and failed actions remain recoverable", async ({ page }) => {
  const server = await startActivateRiServer();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let accountsAvailable = false;
  const plans = ["N1AAA", "N1BBB"].map((callsign, index) => ({
    id: `review-${index}`, submitter_callsign: callsign, submitter_name: "Test activator",
    submitter_email: "test@example.invalid", stops: [],
  }));
  try {
    await page.route("**/api/activate-ri-2026/admin/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/ops/settings")) {
        await route.fulfill({ status: 503, json: { error: "Room settings could not be saved." } });
      } else if (path.endsWith("/ops")) {
        await route.fulfill({ json: {
          ok: true, settings: { room_mode: "full", rules_version: "v1", updated_at: "2026-09-10T12:00:00Z", updated_by: "organizer" },
          hardDisabled: false, connectedClients: 0, pinnedMessage: null, members: [], messages: [], broadcasts: [],
          notifications: { pending: 0, failed: 0, sent: 0 }, cursor: 0,
        } });
      } else if (path.endsWith("/accounts")) {
        if (!accountsAvailable) await route.abort("failed");
        else await route.fulfill({ json: { ok: true, accounts: [{
          userId: "test-account", email: "organizer-with-a-long-email-address@example.invalid", callsign: "N1AAA",
          admin: false, claimed: true, disabled: false, passkeyCount: 1, lastPasskeyUse: null, activeSessionCount: 1,
        }] } });
      } else if (path.includes("/accounts/")) {
        await route.abort("failed");
      } else if (path.endsWith("/plans")) {
        await route.fulfill({ json: { ok: true, plans } });
      } else if (path.endsWith("/approve")) {
        await route.fulfill({ json: { ok: true } });
      } else if (path.endsWith("/pota-status")) {
        await route.fulfill({ json: { ok: true, status: {} } });
      } else {
        await route.fulfill({ json: { ok: true, events: [] } });
      }
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${server.origin}/activate-ri-2026/admin/?view=ops`);
    const workspaces = page.getByRole("tablist", { name: "Organizer workspaces" });
    const ops = workspaces.getByRole("tab", { name: "Ops Room", exact: true });
    await expect(ops).toHaveAttribute("aria-selected", "true");
    await ops.focus();
    await page.keyboard.press("ArrowRight");
    const plansTab = workspaces.getByRole("tab", { name: /^Plans/ });
    await expect(plansTab).toBeFocused();
    await expect(plansTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#admin-plans")).toBeVisible();
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/admin/#plans`);
    await page.reload();
    await expect(plansTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-admin-plan-count]")).toHaveText("2");
    await page.getByRole("button", { name: "Approve N1AAA - Test activator", exact: true }).click();
    await expect(page.locator("[data-admin-plan-count]")).toHaveText("1");
    await expect(page.locator("[data-admin-status]")).toContainText("1 pending submission remaining");

    await plansTab.focus();
    await page.keyboard.press("End");
    await expect(workspaces.getByRole("tab", { name: "Account security" })).toBeFocused();
    await expect(workspaces.getByRole("tab", { name: "Account security" })).toBeInViewport();
    await expect(page.locator("[data-admin-account-status]")).toContainText("Unable to load accounts");
    accountsAvailable = true;
    await page.getByRole("button", { name: "Refresh accounts" }).click();
    await expect(page.locator("[data-admin-account-list]")).toContainText("N1AAA");
    const revoke = page.getByRole("button", { name: "Revoke sessions for N1AAA" });
    page.once("dialog", (dialog) => dialog.accept("N1AAA"));
    await revoke.click();
    await expect(page.locator("[data-admin-account-status]")).toContainText("Check your connection and try again");
    await expect(revoke).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await workspaces.getByRole("tab", { name: "Account security" }).focus();
    await page.keyboard.press("Home");
    await expect(ops).toBeFocused();
    const tools = page.getByRole("tablist", { name: "Ops Room tools" });
    await tools.getByRole("tab", { name: "Room", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tools.getByRole("tab", { name: /^Messages/ })).toBeFocused();
    await expect(page.locator("#admin-ops-messages")).toBeVisible();
    await page.keyboard.press("End");
    await expect(tools.getByRole("tab", { name: "Email", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tools.getByRole("tab", { name: "Room", exact: true })).toBeFocused();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-mode="announcements"]').click();
    await expect(page.locator("[data-admin-ops-status]")).toHaveText("Room settings could not be saved.");
    await expect(page.locator('[data-mode="full"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-mode="announcements"]')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("organizer recovery offers a retry after a connection failure", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.route("**/api/activate-ri-2026/admin/auth/access-bootstrap/start", (route) => route.abort("failed"));
    await page.goto(`${server.origin}/activate-ri-2026/admin/recovery/`);
    const continueButton = page.getByRole("button", { name: "Continue to passkey setup" });
    await continueButton.click();
    await expect(page.locator("[data-admin-bootstrap-status]")).toContainText("Check your connection and try again");
    await expect(continueButton).toBeEnabled();
  } finally {
    await server.stop();
  }
});
