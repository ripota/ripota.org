import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { ActivatorMedia } from "../src/lib/activate-ri/media";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

const apiPath = "/api/activate-ri-2026/activator/media";
const adminPath = "/api/activate-ri-2026/admin/media";
const pagePath = "/activate-ri-2026/activator/media/";
const adminHeaders = { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org" };

// A one-second, silent, 24×24 navy video synthesized with FFmpeg's color source.
// Keeping the resulting tiny WebM here avoids network fixtures and an FFmpeg test dependency.
const video = {
  name: "activation setup.webm",
  mimeType: "video/webm",
  buffer: Buffer.from("GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHLTbuMU6uEElTDZ1OsggEY7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmpSrXsYMPQkBNgIxMYXZmNjMuMS4xMDFXQYxMYXZmNjMuMS4xMDEWVK5ryK4BAAAAAAAAP9eBAXPFiMJfhnov8wYYnIEAIrWcg3VuZIiBAIaFVl9WUDiDgQEj44OEHc1lAOCQsIEYuoEYmoECVbCEVbmBARJUw2fWc3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2My4xLjEwMXNzsWPAi2PFiMJfhnov8wYYZ8igRaOHRU5DT0RFUkSHk0xhdmM2My4xLjEwMSBsaWJ2cHgfQ7Z11ueBAKO6gQAAgJACAJ0BKhgAGAAARwiFhYiFhIgCAgJ1qgIH+RXeYP7/jeT//bQP/20D/9tA/+2gf43m81qxAKOVgQH0ALEBAAEQEAAYABhYL/QACHAA", "base64"),
};

test("activators upload private originals, play previews, and manage files with organizers", async ({ page, browser, request }, testInfo) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true, seedAccountOnly: true });
  const otherContext = await browser.newContext();
  const adminContext = await browser.newContext({ extraHTTPHeaders: adminHeaders });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const photo = await makePhoto(page, "Coastal activation – café.png");
    await signInActivator(page, server.origin, "N1PIC");
    await page.getByRole("link", { name: "Photos & Videos", exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}${pagePath}`);
    await expect(page.locator("[data-media-usage]")).toContainText("0 of 50 files");
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles([photo, video]);
    await expect(page.locator('[data-media-queue] [data-state="ready"]')).toHaveCount(2);
    await expect(page.locator("[data-media-gallery] article")).toHaveCount(0);
    const uploads: Array<Promise<{ status: number; size: string | undefined }>> = [];
    page.on("response", (response) => {
      if (response.url() === `${server.origin}${apiPath}` && response.request().method() === "POST") {
        uploads.push(response.request().allHeaders().then((headers) => ({ status: response.status(), size: headers["content-length"] })));
      }
    });
    await page.getByRole("button", { name: "Upload 2 files", exact: true }).click();
    await expect(page.locator('[data-media-queue] [data-state="saved"]'), server.output()).toHaveCount(2);
    expect(await Promise.all(uploads)).toEqual([
      { status: 201, size: String(photo.buffer.length) },
      { status: 201, size: String(video.buffer.length) },
    ]);
    await expect(page.locator("[data-media-usage]")).toContainText("2 of 50 files");
    await page.reload();
    const gallery = page.locator("[data-media-gallery]");
    await expect(gallery.locator("article")).toHaveCount(2);
    const image = gallery.getByRole("img", { name: photo.name, exact: true });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth)).toBe(32);
    const player = gallery.getByLabel(video.name, { exact: true });
    await player.evaluate((node: HTMLVideoElement) => node.play());
    await expect.poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0);
    expect(await player.evaluate((node: HTMLVideoElement) => { node.pause(); return node.videoWidth; })).toBe(24);

    const listed = await page.request.get(`${server.origin}${apiPath}`);
    const body = await listed.json() as { media: ActivatorMedia[]; usage: { files: number; bytes: number } };
    expect(body.usage).toEqual({ files: 2, bytes: photo.buffer.length + video.buffer.length });
    expect(JSON.stringify(body)).not.toMatch(/object_key|activator_id|@example/);
    const savedPhoto = body.media.find((file) => file.filename === photo.name)!;
    const savedVideo = body.media.find((file) => file.filename === video.name)!;
    expect(savedPhoto.kind).toBe("photo");
    expect(savedVideo.kind).toBe("video");
    for (const [saved, fixture] of [[savedPhoto, photo], [savedVideo, video]] as const) {
      const fileUrl = `${server.origin}${saved.url}`;
      const original = await page.request.get(fileUrl);
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(fixture.buffer);
      expect(original.headers()).toMatchObject({
        "content-type": fixture.mimeType,
        "content-length": String(fixture.buffer.length),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "accept-ranges": "bytes",
      });
      const head = await page.request.head(fileUrl);
      expect(head.status()).toBe(200);
      expect(head.headers()["content-length"]).toBe(String(fixture.buffer.length));
      expect(head.headers().etag).toBe(original.headers().etag);
      expect(await head.body()).toHaveLength(0);
    }
    const videoUrl = `${server.origin}${savedVideo.url}`;
    const range = await page.request.get(videoUrl, { headers: { range: "bytes=8-23" } });
    expect(range.status()).toBe(206);
    expect(range.headers()["content-range"]).toBe(`bytes 8-23/${video.buffer.length}`);
    expect(await range.body()).toEqual(video.buffer.subarray(8, 24));
    const suffix = await page.request.get(videoUrl, { headers: { range: "bytes=-12" } });
    expect(suffix.status()).toBe(206);
    expect(await suffix.body()).toEqual(video.buffer.subarray(-12));
    const unsatisfied = await page.request.get(videoUrl, { headers: { range: `bytes=${video.buffer.length}-` } });
    expect(unsatisfied.status()).toBe(416);
    expect(unsatisfied.headers()["content-range"]).toBe(`bytes */${video.buffer.length}`);
    const ifRange = await page.request.get(videoUrl, { headers: { range: "bytes=8-23", "if-range": '"old-version"' } });
    expect(ifRange.status()).toBe(200);
    expect(await ifRange.body()).toEqual(video.buffer);
    const downloadPromise = page.waitForEvent("download");
    await gallery.getByRole("link", { name: `Download original ${photo.name}`, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(photo.name);
    expect(readFileSync((await download.path())!)).toEqual(photo.buffer);

    // Both container validation and its reservation cleanup run against real D1/R2.
    const forged = await page.request.post(`${server.origin}${apiPath}`, {
      headers: { origin: server.origin, "content-type": "image/png", "x-media-filename": "forged.png" },
      data: Buffer.from("<html>This is not a PNG photo.</html>"),
    });
    expect(forged.status(), await forged.text()).toBe(400);
    expect(await forged.text()).toContain("file contents do not match");
    expect((await (await page.request.get(`${server.origin}${apiPath}`)).json()).usage).toEqual(body.usage);
    const crossOriginDelete = await page.request.delete(`${server.origin}${apiPath}/${savedPhoto.id}`, {
      headers: { origin: "https://untrusted.example" },
    });
    expect(crossOriginDelete.status()).toBe(403);
    for (const path of [apiPath, savedPhoto.url, savedVideo.url]) {
      expect((await request.get(`${server.origin}${path}`)).status()).toBe(401);
    }
    expect((await request.delete(`${server.origin}${apiPath}/${savedPhoto.id}`, { headers: { origin: server.origin } })).status()).toBe(401);
    expect((await request.get(`${server.origin}${apiPath}`, {
      headers: { cookie: `__Host-ripota-session=${server.accountOnlySessionToken}` },
    })).status()).toBe(401);

    const otherPage = await otherContext.newPage();
    await signInActivator(otherPage, server.origin, "N1OTH");
    expect((await (await otherPage.request.get(`${server.origin}${apiPath}`)).json()).media).toEqual([]);
    expect((await otherPage.request.get(`${server.origin}${savedPhoto.url}`)).status()).toBe(404);
    expect((await otherPage.request.delete(`${server.origin}${apiPath}/${savedVideo.id}`, { headers: { origin: server.origin } })).status()).toBe(404);

    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${server.origin}/activate-ri-2026/admin/#media`);
    await expect(adminPage.getByRole("tab", { name: "Photos & Videos", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(adminPage.locator("[data-media-gallery] article")).toHaveCount(2);
    await expect(adminPage.locator("[data-media-gallery] article").first()).toContainText("N1PIC");
    await expect(adminPage.locator("[data-media-input]")).toHaveCount(0);
    const adminPhoto = await adminPage.request.get(`${server.origin}${adminPath}/${savedPhoto.id}/file`);
    expect(adminPhoto.status()).toBe(200);
    expect(await adminPhoto.body()).toEqual(photo.buffer);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.screenshot({ path: testInfo.outputPath("media-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(image).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await player.evaluate((node: HTMLVideoElement) => {
      const videoBounds = node.getBoundingClientRect();
      const previewBounds = node.parentElement!.getBoundingClientRect();
      return videoBounds.left >= previewBounds.left - 1 && videoBounds.right <= previewBounds.right + 1
        && videoBounds.top >= previewBounds.top - 1 && videoBounds.bottom <= previewBounds.bottom + 1;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("media-mobile.png"), fullPage: true });
    await gallery.getByRole("button", { name: `Delete ${photo.name}`, exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this file?" });
    await expect(confirm.getByRole("button", { name: "Keep file", exact: true })).toBeFocused();
    await confirm.getByRole("button", { name: "Keep file", exact: true }).click();
    await expect(gallery.locator("article")).toHaveCount(2);
    await gallery.getByRole("button", { name: `Delete ${photo.name}`, exact: true }).click();
    await confirm.getByRole("button", { name: "Delete file", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(gallery.locator("article")).toHaveCount(1);
    expect((await page.request.get(`${server.origin}${savedPhoto.url}`)).status()).toBe(404);
    await adminPage.getByRole("button", { name: `Delete ${video.name}`, exact: true }).click();
    await adminPage.getByRole("dialog", { name: "Delete this file?" }).getByRole("button", { name: "Delete file", exact: true }).click();
    await expect(adminPage.locator("[data-media-gallery] article")).toHaveCount(1);
    await page.reload();
    await expect(page.locator("[data-media-usage]")).toContainText("0 of 50 files");
    await expect(gallery.locator("article")).toHaveCount(0);
    expect((await page.request.get(videoUrl)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
    await adminContext.close();
    await server.stop();
  }
});

test("selection rejects unsupported files and preserves uploads for retry and cancellation", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  let releaseCancelled!: () => void;
  const cancelledRequest = new Promise<void>((resolve) => { releaseCancelled = resolve; });
  let cancelStarted!: () => void;
  const cancelRequestStarted = new Promise<void>((resolve) => { cancelStarted = resolve; });
  try {
    const photo = await makePhoto(page, "retry.png");
    await signInActivator(page, server.origin, "N1RTY");
    await page.goto(`${server.origin}${pagePath}`);
    await expect(page.locator("[data-media-usage]")).toContainText("0 of 50 files");
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles({
      name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("activation notes"),
    });
    await page.locator("[data-media-input]").evaluate((input: HTMLInputElement) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(20 * 1024 * 1024 + 1)], "too-large.png", { type: "image/png" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const invalid = page.locator('[data-media-queue] [data-state="invalid"]');
    await expect(invalid).toHaveCount(2);
    await expect(invalid.filter({ hasText: "notes.txt" })).toContainText("Choose a JPEG");
    await expect(invalid.filter({ hasText: "too-large.png" })).toContainText("Photos must be 20 MB or smaller");
    await expect(page.locator("[data-media-upload]")).toBeDisabled();
    await page.getByRole("button", { name: "Clear finished files", exact: true }).click();

    let attempts = 0;
    await page.route(`**${apiPath}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (route.request().headers()["x-media-filename"] === "cancel.png") {
        cancelStarted();
        await cancelledRequest;
        await route.abort("aborted");
        return;
      }
      attempts++;
      if (attempts === 1) await route.fulfill({ status: 503, json: { error: "Storage is temporarily unavailable. Please retry." } });
      else await route.continue();
    });
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles(photo);
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    const retryRow = page.locator("[data-media-queue] li").filter({ hasText: photo.name });
    await expect(retryRow).toHaveAttribute("data-state", "error");
    await expect(retryRow).toContainText("Storage is temporarily unavailable");
    await expect(page.locator("[data-media-gallery] article")).toHaveCount(0);
    await page.getByRole("button", { name: `Retry upload of ${photo.name}`, exact: true }).click();
    await expect(retryRow).toHaveAttribute("data-state", "saved");
    await expect(page.locator("[data-media-gallery] article")).toHaveCount(1);
    expect(attempts).toBe(2);

    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles({ ...photo, name: "cancel.png" });
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    await cancelRequestStarted;
    await page.getByRole("button", { name: "Cancel upload of cancel.png", exact: true }).click();
    const cancelled = page.locator("[data-media-queue] li").filter({ hasText: "cancel.png" });
    await expect(cancelled).toHaveAttribute("data-state", "cancelled");
    await expect(cancelled).toContainText("Upload cancelled");
    await expect(page.getByRole("button", { name: "Retry upload of cancel.png", exact: true })).toBeEnabled();
    releaseCancelled();
    expect((await (await page.request.get(`${server.origin}${apiPath}`)).json()).usage.files).toBe(1);
  } finally {
    releaseCancelled();
    await page.unrouteAll({ behavior: "wait" });
    await server.stop();
  }
});

test("a throttled batch preserves unattempted files and resumes through explicit retry", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    const photo = await makePhoto(page, "batch.png");
    const selection = Array.from({ length: 12 }, (_, index) => ({
      ...photo, name: `activation-${String(index + 1).padStart(2, "0")}.png`,
    }));
    const saved: ActivatorMedia[] = [];
    const attempted: string[] = [];
    const waitMessage = "Please wait a minute before uploading more files.";
    await signInActivator(page, server.origin, "N1BAT");
    await page.route(`**${apiPath}`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: {
          ok: true, media: saved, usage: { files: saved.length, bytes: saved.length * photo.buffer.length },
        } });
        return;
      }
      const filename = decodeURIComponent(route.request().headers()["x-media-filename"]);
      attempted.push(filename);
      if (attempted.length === 11) {
        await route.fulfill({ status: 429, headers: { "retry-after": "60" }, json: { ok: false, error: waitMessage } });
        return;
      }
      const id = `00000000-0000-4000-8000-${String(saved.length + 1).padStart(12, "0")}`;
      const media: ActivatorMedia = {
        id, filename, contentType: "image/png", kind: "photo", size: photo.buffer.length,
        createdAt: "2026-09-11T12:00:00.000Z", callsign: "N1BAT", url: `${apiPath}/${id}/file`,
      };
      saved.push(media);
      await route.fulfill({ status: 201, json: { ok: true, media } });
    });
    await page.route(`**${apiPath}/*/file`, (route) => route.fulfill({ contentType: "image/png", body: photo.buffer }));
    await page.goto(`${server.origin}${pagePath}`);
    await expect(page.locator("[data-media-usage]")).toContainText("0 of 50 files");
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles(selection);
    await page.getByRole("button", { name: "Upload 12 files", exact: true }).click();
    const queue = page.locator("[data-media-queue]");
    const throttled = queue.locator("li").filter({ hasText: "activation-11.png" });
    const unattempted = queue.locator("li").filter({ hasText: "activation-12.png" });
    await expect(throttled).toHaveAttribute("data-state", "error");
    await expect(throttled).toContainText(waitMessage);
    await expect(page.locator("[data-media-upload-status]")).toContainText(waitMessage);
    await expect(page.locator("[data-media-upload-status]")).toContainText("1 selected file remains ready to upload");
    await expect(queue.locator('[data-state="saved"]')).toHaveCount(10);
    await expect(unattempted).toHaveAttribute("data-state", "ready");
    const retry = page.getByRole("button", { name: "Retry upload of activation-11.png", exact: true });
    await expect(retry).toBeEnabled();
    expect(attempted).toEqual(selection.slice(0, 11).map((file) => file.name));

    await retry.click();
    await expect(throttled).toHaveAttribute("data-state", "saved");
    await expect(page.locator("[data-media-gallery] article")).toHaveCount(11);
    await expect(unattempted).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "Upload 1 file", exact: true })).toBeEnabled();
    expect(attempted).toEqual([...selection.slice(0, 11).map((file) => file.name), "activation-11.png"]);
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    await expect(queue.locator('[data-state="saved"]')).toHaveCount(12);
    await expect(page.locator("[data-media-usage]")).toContainText("12 of 50 files");
    expect(attempted).toEqual([...selection.slice(0, 11).map((file) => file.name), "activation-11.png", "activation-12.png"]);
  } finally {
    await server.stop();
  }
});

async function signInActivator(page: Page, origin: string, callsign: string): Promise<void> {
  const response = await page.request.post(`${origin}/api/activate-ri-2026/plans`, {
    headers: { origin },
    data: {
      submitterCallsign: callsign, submitterName: "Synthetic Media Activator", submitterEmail: `${callsign.toLowerCase()}@example.com`,
      stops: [{ parkReference: "US-2868", plannedDate: "2026-09-11", timeBlock: "09:00-12:00", bands: ["40m"], modes: ["SSB"] }],
    },
  });
  expect(response.status(), await response.text()).toBe(202);
  const submitted = await response.json() as { editUrl: string };
  await page.goto(submitted.editUrl);
  await expect(page.locator('[name="submitterCallsign"]')).toHaveValue(callsign);
}

async function makePhoto(page: Page, name: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#346f68";
    context.fillRect(0, 0, 32, 24);
    context.fillStyle = "#e9c46a";
    context.fillRect(8, 6, 16, 12);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return { name, mimeType: "image/png", buffer: Buffer.from(encoded, "base64") };
}
