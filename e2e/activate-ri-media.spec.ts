import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { mediaUsageNoticeText, type ActivatorMedia } from "../src/lib/activate-ri/media";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

const apiPath = "/api/activate-ri-2026/activator/media";
const pagePath = "/activate-ri-2026/activator/media/";
const adminHeaders = { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org" };

// A one-second, silent, 24×24 navy video synthesized with FFmpeg's color source.
// Keeping the resulting tiny WebM here avoids network fixtures and an FFmpeg test dependency.
const video = {
  name: "activation setup.webm",
  mimeType: "video/webm",
  buffer: Buffer.from("GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHLTbuMU6uEElTDZ1OsggEY7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmpSrXsYMPQkBNgIxMYXZmNjMuMS4xMDFXQYxMYXZmNjMuMS4xMDEWVK5ryK4BAAAAAAAAP9eBAXPFiMJfhnov8wYYnIEAIrWcg3VuZIiBAIaFVl9WUDiDgQEj44OEHc1lAOCQsIEYuoEYmoECVbCEVbmBARJUw2fWc3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2My4xLjEwMXNzsWPAi2PFiMJfhnov8wYYZ8igRaOHRU5DT0RFUkSHk0xhdmM2My4xLjEwMSBsaWJ2cHgfQ7Z11ueBAKO6gQAAgJACAJ0BKhgAGAAARwiFhYiFhIgCAgJ1qgIH+RXeYP7/jeT//bQP/20D/9tA/+2gf43m81qxAKOVgQH0ALEBAAEQEAAYABhYL/QACHAA", "base64"),
};

test("the gallery opens original media in owner-aware dialogs and preserves metadata", async ({ page, browser, request }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true, seedAccountOnly: true });
  const otherContext = await browser.newContext();
  const adminContext = await browser.newContext({ extraHTTPHeaders: adminHeaders });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const photo = coastalPhoto("Coastal activation – café.jpg");
    await signInActivator(page, server.origin, "N1PIC");
    const pending = await (await page.request.get(`${server.origin}/api/activate-ri-2026/admin/plans`, { headers: adminHeaders })).json() as { plans: Array<{ id: string; submitter_callsign: string }> };
    const activator = pending.plans.find((plan) => plan.submitter_callsign === "N1PIC")!;
    expect((await page.request.post(`${server.origin}/api/activate-ri-2026/admin/plans/${activator.id}/approve`, { headers: adminHeaders })).ok()).toBe(true);
    const profile = await page.request.patch(`${server.origin}/api/activate-ri-2026/ops/profile`, { headers: { origin: server.origin }, data: { displayName: "Coastal Operator" } });
    expect(profile.status(), await profile.text()).toBe(200);
    const authorLabel = (await profile.json() as { authorLabel: string }).authorLabel;
    expect(authorLabel).toBe("N1PIC - Coastal Operator");
    await page.getByRole("link", { name: "Photos & Videos", exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}${pagePath}`);
    await expect(page.locator("[data-media-input]")).toBeHidden();
    await expect(page.locator("[data-media-details-dialog]")).toBeHidden();
    const launcher = page.getByRole("button", { name: "Upload photos & videos", exact: true });
    await expect(launcher).toBeVisible();
    const upload = await openUpload(page);
    await expect(page.getByLabel("Park (optional)", { exact: true })).toHaveValue("");
    await page.getByLabel("Park (optional)", { exact: true }).selectOption("US-2868");
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles([photo, video]);
    await expect(page.locator('[data-media-queue] [data-state="ready"]')).toHaveCount(2);
    await expect(page.getByLabel(`Park for ${photo.name}`, { exact: true })).toHaveValue("US-2868");
    await page.getByLabel(`Park for ${video.name}`, { exact: true }).selectOption("");
    await expect(upload).toContainText(mediaUsageNoticeText);
    await expect(upload.getByRole("checkbox")).toHaveCount(0);
    await expect(upload).not.toContainText(/500 MB|50 files/);
    await captureMediaScreenshots(page, "gallery-upload", "[data-media-upload-dialog]");
    const uploads: Array<Promise<{ status: number; size: string | undefined; park: string | undefined }>> = [];
    page.on("response", (response) => {
      if (response.url() === `${server.origin}${apiPath}` && response.request().method() === "POST") {
        uploads.push(response.request().allHeaders().then((headers) => ({ status: response.status(), size: headers["content-length"], park: headers["x-media-park-reference"] })));
      }
    });
    await upload.getByRole("button", { name: "Upload 2 files", exact: true }).click();
    await expect(upload, server.output()).toBeHidden();
    await expect(launcher).toBeFocused();
    expect(await Promise.all(uploads)).toEqual([
      { status: 201, size: String(photo.buffer.length), park: "US-2868" },
      { status: 201, size: String(video.buffer.length), park: undefined },
    ]);
    await expect(page.locator("[data-media-queue] li")).toHaveCount(0);
    await page.reload();
    const gallery = page.locator("[data-media-gallery]");
    await expect(gallery.locator("article")).toHaveCount(2);
    const body = await (await page.request.get(`${server.origin}${apiPath}`)).json() as { media: ActivatorMedia[]; usage: { files: number; bytes: number } };
    expect(body.usage).toEqual({ files: 2, bytes: photo.buffer.length + video.buffer.length });
    expect(JSON.stringify(body)).not.toMatch(/object_key|activator_id|@example/);
    const savedPhoto = body.media.find((file) => file.filename === photo.name)!;
    const savedVideo = body.media.find((file) => file.filename === video.name)!;
    expect(savedPhoto.parkReference).toBe("US-2868");
    expect(savedVideo.parkReference).toBeNull();
    expect(savedPhoto.authorLabel).toBe(authorLabel);
    const photoTile = gallery.locator(`[data-media-id="${savedPhoto.id}"]`);
    const videoTile = gallery.locator(`[data-media-id="${savedVideo.id}"]`);
    await expect(photoTile.locator("[data-media-author]")).toHaveText(authorLabel);
    await expect(photoTile).not.toContainText(photo.name);
    await expect(videoTile).not.toContainText(video.name);
    await expect(photoTile.locator("[data-media-park-badge]")).toHaveText("US-2868");
    const tooltip = photoTile.locator("[data-media-park-tooltip]");
    await photoTile.locator("[data-media-open-detail]").focus();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Beavertail");
    await photoTile.hover();
    await expect(tooltip).toBeVisible();

    const trigger = photoTile.locator("[data-media-open-detail]");
    await page.evaluate(() => scrollTo(0, 180));
    await trigger.scrollIntoViewIfNeeded();
    const previousScroll = await page.evaluate(() => scrollY);
    expect(previousScroll).toBeGreaterThan(0);
    const previousStyle = await page.evaluate(() => ({ body: document.body.style.cssText, html: document.documentElement.style.cssText }));
    const details = await openDetails(page, savedPhoto.id);
    await expect(details.locator("[data-media-details-preview] img")).toBeVisible();
    await expect.poll(() => details.locator("[data-media-details-preview] img").evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    await expect(details).toContainText("Beavertail");
    await expect(details).not.toContainText(photo.name);
    const backgroundY = await photoTile.evaluate((node) => node.getBoundingClientRect().top);
    await page.mouse.move(2, 2);
    await page.mouse.wheel(0, 700);
    await renderFrame(page);
    expect(await photoTile.evaluate((node) => node.getBoundingClientRect().top)).toBeCloseTo(backgroundY, 0);
    await details.getByRole("button", { name: "Close details", exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(previousScroll, 0);
    await expect.poll(() => page.evaluate(() => ({ body: document.body.style.cssText, html: document.documentElement.style.cssText }))).toEqual(previousStyle);

    await openDetails(page, savedVideo.id);
    const player = details.locator("[data-media-details-preview] video");
    await player.evaluate((node: HTMLVideoElement) => node.play());
    await expect.poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0);
    expect(await player.evaluate((node: HTMLVideoElement) => { node.pause(); return node.videoWidth; })).toBe(24);
    await closeDetails(page);
    const title = "Morning on the Rhode Island coast";
    const description = "A portable station, an ocean view, and a good morning on the air.";
    const detailRequests: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url() === `${server.origin}${apiPath}/${savedPhoto.id}`) detailRequests.push(request.postDataJSON() as Record<string, unknown>);
    });
    await editDetails(page, savedPhoto.id, { title, description });
    expect(detailRequests).toEqual([{ title, description }]);
    await editDetails(page, savedPhoto.id, {});
    expect(detailRequests).toHaveLength(1);
    await page.reload();
    await expect(photoTile.locator("[data-media-title]")).toHaveText(title);
    await openDetails(page, savedPhoto.id);
    await expect(details.getByLabel("Description (optional)", { exact: true })).toHaveValue(description);
    await captureMediaScreenshots(page, "gallery-details", "[data-media-details-dialog]");
    await closeDetails(page);
    const unsafeTitle = "Coastal station <N1PIC>";
    const unsafeDescription = 'Notes <img src=x onerror="window.mediaInjected=true"> & <script>window.mediaInjected=true</script>';
    await editDetails(page, savedPhoto.id, { title: unsafeTitle, description: unsafeDescription });
    await page.reload();
    await expect(photoTile.locator("[data-media-title]")).toHaveText(unsafeTitle);
    expect(await page.evaluate(() => (window as Window & { mediaInjected?: boolean }).mediaInjected)).toBeUndefined();
    await editDetails(page, savedPhoto.id, { title, description });

    for (const [saved, fixture] of [[savedPhoto, photo], [savedVideo, video]] as const) {
      const fileUrl = `${server.origin}${saved.url}`;
      const original = await page.request.get(fileUrl);
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(fixture.buffer);
      expect(original.headers()).toMatchObject({ "content-type": fixture.mimeType, "content-length": String(fixture.buffer.length), "cache-control": "private, no-store", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin", "accept-ranges": "bytes" });
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
    await openDetails(page, savedPhoto.id);
    const downloadPromise = page.waitForEvent("download");
    await details.locator("[data-media-download]").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(photo.name);
    expect(readFileSync((await download.path())!)).toEqual(photo.buffer);
    await closeDetails(page);
    const forged = await page.request.post(`${server.origin}${apiPath}`, { headers: { origin: server.origin, "content-type": "image/png", "x-media-filename": "forged.png" }, data: Buffer.from("<html>This is not a PNG photo.</html>") });
    expect(forged.status(), await forged.text()).toBe(400);
    expect(await forged.text()).toContain("file contents do not match");
    expect((await (await page.request.get(`${server.origin}${apiPath}`)).json()).usage).toEqual(body.usage);
    expect((await page.request.delete(`${server.origin}${apiPath}/${savedPhoto.id}`, { headers: { origin: "https://untrusted.example" } })).status()).toBe(403);
    for (const path of [apiPath, savedPhoto.url, savedVideo.url]) expect((await request.get(`${server.origin}${path}`)).status()).toBe(401);
    expect((await request.delete(`${server.origin}${apiPath}/${savedPhoto.id}`, { headers: { origin: server.origin } })).status()).toBe(401);
    expect((await request.get(`${server.origin}${apiPath}`, { headers: { cookie: `__Host-ripota-session=${server.accountOnlySessionToken}` } })).status()).toBe(401);

    const otherPage = await otherContext.newPage();
    await signInActivator(otherPage, server.origin, "N1OTH");
    const shared = await (await otherPage.request.get(`${server.origin}${apiPath}`)).json() as { media: ActivatorMedia[]; usage: { files: number; bytes: number } };
    expect(shared.media).toHaveLength(2);
    expect(shared.media.every((file) => file.canEdit === false)).toBe(true);
    expect(shared.usage).toEqual({ files: 0, bytes: 0 });
    expect(await (await otherPage.request.get(`${server.origin}${savedPhoto.url}`)).body()).toEqual(photo.buffer);
    expect((await otherPage.request.delete(`${server.origin}${apiPath}/${savedVideo.id}`, { headers: { origin: server.origin } })).status()).toBe(404);
    expect((await otherPage.request.patch(`${server.origin}${apiPath}/${savedPhoto.id}`, { headers: { origin: server.origin }, data: { parkReference: "US-2869" } })).status()).toBe(404);
    await otherPage.goto(`${server.origin}${pagePath}`);
    const readOnly = await openDetails(otherPage, savedPhoto.id);
    await expect(readOnly).toContainText(description);
    await expect(readOnly.getByRole("button", { name: "Save details", exact: true })).toBeHidden();
    await expect(readOnly.getByRole("button", { name: "Delete media", exact: true })).toBeHidden();
    await expect(readOnly.getByLabel("Title (optional)", { exact: true })).toBeHidden();
    await expect(readOnly.locator("[data-media-download]")).toBeVisible();
    await closeDetails(otherPage);

    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${server.origin}/activate-ri-2026/admin/#media`);
    await expect(adminPage.getByRole("tab", { name: "Photos & Videos", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(adminPage.locator("[data-media-gallery] article")).toHaveCount(2);
    await expect(adminPage.locator("[data-media-input]")).toHaveCount(0);
    await editDetails(page, savedPhoto.id, { parkReference: "US-2869" });
    await page.reload();
    await expect(photoTile.locator("[data-media-park-badge]")).toHaveText("US-2869");
    await editDetails(page, savedPhoto.id, { parkReference: "" });
    await expect(photoTile.locator("[data-media-park-badge]")).toBeHidden();
    await editDetails(adminPage, savedVideo.id, { parkReference: "US-2868", title: "Portable station setup", description: "A short look at the activator's station." });
    await page.reload();
    await expect(videoTile.locator("[data-media-title]")).toHaveText("Portable station setup");
    expect(await (await page.request.get(videoUrl)).body()).toEqual(video.buffer);
    await page.setViewportSize({ width: 390, height: 844 });
    await openDetails(page, savedVideo.id);
    expect(await details.locator("[data-media-details-preview] video").evaluate((node: HTMLVideoElement) => {
      const bounds = node.getBoundingClientRect();
      const parent = node.parentElement!.getBoundingClientRect();
      return bounds.left >= parent.left - 1 && bounds.right <= parent.right + 1;
    })).toBe(true);
    await closeDetails(page);
    await openDetails(page, savedPhoto.id);
    await details.getByRole("button", { name: "Delete media", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this media?" });
    await expect(confirm.getByRole("button", { name: "Keep file", exact: true })).toBeFocused();
    await confirm.getByRole("button", { name: "Keep file", exact: true }).click();
    await expect(details).toBeVisible();
    await expect(details.getByRole("button", { name: "Delete media", exact: true })).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("position", "fixed");
    await details.getByRole("button", { name: "Delete media", exact: true }).click();
    await confirm.getByRole("button", { name: "Delete file", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(details).toBeHidden();
    await expect(gallery.locator("article")).toHaveCount(1);
    expect((await page.request.get(`${server.origin}${savedPhoto.url}`)).status()).toBe(404);
    const adminDetails = await openDetails(adminPage, savedVideo.id);
    await adminDetails.getByRole("button", { name: "Delete media", exact: true }).click();
    await adminPage.getByRole("dialog", { name: "Delete this media?" }).getByRole("button", { name: "Delete file", exact: true }).click();
    await page.reload();
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
    await expect(page.getByRole("button", { name: "Refresh files", exact: true })).toBeEnabled();
    const upload = await openUpload(page);
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
    const retryParks: Array<string | undefined> = [];
    await page.route(`**${apiPath}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (route.request().headers()["x-media-filename"] === "cancel.png") {
        cancelStarted();
        await cancelledRequest;
        await route.abort("aborted");
        return;
      }
      attempts++;
      retryParks.push(route.request().headers()["x-media-park-reference"]);
      if (attempts === 1) await route.fulfill({ status: 503, json: { error: "Storage is temporarily unavailable. Please retry." } });
      else await route.continue();
    });
    await page.getByLabel("Park (optional)", { exact: true }).selectOption("US-2868");
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles(photo);
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    const retryRow = page.locator("[data-media-queue] li").filter({ hasText: photo.name });
    await expect(retryRow).toHaveAttribute("data-state", "error");
    await expect(retryRow).toContainText("Storage is temporarily unavailable");
    await expect(page.getByLabel(`Park for ${photo.name}`, { exact: true })).toHaveValue("US-2868");
    await expect(page.locator("[data-media-gallery] article")).toHaveCount(0);
    await page.getByRole("button", { name: `Retry upload of ${photo.name}`, exact: true }).click();
    await expect(upload).toBeHidden();
    await expect(page.locator("[data-media-gallery] article")).toHaveCount(1);
    expect(attempts).toBe(2);
    expect(retryParks).toEqual(["US-2868", "US-2868"]);

    await openUpload(page);
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles({ ...photo, name: "cancel.png" });
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    await cancelRequestStarted;
    await expect(upload.getByRole("button", { name: "Close upload", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(upload).toBeVisible();
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
  let releaseFirst!: () => void;
  const firstUpload = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstStarted!: () => void;
  const firstUploadStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
  try {
    const photo = await makePhoto(page, "batch.png");
    const selection = Array.from({ length: 12 }, (_, index) => ({
      ...photo, name: `activation-${String(index + 1).padStart(2, "0")}.png`,
    }));
    const saved: ActivatorMedia[] = [];
    const attempted: string[] = [];
    let galleryReads = 0;
    const waitMessage = "Please wait a minute before uploading more files.";
    await signInActivator(page, server.origin, "N1BAT");
    await page.route(new RegExp(`${apiPath}(?:\\?.*)?$`), async (route) => {
      if (route.request().method() === "GET") {
        galleryReads++;
        await route.fulfill({ json: {
          ok: true, media: saved, usage: { files: saved.length, bytes: saved.length * photo.buffer.length },
        } });
        return;
      }
      const filename = decodeURIComponent(route.request().headers()["x-media-filename"]);
      attempted.push(filename);
      if (attempted.length === 1) {
        firstStarted();
        await firstUpload;
      }
      if (attempted.length === 11) {
        await route.fulfill({ status: 429, headers: { "retry-after": "60" }, json: { ok: false, error: waitMessage } });
        return;
      }
      const id = `00000000-0000-4000-8000-${String(saved.length + 1).padStart(12, "0")}`;
      const media: ActivatorMedia = {
        id, filename, contentType: "image/png", kind: "photo", size: photo.buffer.length, parkReference: null,
        title: null, description: null, canEdit: true, authorLabel: "N1BAT - Synthetic",
        createdAt: "2026-09-11T12:00:00.000Z", callsign: "N1BAT", url: `${apiPath}/${id}/file`,
      };
      saved.push(media);
      await route.fulfill({ status: 201, json: { ok: true, media } });
    });
    await page.route(`**${apiPath}/*/file`, (route) => route.fulfill({ contentType: "image/png", body: photo.buffer }));
    await page.goto(`${server.origin}${pagePath}`);
    await expect(page.getByRole("button", { name: "Refresh files", exact: true })).toBeEnabled();
    const all = page.locator('[data-media-view="all"]');
    const mine = page.locator('[data-media-view="mine"]');
    await mine.click();
    await expect.poll(() => galleryReads).toBe(2);
    await page.getByRole("button", { name: "Refresh files", exact: true }).waitFor({ state: "visible" });
    await expect(page.getByRole("button", { name: "Refresh files", exact: true })).toBeEnabled();
    await all.click();
    await expect.poll(() => galleryReads).toBe(3);
    await expect(page.getByRole("button", { name: "Refresh files", exact: true })).toBeEnabled();
    const upload = await openUpload(page);
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles(selection);
    await page.getByRole("button", { name: "Upload 12 files", exact: true }).click();
    await firstUploadStarted;
    await expect(all).toBeDisabled();
    await expect(mine).toBeDisabled();
    await page.goBack();
    await expect(page).toHaveURL(`${server.origin}${pagePath}?mediaScope=mine`);
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(galleryReads).toBe(3);
    releaseFirst();
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
    await expect(upload).toBeHidden();
    await expect(page.locator("[data-media-gallery] article")).toHaveCount(12);
    expect(attempted).toEqual([...selection.slice(0, 11).map((file) => file.name), "activation-11.png", "activation-12.png"]);
  } finally {
    releaseFirst();
    await page.unrouteAll({ behavior: "wait" });
    await server.stop();
  }
});

test("shared gallery scopes survive links and history and discard superseded results", async ({ page, browser }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  const friendContext = await browser.newContext();
  let releaseStale!: () => void;
  const staleRequest = new Promise<void>((resolve) => { releaseStale = resolve; });
  let staleStarted!: () => void;
  const staleRequestStarted = new Promise<void>((resolve) => { staleStarted = resolve; });
  let staleFinished!: () => void;
  const staleRequestFinished = new Promise<void>((resolve) => { staleFinished = resolve; });
  try {
    const photo = await makePhoto(page, "My morning activation.png");
    await signInActivator(page, server.origin, "N1SCP");
    const ownUpload = await page.request.post(`${server.origin}${apiPath}`, {
      headers: { origin: server.origin, "content-type": photo.mimeType, "x-media-filename": encodeURIComponent(photo.name) },
      data: photo.buffer,
    });
    expect(ownUpload.status(), await ownUpload.text()).toBe(201);
    const ownId = (await ownUpload.json() as { media: ActivatorMedia }).media.id;
    const friendPage = await friendContext.newPage();
    await signInActivator(friendPage, server.origin, "N1PAL");
    const friendUpload = await friendPage.request.post(`${server.origin}${apiPath}`, {
      headers: { origin: server.origin, "content-type": photo.mimeType, "x-media-filename": "Another%20activator.png" },
      data: photo.buffer,
    });
    expect(friendUpload.status(), await friendUpload.text()).toBe(201);
    const friendId = (await friendUpload.json() as { media: ActivatorMedia }).media.id;
    const allUrl = `${server.origin}${pagePath}?source=field-notes#photos`;
    const mineUrl = `${server.origin}${pagePath}?source=field-notes&mediaScope=mine#photos`;
    await page.goto(allUrl);
    const scope = page.getByRole("group", { name: "Media shown", exact: true });
    const all = scope.getByRole("button", { name: "All media", exact: true });
    const mine = scope.getByRole("button", { name: "My media", exact: true });
    const gallery = page.locator("[data-media-gallery]");
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("article")).toHaveCount(2);
    await expect(gallery.locator(`[data-media-id="${ownId}"]`)).toContainText("N1SCP");
    await expect(gallery.locator(`[data-media-id="${friendId}"]`)).toContainText("N1PAL");
    const ownDetails = await openDetails(page, ownId);
    await expect(ownDetails.getByRole("button", { name: "Save details", exact: true })).toBeVisible();
    await closeDetails(page);
    const otherDetails = await openDetails(page, friendId);
    await expect(otherDetails.getByRole("button", { name: "Delete media", exact: true })).toBeHidden();
    await closeDetails(page);
    expect((await (await page.request.get(`${server.origin}${apiPath}`)).json()).usage.files).toBe(1);
    await gallery.locator("img").first().scrollIntoViewIfNeeded();
    await expect.poll(() => gallery.locator("img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth === 32))).toBe(true);

    await mine.click();
    await expect(page).toHaveURL(mineUrl);
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("article")).toHaveCount(1);
    await expect(gallery.locator(`[data-media-id="${ownId}"]`)).toBeVisible();
    await page.reload();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("article")).toHaveCount(1);
    await page.getByRole("button", { name: "Refresh files", exact: true }).click();
    await expect(page).toHaveURL(mineUrl);
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("article")).toHaveCount(1);
    const freshContext = await browser.newContext({ storageState: await page.context().storageState() });
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto(mineUrl);
      await expect(freshPage.getByRole("group", { name: "Media shown", exact: true }).getByRole("button", { name: "My media", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(freshPage.locator("[data-media-gallery] article")).toHaveCount(1);
      await expect(freshPage.locator(`[data-media-id="${ownId}"]`)).toBeVisible();
    } finally {
      await freshContext.close();
    }
    await page.goBack();
    await expect(page).toHaveURL(allUrl);
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("article")).toHaveCount(2);
    await page.goForward();
    await expect(page).toHaveURL(mineUrl);
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("article")).toHaveCount(1);
    await all.click();
    await expect(page).toHaveURL(allUrl);
    await expect(gallery.locator("article")).toHaveCount(2);
    for (const invalid of ["unknown", "all"]) {
      await page.goto(`${server.origin}${pagePath}?source=field-notes&mediaScope=${invalid}#photos`);
      await expect(page).toHaveURL(allUrl);
      await expect(all).toHaveAttribute("aria-pressed", "true");
      await expect(gallery.locator("article")).toHaveCount(2);
    }

    const mineBody = await (await page.request.get(`${server.origin}${apiPath}?scope=mine`)).json();
    let delayed = false;
    await page.route(new RegExp(`${apiPath}(?:\\?.*)?$`), async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET" && url.searchParams.get("scope") === "mine" && !delayed) {
        delayed = true;
        staleStarted();
        await staleRequest;
        try {
          await route.fulfill({ json: mineBody });
        } finally {
          staleFinished();
        }
        return;
      }
      await route.continue();
    });
    await mine.click();
    await staleRequestStarted;
    await expect(all).toBeEnabled();
    await all.click();
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("article")).toHaveCount(2);
    releaseStale();
    await staleRequestFinished;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page).toHaveURL(allUrl);
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(gallery.locator("article")).toHaveCount(2);
  } finally {
    releaseStale();
    await page.unrouteAll({ behavior: "wait" });
    await friendContext.close();
    await server.stop();
  }
});

test("pagination and uploads remain usable beyond fifty files and duplicate filenames stay distinct", async ({ page }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true });
  try {
    const scene = coastalPhoto("IMG_0001.jpg");
    const png = await makePhoto(page, "duplicate.png");
    const records: ActivatorMedia[] = Array.from({ length: 55 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      filename: scene.name, contentType: scene.mimeType, kind: "photo", size: scene.buffer.length,
      createdAt: "2026-09-11T12:00:00.000Z", callsign: index % 2 ? "N1SEA" : "N1CAP",
      authorLabel: index % 2 ? "N1SEA - Jordan" : "N1CAP - Casey",
      parkReference: index % 3 ? "US-2868" : null,
      title: ["A morning on the coast", "The view from our station", "Rhode Island from the field"][index % 3],
      description: "Shared from a Rhode Island activation. The original photo is available in the media viewer.",
      canEdit: index % 2 === 0,
      url: `${apiPath}/00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}/file`,
    }));
    const cursor = `${records[49].createdAt}|${records[49].id}`;
    const uploaded: ActivatorMedia[] = [];
    const receivedBodies: Buffer[] = [];
    await signInActivator(page, server.origin, "N1CAP");
    await page.route(new RegExp(`${apiPath}(?:\\?.*)?$`), async (route) => {
      if (route.request().method() === "POST") {
        receivedBodies.push(route.request().postDataBuffer()!);
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(201);
        uploaded.push((await response.json() as { media: ActivatorMedia }).media);
        await route.fulfill({ response });
        return;
      }
      const nextPage = new URL(route.request().url()).searchParams.get("cursor");
      if (nextPage) expect(nextPage).toBe(cursor);
      const allRecords = [...uploaded, ...records];
      await route.fulfill({ json: {
        ok: true, media: nextPage ? allRecords.slice(50) : allRecords.slice(0, 50),
        nextCursor: nextPage ? null : cursor,
        usage: { files: 75 + uploaded.length, bytes: 600 * 1024 * 1024 + uploaded.reduce((sum, file) => sum + file.size, 0) },
      } });
    });
    await page.route(`**${apiPath}/*/file`, (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-2);
      return records.some((file) => file.id === id)
        ? route.fulfill({ contentType: scene.mimeType, body: scene.buffer }) : route.continue();
    });
    await page.goto(`${server.origin}${pagePath}`);
    const gallery = page.locator("[data-media-gallery]");
    await expect(gallery.locator("article")).toHaveCount(50);
    await expect(gallery).not.toContainText(scene.name);
    await expect(gallery.locator("[data-media-author]").first()).toHaveText("N1CAP - Casey");
    for (const [layout, width, height] of [["desktop", 1280, 1000], ["mobile", 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      await expect.poll(() => gallery.locator("img").first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      mkdirSync(resolve("tmp/media-screenshots"), { recursive: true });
      await page.screenshot({ path: resolve(`tmp/media-screenshots/gallery-context-${layout}.png`), animations: "disabled" });
      await page.locator(".media-workspace__header").evaluate((header) => header.scrollIntoView({ block: "start", behavior: "instant" }));
      await page.screenshot({ path: resolve(`tmp/media-screenshots/gallery-${layout}.png`), animations: "disabled" });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Load more files", exact: true }).click();
    await expect(gallery.locator("article")).toHaveCount(55);
    expect(new Set(await gallery.locator("article").evaluateAll((tiles) => tiles.map((tile) => (tile as HTMLElement).dataset.mediaId))).size).toBe(55);
    await expect(page.getByRole("button", { name: "Load more files", exact: true })).toBeHidden();
    await openDetails(page, records[1].id);
    await captureMediaScreenshots(page, "gallery-read-only", "[data-media-details-dialog]");
    await closeDetails(page);
    const upload = await openUpload(page);
    await page.getByLabel("Choose photos and videos", { exact: true }).setInputFiles(Array.from({ length: 55 }, (_, index) => ({ ...png, name: `selection-${index}.png` })));
    await expect(page.locator('[data-media-queue] [data-state="ready"]')).toHaveCount(55);
    await expect(upload.getByRole("button", { name: "Upload 55 files", exact: true })).toBeEnabled();
    await expect(upload).not.toContainText(/500 MB|50-file|50 files/);
    await page.reload();
    await openUpload(page);
    const first = Buffer.concat([png.buffer, Buffer.from([0])]);
    const second = Buffer.concat([png.buffer, Buffer.from([1])]);
    await page.locator("[data-media-input]").evaluate((input: HTMLInputElement, buffers) => {
      const transfer = new DataTransfer();
      for (const bytes of buffers) transfer.items.add(new File([new Uint8Array(bytes)], "duplicate.png", { type: "image/png", lastModified: 1_700_000_000_000 }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, [[...first], [...second]]);
    await expect(page.locator('[data-media-queue] [data-state="ready"]')).toHaveCount(2);
    await upload.getByRole("button", { name: "Upload 2 files", exact: true }).click();
    await expect(upload).toBeHidden();
    expect(uploaded).toHaveLength(2);
    expect(uploaded[0].filename).toBe(uploaded[1].filename);
    expect(uploaded[0].id).not.toBe(uploaded[1].id);
    expect(receivedBodies).toEqual([first, second]);
    expect(await (await page.request.get(`${server.origin}${uploaded[0].url}`)).body()).toEqual(first);
    expect(await (await page.request.get(`${server.origin}${uploaded[1].url}`)).body()).toEqual(second);
  } finally {
    await server.stop();
  }
});

async function captureMediaScreenshots(page: Page, name: string, selector: string): Promise<void> {
  const directory = resolve("tmp/media-screenshots");
  mkdirSync(directory, { recursive: true });
  for (const [layout, width] of [["desktop", 1280], ["mobile", 390]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(selector).screenshot({ path: resolve(directory, `${name}-${layout}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function openUpload(page: Page) {
  const dialog = page.locator("[data-media-upload-dialog]");
  if (!await dialog.isVisible()) await page.getByRole("button", { name: "Upload photos & videos", exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openDetails(page: Page, id: string) {
  const dialog = page.locator("[data-media-details-dialog]");
  if (await dialog.isVisible()) await closeDetails(page);
  await page.locator(`[data-media-id="${id}"] [data-media-open-detail]`).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-media-id", id);
  return dialog;
}

async function closeDetails(page: Page): Promise<void> {
  const dialog = page.locator("[data-media-details-dialog]");
  await dialog.getByRole("button", { name: "Close details", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function editDetails(page: Page, id: string, values: { parkReference?: string; title?: string; description?: string }): Promise<void> {
  const dialog = await openDetails(page, id);
  if (values.parkReference !== undefined) await dialog.getByLabel("Park for this file", { exact: true }).selectOption(values.parkReference);
  if (values.title !== undefined) await dialog.getByLabel("Title (optional)", { exact: true }).fill(values.title);
  if (values.description !== undefined) await dialog.getByLabel("Description (optional)", { exact: true }).fill(values.description);
  await dialog.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function renderFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

function coastalPhoto(name: string) {
  return { name, mimeType: "image/jpeg", buffer: readFileSync(resolve("public/assets/rhode-island-coast-hero.jpg")) };
}

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
