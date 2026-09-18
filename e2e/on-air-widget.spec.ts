import { expect, test as base } from "@playwright/test";
import { renderOnAirEmbed } from "../src/worker/routes/on-air-embed";
import type { RiPotaSpotsSnapshot } from "../src/worker/routes/pota";
import { parseOnAirEmbedPath } from "../src/lib/pota/on-air-embed";
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";

type Feed = { snapshot: RiPotaSpotsSnapshot | null; requests: string[] };
const test = base.extend<{ feed: Feed }, { server: ActivateRiServer }>({
  server: [async ({}, use) => {
    const server = await startActivateRiServer();
    try { await use(server); } finally { await server.stop(); }
  }, { scope: "worker" }],
  feed: async ({ context, request, server }, use) => {
    const feed: Feed = { snapshot: fixture(), requests: [] };
    // Exercise the real Worker routing and framing policy, with deterministic spot bodies.
    const head = await request.head(`${server.origin}/embed/on-air/`);
    expect(head.status()).toBe(200);
    await context.route("**/embed/on-air/**", async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("visit")) return route.continue();
      feed.requests.push(url.pathname + url.search);
      return route.fulfill({ status: 200, headers: head.headers(), body: renderOnAirEmbed(feed.snapshot, {
        callsign: parseOnAirEmbedPath(url.pathname)?.callsign,
        preview: url.searchParams.get("preview") === "1",
      }) });
    });
    await use(feed);
  },
});

test("requires a callsign, generates a normalized preview and snippet, copies, and clears outdated output", async ({ page, context, server, feed }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${server.origin}/widgets/on-air/`);
  const callsign = page.getByLabel("Your callsign (required)");
  const generate = page.getByRole("button", { name: "Generate my widget" });
  const code = page.getByLabel("QRZ embed code");
  await expect(callsign).toHaveValue("");
  await expect(callsign).not.toHaveAttribute("placeholder");
  await expect(generate).toBeDisabled();
  await expect(code).toBeHidden();
  expect(feed.requests).toHaveLength(0);
  for (const invalid of ["   ", "K1NW<script>"]) {
    await callsign.fill(invalid);
    await expect(generate).toBeDisabled();
    await expect(code).toBeHidden();
  }
  await callsign.fill(" k1nw ");
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(callsign).toHaveValue("K1NW");
  await expect(page.getByLabel("Your widget URL")).toHaveValue("https://ripota.org/embed/on-air/K1NW/");
  await expect(code).toHaveValue(/src="https:\/\/ripota.org\/embed\/on-air\/K1NW\/"/);
  await expect(page.frameLocator("[data-widget-preview]").getByRole("heading", { name: "Rhode Island on air", exact: true })).toBeVisible();
  expect(feed.requests).toEqual(["/embed/on-air/K1NW/?preview=1"]);
  await page.getByRole("button", { name: "Copy embed code" }).click();
  await expect(page.getByRole("status")).toContainText("Embed code copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await code.inputValue());
  expect(await code.inputValue()).not.toContain("preview=1");

  await callsign.fill("ea8/k1nw/p");
  await expect(code).toBeHidden();
  await expect(page.locator("[data-widget-preview]")).toBeHidden();
  await generate.click();
  await expect(page.getByLabel("Your widget URL")).toHaveValue("https://ripota.org/embed/on-air/EA8%2FK1NW%2FP/");
  await expect(page.frameLocator("[data-widget-preview]").getByText("W1AW", { exact: true })).toBeVisible();
  await callsign.fill("");
  await expect(generate).toBeDisabled();
  await expect(code).toBeHidden();
});

for (const identity of [
  { name: "community profile", body: { ok: true, profile: { callsign: " k1nw " }, proposedCallsign: "N1OLD" }, expected: "K1NW" },
  { name: "activator registration", body: { ok: true, profile: null, proposedCallsign: "n1rwj" }, expected: "N1RWJ" },
]) {
  test(`prefills the callsign from the signed-in ${identity.name} and allows changes`, async ({ page, server, feed }) => {
    await page.route("**/api/auth/community-profile", route => route.fulfill({ json: identity.body }));
    await page.goto(`${server.origin}/widgets/on-air/`);
    const callsign = page.getByLabel("Your callsign (required)");
    const generate = page.getByRole("button", { name: "Generate my widget" });
    await expect(callsign).toHaveValue(identity.expected);
    await expect(generate).toBeEnabled();
    expect(feed.requests).toHaveLength(0);
    expect(new URL(page.url()).search).toBe("");
    await generate.click();
    await expect(page.getByLabel("Your widget URL")).toHaveValue(`https://ripota.org/embed/on-air/${identity.expected}/`);
    await callsign.fill("W1AW");
    await generate.click();
    await expect(page.getByLabel("Your widget URL")).toHaveValue("https://ripota.org/embed/on-air/W1AW/");
  });
}

for (const response of [
  { name: "signed out", status: 401, json: { ok: false } },
  { name: "no callsign saved", status: 200, json: { ok: true, profile: null, proposedCallsign: null } },
  { name: "profile unavailable", status: 503, json: { ok: false } },
]) {
  test(`allows manual entry with ${response.name}`, async ({ page, server, feed }) => {
    await page.route("**/api/auth/community-profile", route => route.fulfill(response));
    const profileResponse = page.waitForResponse("**/api/auth/community-profile");
    await page.goto(`${server.origin}/widgets/on-air/`);
    await profileResponse;
    const callsign = page.getByLabel("Your callsign (required)");
    const generate = page.getByRole("button", { name: "Generate my widget" });
    await expect(callsign).toHaveValue("");
    await expect(generate).toBeDisabled();
    await callsign.fill("K1NW");
    await generate.click();
    await expect(page.getByLabel("Your widget URL")).toHaveValue("https://ripota.org/embed/on-air/K1NW/");
    await expect.poll(() => feed.requests).toContain("/embed/on-air/K1NW/?preview=1");
  });
}

for (const edited of ["W1AW", ""]) {
  test(`preserves ${edited ? "a manually entered" : "a deliberately cleared"} callsign when the profile arrives late`, async ({ page, server, feed }) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/auth/community-profile", async route => {
      await pending;
      await route.fulfill({ json: { ok: true, profile: { callsign: "K1NW" } } });
    });
    const profileRequest = page.waitForRequest("**/api/auth/community-profile");
    await page.goto(`${server.origin}/widgets/on-air/`);
    await profileRequest;
    const callsign = page.getByLabel("Your callsign (required)");
    await callsign.fill("W1AW");
    if (!edited) await callsign.fill("");
    const profileResponse = page.waitForResponse("**/api/auth/community-profile");
    release();
    await (await profileResponse).finished();
    await page.waitForLoadState("networkidle");
    await expect(callsign).toHaveValue(edited);
    const generate = page.getByRole("button", { name: "Generate my widget" });
    if (edited) await expect(generate).toBeEnabled();
    else await expect(generate).toBeDisabled();
    expect(feed.requests).toHaveLength(0);
  });
}

test("offers selected code when clipboard access is denied", async ({ page, server, feed }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async () => { throw new Error("Permission denied"); } },
  }));
  await page.goto(`${server.origin}/widgets/on-air/`);
  await page.getByLabel("Your callsign (required)").fill("K1NW");
  await page.getByRole("button", { name: "Generate my widget" }).click();
  await page.getByRole("button", { name: "Copy embed code" }).click();
  await expect(page.getByRole("status")).toContainText("The embed code is selected");
  const code = page.getByLabel("QRZ embed code");
  await expect(code).toBeFocused();
  expect(await code.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBe((await code.inputValue()).length);
  expect(feed.snapshot).not.toBeNull();
});

for (const width of [320, 960]) {
  test(`the ${width}px iframe keeps all spots reachable and handles quiet, delayed, and unavailable feeds`, async ({ page, server, feed }, testInfo) => {
    await page.setViewportSize({ width, height: 420 });
    await page.goto(`${server.origin}/embed/on-air/K1NW/`);
    await expect(page.locator(".spot")).toHaveCount(8);
    await expect(page.getByRole("link", { name: "Full on-air view" })).toBeVisible();
    const scroll = page.getByRole("region", { name: "Current Rhode Island spots" });
    expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await scroll.focus();
    await page.keyboard.press("End");
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`widget-spots-${width}.png`) });
    for (const [state, snapshot, title] of [
      ["empty", { ...fixture(), spots: [] }, "No current Rhode Island spots"],
      ["stale", { ...fixture(), stale: true }, "Updates delayed"],
      ["unavailable", null, "Live status temporarily unavailable"],
    ] satisfies [string, RiPotaSpotsSnapshot | null, string][]) {
      feed.snapshot = snapshot;
      await page.reload();
      await expect(page.locator("main")).toHaveAttribute("data-embed-state", state);
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(page.getByRole("link", { name: "Official POTA spots" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`widget-${state}-${width}.png`) });
    }
  });
}

test("generator fits a phone and attributes a click through the real Worker", async ({ page, server, feed }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.origin}/widgets/on-air/`);
  await page.getByLabel("Your callsign (required)").fill("K1NW");
  await page.getByRole("button", { name: "Generate my widget" }).click();
  await expect(page.frameLocator("[data-widget-preview]").getByText("W1AW", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("generator-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("generator-desktop.png"), fullPage: true });
  // Published embeds preserve attribution through the fixed, same-origin click redirect.
  await page.goto(`${server.origin}/embed/on-air/K1NW/`);
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Full on-air view" }).click(),
  ]);
  await expect(popup).toHaveURL(`${server.origin}/on-air/?utm_source=qrz&utm_medium=widget&utm_campaign=ri-on-air&utm_content=K1NW`);
  await server.waitForOutput(/"event":"on-air-widget","action":"click","embedder":"K1NW"/);
  await popup.close();
  expect(feed.requests).toContain("/embed/on-air/K1NW/");
});

test("the iframe refreshes after a minute while retaining preview and embedder attribution", async ({ page, server, feed }) => {
  test.setTimeout(80_000);
  await page.goto(`${server.origin}/widgets/on-air/`);
  await page.getByLabel("Your callsign (required)").fill("K1NW/P");
  await page.getByRole("button", { name: "Generate my widget" }).click();
  await expect(page.frameLocator("[data-widget-preview]").getByText("W1AW", { exact: true })).toBeVisible();
  feed.snapshot = { ...fixture(), spots: [] };
  await expect.poll(() => feed.requests, { timeout: 70_000, intervals: [1000] }).toContain("/embed/on-air/K1NW%2FP/?refresh=1&preview=1");
  await expect(page.frameLocator("[data-widget-preview]").getByRole("heading", { name: "No current Rhode Island spots" })).toBeVisible();
});

function fixture(): RiPotaSpotsSnapshot {
  const now = new Date().toISOString();
  return { generatedAt: now, stale: false, spots: Array.from({ length: 8 }, (_, index) => ({
    id: String(index), parkReference: "US-10545", parkName: "Hillsdale Preserve Management Area",
    activatorCallsign: index === 0 ? "W1AW" : `N${index}RI`, frequency: "14052.0", mode: "CW",
    spotTime: now, spotterCallsign: "N1BS", comments: "", sourceLabel: "POTA", upstreamCount: null,
    locationDesc: "US-RI", expiresInSeconds: 300, parkUrl: "https://pota.app/#/park/US-10545", spotsUrl: "https://pota.app/",
  })) };
}
