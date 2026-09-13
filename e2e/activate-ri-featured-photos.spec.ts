import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ActivatorMedia } from "../src/lib/activate-ri/media";
import { startActivateRiServer, type ActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(90_000);

const ownerApi = "/api/activate-ri-2026/activator/media";
const adminApi = "/api/activate-ri-2026/admin/media";
const publicApi = "/api/activate-ri-2026/public/media";
const adminPagePath = "/activate-ri-2026/admin/";
const publicPagePath = "/activate-ri-2026/media/";
const adminHeaders = { "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org" };
const photo = readFileSync(resolve("public/assets/rhode-island-coast-hero.jpg"));
type FeaturedMedia = ActivatorMedia & { featuredOnRecap: boolean };

test("organizers feature a photo, keep its details, and unfeature it from the filtered gallery", async ({ page, browser, request }, testInfo) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true, adminHeaderAuthOnly: true });
  const organizers = await browser.newContext({ extraHTTPHeaders: adminHeaders });
  try {
    await signInActivator(page, server, "N1FEA");
    const saved = await uploadPhoto(page, server, "Featured coast.jpg");
    const organizer = await organizers.newPage();
    await organizer.goto(`${server.origin}${adminPagePath}#media`);
    const details = await openDetails(organizer, saved.id);
    const feature = details.getByRole("checkbox", { name: "Feature on recap", exact: true });
    await expect(feature).not.toBeChecked();
    await details.getByLabel("Title (optional)", { exact: true }).fill("The view from our station");
    await feature.check();
    await expect.poll(() => details.locator("[data-media-details-preview] img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await details.screenshot({ path: testInfo.outputPath("featured-photo-details.png") });
    await organizer.setViewportSize({ width: 390, height: 844 });
    await feature.scrollIntoViewIfNeeded();
    await expect(feature).toBeVisible();
    await expect(details.getByRole("button", { name: "Save details", exact: true })).toBeInViewport();
    expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await organizer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await details.screenshot({ path: testInfo.outputPath("featured-photo-details-mobile.png") });
    await organizer.setViewportSize({ width: 1280, height: 720 });
    await details.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(details).toBeHidden();
    const tile = organizer.locator(`[data-media-gallery] [data-media-id="${saved.id}"]`);
    await expect(tile.locator("[data-media-featured-badge]")).toHaveText("Featured");
    await organizer.reload();
    await expect(tile.locator("[data-media-featured-badge]")).toBeVisible();
    await openDetails(organizer, saved.id);
    await expect(feature).toBeChecked();
    await expect(details.getByLabel("Title (optional)", { exact: true })).toHaveValue("The view from our station");
    await details.getByRole("button", { name: "Close details", exact: true }).click();

    const curated = await (await request.get(`${server.origin}${publicApi}?featured=1&kind=photo`)).json() as { media: FeaturedMedia[] };
    expect(curated.media.map(file => file.id)).toEqual([saved.id]);
    expect(curated.media[0].featuredOnRecap).toBe(true);
    expect(curated.media[0].canEdit).toBe(false);
    expect(curated.media[0].editUrl).toBeNull();

    const onlyFeatured = organizer.getByRole("checkbox", { name: "Featured only", exact: true });
    await onlyFeatured.check();
    await expect(tile).toBeVisible();
    await expect(tile.locator("[data-media-featured-badge]")).toBeVisible();
    await tile.scrollIntoViewIfNeeded();
    await expect.poll(() => tile.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await organizer.locator("[data-media-workspace]").screenshot({ path: testInfo.outputPath("featured-photo-gallery.png") });
    await openDetails(organizer, saved.id);
    await feature.uncheck();
    await details.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(details).toBeHidden();
    await expect(organizer.locator("[data-media-gallery] article")).toHaveCount(0);
    await expect(onlyFeatured).toBeFocused();
    await organizer.reload();
    await expect(onlyFeatured).toBeChecked();
    await expect(organizer.locator("[data-media-gallery] article")).toHaveCount(0);
    expect((await (await request.get(`${server.origin}${publicApi}?featured=1&kind=photo`)).json()).media).toEqual([]);
    await onlyFeatured.uncheck();
    await expect(tile).toBeVisible();
    await expect(tile.locator("[data-media-featured-badge]")).toBeHidden();
    await openDetails(organizer, saved.id);
    await expect(feature).not.toBeChecked();
    await expect(details.getByLabel("Title (optional)", { exact: true })).toHaveValue("The view from our station");
  } finally {
    await organizers.close();
    await server.stop();
  }
});

test("the organizer featured filter survives reload, history, refresh, and clear without losing unrelated URL state", async ({ page, browser }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true, adminHeaderAuthOnly: true });
  const organizers = await browser.newContext({ extraHTTPHeaders: adminHeaders });
  try {
    await signInActivator(page, server, "N1FIL");
    const featured = await uploadPhoto(page, server, "Featured park.jpg");
    const other = await uploadPhoto(page, server, "Another park.jpg");
    const selected = await page.request.patch(`${server.origin}${adminApi}/${featured.id}`, {
      headers: { ...adminHeaders, origin: server.origin }, data: { featuredOnRecap: true },
    });
    expect(selected.status(), await selected.text()).toBe(200);
    const curated = await (await page.request.get(`${server.origin}${publicApi}?featured=1&kind=photo`)).json() as { media: FeaturedMedia[] };
    expect(curated.media.map(file => file.id)).toEqual([featured.id]);
    const organizer = await organizers.newPage();
    const baseUrl = `${server.origin}${adminPagePath}?source=club&source=email#media`;
    await organizer.goto(baseUrl);
    const onlyFeatured = organizer.getByRole("checkbox", { name: "Featured only", exact: true });
    const tiles = organizer.locator("[data-media-gallery] article");
    await expect(tiles).toHaveCount(2);
    const filteredRequest = organizer.waitForRequest(req => {
      const url = new URL(req.url());
      return url.pathname === adminApi && url.searchParams.get("featured") === "1";
    });
    await onlyFeatured.check();
    await filteredRequest;
    await expect(tiles).toHaveCount(1);
    await expect(tiles).toHaveAttribute("data-media-id", featured.id);
    const filteredUrl = organizer.url();
    expect(new URL(filteredUrl).searchParams.get("mediaFeatured")).toBe("1");
    expect(new URL(filteredUrl).searchParams.getAll("source")).toEqual(["club", "email"]);
    expect(new URL(filteredUrl).hash).toBe("#media");
    await organizer.reload();
    await expect(onlyFeatured).toBeChecked();
    await expect(tiles).toHaveCount(1);
    await organizer.getByRole("button", { name: "Refresh files", exact: true }).click();
    await expect(tiles).toHaveCount(1);
    await expect(organizer).toHaveURL(filteredUrl);
    await organizer.goBack();
    await expect(organizer).toHaveURL(baseUrl);
    await expect(onlyFeatured).not.toBeChecked();
    await expect(tiles).toHaveCount(2);
    await organizer.goForward();
    await expect(organizer).toHaveURL(filteredUrl);
    await expect(onlyFeatured).toBeChecked();
    await expect(tiles).toHaveCount(1);
    await organizer.locator("[data-media-filter-clear]").click();
    await expect(organizer).toHaveURL(baseUrl);
    await expect(onlyFeatured).not.toBeChecked();
    await expect(tiles).toHaveCount(2);
    await expect(organizer.locator(`[data-media-gallery] [data-media-id="${other.id}"]`)).toBeVisible();
  } finally {
    await organizers.close();
    await server.stop();
  }
});

test("activators and public visitors cannot feature photos or see organizer controls", async ({ page, browser, request }) => {
  const server = await startActivateRiServer({ legacyLinkIssuanceEnabled: true, adminHeaderAuthOnly: true });
  const visitors = await browser.newContext();
  try {
    await signInActivator(page, server, "N1OWN");
    const saved = await uploadPhoto(page, server, "Owner photo.jpg");
    await page.goto(`${server.origin}/activate-ri-2026/activator/media/`);
    const ownerDetails = await openDetails(page, saved.id);
    await expect(ownerDetails.getByRole("button", { name: "Save details", exact: true })).toBeVisible();
    await expect(ownerDetails.getByRole("checkbox", { name: "Feature on recap", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Featured only", exact: true })).toHaveCount(0);
    const tampered = await page.request.patch(`${server.origin}${ownerApi}/${saved.id}`, {
      headers: { origin: server.origin }, data: { featuredOnRecap: true, title: "Unauthorized feature edit" },
    });
    expect(tampered.status(), await tampered.text()).toBe(403);
    const adminAttempt = await page.request.patch(`${server.origin}${adminApi}/${saved.id}`, {
      headers: { origin: server.origin }, data: { featuredOnRecap: true },
    });
    expect(adminAttempt.status(), await adminAttempt.text()).toBe(401);
    const after = await (await page.request.get(`${server.origin}${ownerApi}/${saved.id}`)).json() as { media: FeaturedMedia };
    expect(after.media.featuredOnRecap).toBe(false);
    expect(after.media.title).toBeNull();

    const visitor = await visitors.newPage();
    await visitor.goto(`${server.origin}${publicPagePath}`);
    const publicDetails = await openDetails(visitor, saved.id);
    await expect(publicDetails.getByRole("checkbox", { name: "Feature on recap", exact: true })).toHaveCount(0);
    await expect(visitor.getByRole("checkbox", { name: "Featured only", exact: true })).toHaveCount(0);
    await expect(publicDetails.getByRole("button", { name: "Save details", exact: true })).toBeHidden();
    expect((await (await request.get(`${server.origin}${publicApi}?featured=1`)).json()).media).toEqual([]);
  } finally {
    await visitors.close();
    await server.stop();
  }
});

test("the recap loads all curated pages and can include an older contributor", async ({ page }) => {
  const server = await startActivateRiServer({ adminHeaderAuthOnly: true });
  try {
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    const records: FeaturedMedia[] = Array.from({ length: 51 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      return {
        id, contentType: "image/jpeg", kind: "photo", size: photo.length,
        createdAt: index === 50 ? "2026-09-11T12:00:00.000Z" : "2026-09-12T12:00:00.000Z",
        callsign: index === 50 ? "N1OLD" : "N1NEW", authorLabel: index === 50 ? "N1OLD — Earlier contributor" : "N1NEW — Recent contributor",
        parkReference: "US-2868", title: `Featured view ${index + 1}`, description: null,
        featuredOnRecap: true, canEdit: false, isOwn: false, editUrl: null,
        thumbnailUrl: `${publicApi}/${id}/thumbnail`, url: `${publicApi}/${id}/file`,
      };
    });
    const cursor = `${records[49].createdAt}|${records[49].id}`;
    const requests: Array<{ kind: string | null; featured: string | null; cursor: string | null }> = [];
    let emptyCurated = false;
    await page.route(new RegExp(`${publicApi}(?:\\?.*)?$`), async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("summary")) return route.fulfill({ json: { ok: true, parks: [] } });
      requests.push({ kind: url.searchParams.get("kind"), featured: url.searchParams.get("featured"), cursor: url.searchParams.get("cursor") });
      if (emptyCurated) return route.fulfill({ json: { ok: true, media: [], nextCursor: null } });
      await route.fulfill({ json: { ok: true, media: url.searchParams.has("cursor") ? records.slice(50) : records.slice(0, 50), nextCursor: url.searchParams.has("cursor") ? null : cursor } });
    });
    await page.route(`**${publicApi}/*/thumbnail`, route => route.fulfill({ contentType: "image/jpeg", body: photo }));
    await page.goto(`${server.origin}/activate-ri-2026/`);
    const preview = page.locator("[data-recap-photo-grid]");
    await expect(preview.locator("figure")).toHaveCount(3);
    await expect(preview).toContainText("Earlier contributor");
    await expect(preview.getByRole("link", { name: /Featured view 51/ })).toHaveAttribute("href", `${publicPagePath}?mediaId=${records[50].id}`);
    expect(requests).toEqual([
      { kind: "photo", featured: "1", cursor: null },
      { kind: "photo", featured: "1", cursor },
    ]);
    const selectedLinks = await preview.locator("figure > a").evaluateAll(links => links.map(link => link.getAttribute("href")));
    expect(selectedLinks.every(href => records.some(file => href === `${publicPagePath}?mediaId=${file.id}`))).toBe(true);
    emptyCurated = true;
    requests.length = 0;
    await page.reload();
    await expect(page.locator("[data-recap-photo-status]")).toBeVisible();
    await expect(preview.locator("figure")).toHaveCount(0);
    await expect.poll(() => requests).toEqual([{ kind: "photo", featured: "1", cursor: null }]);
  } finally {
    await server.stop();
  }
});

async function signInActivator(page: Page, server: ActivateRiServer, callsign: string): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
  const response = await page.request.post(`${server.origin}/api/activate-ri-2026/plans`, {
    headers: { origin: server.origin },
    data: {
      submitterCallsign: callsign, submitterName: "Synthetic Photo Activator", submitterEmail: `${callsign.toLowerCase()}@example.com`,
      stops: [{ parkReference: "US-2868", plannedDate: "2026-09-11", timeBlock: "09:00-12:00", bands: ["40m"], modes: ["SSB"] }],
    },
  });
  expect(response.status(), await response.text()).toBe(202);
  let { editUrl } = await response.json() as { editUrl?: string };
  if (!editUrl) {
    const email = await server.waitForEmailText("Your Activate All RI 2026 edit link");
    editUrl = email.match(/https?:\/\/[^\s]+\/activate-ri-2026\/access\/#[^\s]+/)?.[0];
  }
  expect(editUrl).toBeTruthy();
  await page.goto(editUrl!);
  await expect(page.locator('[name="submitterCallsign"]')).toHaveValue(callsign);
}

async function uploadPhoto(page: Page, server: ActivateRiServer, filename: string): Promise<FeaturedMedia> {
  const response = await page.request.post(`${server.origin}${ownerApi}`, {
    headers: { origin: server.origin, "content-type": "image/jpeg", "x-media-filename": encodeURIComponent(filename), "x-media-park-reference": "US-2868" },
    data: photo,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { media: FeaturedMedia }).media;
}

async function openDetails(page: Page, id: string) {
  await page.locator(`[data-media-gallery] [data-media-id="${id}"] [data-media-open-detail]`).click();
  const details = page.locator("[data-media-details-dialog]");
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute("data-media-id", id);
  return details;
}
