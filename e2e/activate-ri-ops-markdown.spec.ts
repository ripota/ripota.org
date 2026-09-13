import { expect, test, type Locator, type Page } from "@playwright/test";
import type { OpsMessageDto } from "../src/lib/activate-ri/ops-types";
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

test("formatting buttons and keyboard shortcuts preserve selections and saved drafts", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    await openRoom(page, server);
    const body = page.locator("[data-ops-body]");
    const toolbar = page.locator('ops-markdown-toolbar[data-target="ops-message-body"]');
    await body.fill("The gate is open today.");
    await select(body, 12, 16);
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(body).toHaveValue("The gate is **open** today.");
    await expect(body).toBeFocused();
    expect(await selectedText(body)).toBe("open");
    await body.press("ControlOrMeta+I");
    await expect(body).toHaveValue("The gate is ***open*** today.");
    expect(await selectedText(body)).toBe("open");

    await body.fill("See the map");
    await select(body, 8, 11);
    await body.press("ControlOrMeta+K");
    await expect(body).toHaveValue("See the [map](https://)");
    expect(await selectedText(body)).toBe("https://");
    await page.keyboard.insertText("https://ripota.org/parks/");
    await expect(body).toHaveValue("See the [map](https://ripota.org/parks/)");
    await expect(page.locator("[data-ops-send-state]")).toHaveText("Draft saved on this device.");
    await page.reload();
    await expect(body).toHaveValue("See the [map](https://ripota.org/parks/)");
    await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");

    await body.fill("Battery charged\nCoax packed");
    await select(body, 0, 27);
    await toolbar.getByRole("button", { name: "Bulleted list", exact: true }).click();
    await expect(body).toHaveValue("- Battery charged\n- Coax packed");
    await body.fill("Meet by the gate.");
    await select(body, 5, 7);
    await toolbar.getByRole("button", { name: "Quote", exact: true }).click();
    await expect(body).toHaveValue("> Meet by the gate.");
    await body.fill("CQ POTA");
    await select(body, 0, 7);
    await toolbar.getByRole("button", { name: "Code", exact: true }).click();
    await expect(body).toHaveValue("`CQ POTA`");

    await body.fill("a".repeat(1000));
    await select(body, 0, 1000);
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(body).toHaveValue("a".repeat(1000));
    await expect(toolbar.locator("[data-format-status]")).toHaveText("Formatting would exceed the 1,000 character limit.");
    await body.evaluate((element: HTMLTextAreaElement) => { element.readOnly = true; });
    await expect(toolbar.getByRole("button", { name: "Bold", exact: true })).toBeDisabled();
    await body.press("ControlOrMeta+B");
    await expect(body).toHaveValue("a".repeat(1000));
    await body.evaluate((element: HTMLTextAreaElement) => { element.readOnly = false; element.disabled = true; });
    await expect(toolbar.getByRole("button", { name: "Insert link", exact: true })).toBeDisabled();
    await body.evaluate((element: HTMLTextAreaElement) => { element.disabled = false; });
    await expect(toolbar.getByRole("button", { name: "Bold", exact: true })).toBeEnabled();

    await body.fill("**Ready** for radio.");
    const help = toolbar.getByRole("button", { name: "Markdown formatting help", exact: true });
    await help.click();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await expect(toolbar.locator(".ops-markdown-toolbar__help")).toBeVisible();
    await help.click();
    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expect(body).toBeInViewport({ ratio: 1 });
      await expect(page.locator("[data-ops-send]")).toBeInViewport({ ratio: 1 });
      await expect(toolbar).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`ops-markdown-composer-${viewport.width}.png`) });
    }
  } finally {
    await server.stop();
  }
});

test("posted and edited Markdown renders formatting and safe links without executing HTML", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await openRoom(page, server);
    const source = [
      "**Ready** for *radio* with `CQ`.\nNext line.",
      "- Battery charged\n- Coax packed",
      "> Meet near the gate.",
      "[Photos & videos](https://ripota.org/activate-ri-2026/media/)\nhttps://example.com/plain?one=1&two=2",
      '<img src=x onerror="alert(1)"> [unsafe](javascript:alert(1))',
    ].join("\n\n");
    await page.locator("[data-ops-body]").fill(source);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/ops/messages") && response.request().method() === "POST");
    await page.locator("[data-ops-send]").click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBe(true);
    const posted = await response.json() as { event: { message: OpsMessageDto } };
    expect(posted.event.message.body).toBe(source);
    const message = page.locator(`[data-message-id="${posted.event.message.id}"]`);
    const content = message.locator(".ops-message__body");
    await expect(content.locator("strong")).toHaveText("Ready");
    await expect(content.locator("em")).toHaveText("radio");
    await expect(content.locator("code")).toHaveText("CQ");
    await expect(content.locator("ul > li")).toHaveText(["Battery charged", "Coax packed"]);
    await expect(content.locator("blockquote")).toContainText("Meet near the gate.");
    await expect(content.locator("br")).toHaveCount(2);
    await expect(content.getByRole("link", { name: "Photos & videos", exact: true })).toHaveAttribute("href", "https://ripota.org/activate-ri-2026/media/");
    await expect(content.getByRole("link", { name: "https://example.com/plain?one=1&two=2", exact: true })).toHaveAttribute("href", "https://example.com/plain?one=1&two=2");
    await expect(content.locator("img, script, iframe, a[href^='javascript:']")).toHaveCount(0);
    await expect(content).toContainText('<img src=x onerror="alert(1)">');
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await message.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`ops-markdown-feed-${viewport.width}.png`) });
    }
    await page.reload();
    await expect(content.locator("strong")).toHaveText("Ready");

    await page.locator("[data-ops-body]").fill("**Another** draft to keep.");
    await message.getByLabel("Message actions", { exact: true }).click();
    await message.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit message", exact: true });
    const correction = editor.getByLabel("Message", { exact: true });
    await expect(correction).toHaveValue(source);
    await correction.fill("Updated route");
    await select(correction, 0, 7);
    await editor.getByRole("button", { name: "Bold", exact: true }).click();
    await select(correction, 12, 17);
    await correction.press("ControlOrMeta+K");
    await page.keyboard.insertText("https://ripota.org/parks/");
    await expect(correction).toHaveValue("**Updated** [route](https://ripota.org/parks/)");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(content.locator("strong")).toHaveText("Updated");
    await expect(content.getByRole("link", { name: "route", exact: true })).toHaveAttribute("href", "https://ripota.org/parks/");
    await expect(page.locator("[data-ops-body]")).toHaveValue("**Another** draft to keep.");
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

async function select(textarea: Locator, start: number, end: number): Promise<void> {
  await textarea.evaluate((element: HTMLTextAreaElement, range) => {
    element.focus();
    element.setSelectionRange(range.start, range.end);
  }, { start, end });
}

async function selectedText(textarea: Locator): Promise<string> {
  return textarea.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd));
}

async function openRoom(page: Page, server: ActivateRiServer): Promise<void> {
  const submit = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
    headers: { origin: server.origin },
    data: {
      submitterCallsign: "N1MDN", submitterName: "Markdown Tester", submitterEmail: "markdown@example.com",
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
  await page.goto(`${server.origin}/activate-ri-2026/activator/`);
  await expect(page.locator("[data-ops-connection-label]")).toHaveText("Live");
}
