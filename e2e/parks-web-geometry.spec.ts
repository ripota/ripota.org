import { expect, test as base, type Page, type Request, type TestInfo } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

const test = base.extend<{}, { parksOrigin: string }>({
  parksOrigin: [async ({}, use) => {
    if (process.env.RIPOTA_PARKS_BASE_URL) {
      await use(process.env.RIPOTA_PARKS_BASE_URL.replace(/\/$/, ""));
      return;
    }
    const server = await startActivateRiServer();
    try {
      await use(server.origin);
    } finally {
      await server.stop();
    }
  }, { scope: "worker" }],
});

test.setTimeout(60_000);
const syntheticAnalyticsRequests = new WeakSet<Request>();

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-05T12:00:00Z") });
  // Keep synthetic review interactions out of production analytics.
  await page.route("**/api/analytics/events", async (route) => {
    syntheticAnalyticsRequests.add(route.request());
    expect(route.request().postData() ?? "").not.toMatch(/latitude|longitude|coordinates|email|phone|token/i);
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
});

const parks = [
  { reference: "US-2870", name: "Brenton Point State Park", components: 3, holes: 0 },
  { reference: "US-6979", name: "Arcadia Management Area", components: 25, holes: 12 },
  { reference: "US-6992", name: "JL Curran State Park", components: 4, holes: 0 },
  { reference: "US-0513", name: "Block Island National Wildlife Refuge", components: 5, holes: 0 },
  { reference: "US-4582", name: "Washington-Rochambeau Revolutionary Route National Historic Trail", components: 1, holes: 0 },
];

const canonicalPath = /\/data\/parks\/3\.1\.1\/(?:boundaries\/us-\d+|all)\.geojson$/;
const brentonPoint = { latitude: 41.452, longitude: -71.3542, accuracy: 5 };

function observeBrowser(page: Page) {
  const errors: string[] = [];
  const canonicalRequests: string[] = [];
  const expectedFailures = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const location = message.location().url;
    // Turnstile's iframe emits this exact zero-size console message in production.
    if (location.startsWith("https://challenges.cloudflare.com/") &&
      message.text() === "%c%d font-size:0;color:transparent NaN") return;
    if (message.type() === "error" && !expectedFailures.has(location)) {
      errors.push(`Console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (canonicalPath.test(new URL(request.url()).pathname)) canonicalRequests.push(request.url());
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    // Cloudflare's unload beacon can be canceled when its document navigates.
    if (request.failure()?.errorText === "net::ERR_ABORTED" && request.method() === "POST" &&
      url.origin === new URL(page.url()).origin && url.pathname === "/cdn-cgi/rum") return;
    // These subdomain DNS probes are documented as non-fatal challenge checks:
    // https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/
    if (request.failure()?.errorText === "net::ERR_NAME_NOT_RESOLVED" &&
      url.hostname.endsWith(".challenges.cloudflare.com") &&
      url.pathname.startsWith("/cdn-cgi/challenge-platform/")) return;
    // Leaflet cancels obsolete tiles while zooming or leaving a page.
    if (request.failure()?.errorText === "net::ERR_ABORTED" && request.resourceType() === "image" &&
      url.origin === "https://tile.openstreetmap.org" && /^\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) return;
    // Navigation can cancel the initiating document's fulfilled analytics stub.
    if (request.failure()?.errorText === "net::ERR_ABORTED" && syntheticAnalyticsRequests.has(request)) return;
    if (!expectedFailures.has(request.url())) errors.push(`Network: ${request.url()} ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    // Unsupported Private Access Tokens return 401 before the normal challenge.
    if (response.status() === 401 && url.hostname === "challenges.cloudflare.com" &&
      /^\/cdn-cgi\/challenge-platform\/[^/]+\/[^/]+\/pat\//.test(url.pathname)) return;
    if (response.status() >= 400 && !expectedFailures.has(response.url())) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  return { errors, canonicalRequests, expectedFailures };
}

async function readyMap(page: Page, selector: string) {
  await expect(page.locator(`${selector}:visible .leaflet-overlay-pane svg path`).first()).toBeVisible();
  await expect(page.locator(`${selector}:visible .leaflet-tile-loaded`).first()).toBeVisible();
  await expect.poll(() => page.locator(`${selector}:visible .leaflet-tile-loaded`).evaluateAll((tiles) =>
    tiles.some((tile) => Number(getComputedStyle(tile).opacity) >= 0.99),
  )).toBe(true);
  await page.waitForLoadState("networkidle");
}

async function attachMap(page: Page, testInfo: TestInfo, name: string, selector: string) {
  // Location mode schedules its fit after layout, then Leaflet animates the camera.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(page.locator(`${selector} .leaflet-zoom-anim, ${selector} .leaflet-pan-anim`)).toHaveCount(0);
  await expect(page.locator(`${selector} .leaflet-tile:not(.leaflet-tile-loaded)`)).toHaveCount(0);
  const path = testInfo.outputPath(`${name}.png`);
  await page.locator(selector).screenshot({ path });
  await testInfo.attach(name, {
    path,
    contentType: "image/png",
  });
}

async function detailPayload(page: Page) {
  return page.locator("[data-park-detail-map]").evaluate((map) => {
    const dataId = (map as HTMLElement).dataset.mapDataId;
    return JSON.parse(document.getElementById(dataId ?? "")?.textContent ?? "null");
  });
}

async function referencePayload(page: Page) {
  return page.locator("[data-reference-map]:visible").evaluate((map) =>
    JSON.parse(document.getElementById((map as HTMLElement).dataset.mapDataId ?? "")?.textContent ?? "null"),
  );
}

const syntheticStops = [{
  id: "parks-browser-synthetic-stop",
  parkReference: "US-0513",
  plannedDate: "2026-09-12",
  startTime: "13:00",
  endTime: "15:00",
  activatorCallsign: "W1AW",
  bands: ["20m"],
  modes: ["SSB"],
  publicNotes: "Synthetic public browser fixture",
  status: "scheduled",
}];

async function primaryShape(page: Page) {
  return page.locator('[data-park-detail-map] path[stroke="#6f4618"]').evaluateAll((paths) =>
    paths.map((path) => ({
      d: path.getAttribute("d"),
      fillRule: path.getAttribute("fill-rule"),
      rings: (path.getAttribute("d")?.match(/M/g) ?? []).length,
    })),
  );
}

async function embeddedGeometryCollections(page: Page) {
  return page.locator('script[type="application/json"]').evaluateAll((scripts) => {
    function count(value: unknown): number {
      if (!value || typeof value !== "object") return 0;
      const object = value as Record<string, unknown>;
      return (object.type === "FeatureCollection" ? 1 : 0) +
        Object.values(object).reduce<number>((sum, child) => sum + count(child), 0);
    }
    return scripts.reduce((sum, script) => sum + count(JSON.parse(script.textContent ?? "null")), 0);
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const park of parks) {
      test(`${park.reference} preserves web parcels, holes, bounds, and official links`, async ({ page, parksOrigin }, testInfo) => {
        const browser = observeBrowser(page);
        await page.goto(`${parksOrigin}/parks/${park.reference.toLowerCase()}/`);
        await readyMap(page, "[data-park-detail-map]");
        await expect(page.getByRole("heading", { level: 1, name: park.name })).toBeVisible();
        await expect(page.getByRole("link", { name: "Official POTA page ↗" })).toHaveAttribute("href", `https://pota.app/#/park/${park.reference}`);
        await expect(page.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
        await expect(page.getByRole("link", { name: "Open map source ↗" })).toHaveAttribute("href", /^https:\/\//);
        await expect(page.locator("body")).toContainText("not an official Parks on the Air property");

        const payload = await detailPayload(page);
        expect(payload.park.canonicalGeometryUrl).toBe(`/data/parks/3.1.1/boundaries/${park.reference.toLowerCase()}.geojson`);
        expect(JSON.stringify(payload)).not.toContain('"fidelity":"detailed"');
        expect(JSON.stringify(payload)).toContain('"fidelity":"web"');
        expect(await embeddedGeometryCollections(page)).toBe(1);
        expect(browser.canonicalRequests).toEqual([]);
        if (park.reference === "US-4582") {
          expect(payload.park).toMatchObject({
            latitude: 41.312,
            longitude: -73.9709,
            displayPoint: { latitude: 41.7445710002769, longitude: -71.594458000176 },
            geometryKind: "activation-zone",
          });
        }

        await page.getByRole("button", { name: "Recenter map", exact: true }).click();
        const fitted = await primaryShape(page);
        expect(fitted.reduce((sum, shape) => sum + shape.rings, 0)).toBe(park.components + park.holes);
        expect(fitted.every((shape) => shape.fillRule === "evenodd")).toBe(true);
        if (viewport.name === "mobile" && park.reference === "US-0513") {
          // Check the actual five disconnected parcel footprints against the key overlay.
          const hiddenParcels = await page.locator('[data-park-detail-map] path[stroke="#6f4618"]').evaluate((path) => {
            const key = document.querySelector(".park-detail-map__key")!.getBoundingClientRect();
            const matrix = (path as SVGGraphicsElement).getScreenCTM()!;
            return (path.getAttribute("d") ?? "").split("M").filter(Boolean).filter((ring) => {
              const coordinates = (ring.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
              const points = [];
              for (let index = 0; index < coordinates.length; index += 2) {
                points.push(new DOMPoint(coordinates[index], coordinates[index + 1]).matrixTransform(matrix));
              }
              const left = Math.min(...points.map((point) => point.x));
              const right = Math.max(...points.map((point) => point.x));
              const top = Math.min(...points.map((point) => point.y));
              const bottom = Math.max(...points.map((point) => point.y));
              return left < key.right && right > key.left && top < key.bottom && bottom > key.top;
            }).length;
          });
          expect(hiddenParcels).toBe(0);
        }
        await attachMap(page, testInfo, `${park.reference}-${viewport.name}`, "[data-park-detail-map-shell]");
        await page.getByRole("button", { name: "Zoom in on the mapped area" }).click();
        await expect.poll(() => primaryShape(page)).not.toEqual(fitted);
        await page.getByRole("button", { name: "Recenter map", exact: true }).click();
        await expect.poll(() => primaryShape(page)).toEqual(fitted);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.waitForLoadState("networkidle");
        expect(browser.errors).toEqual([]);
        expect(browser.canonicalRequests).toEqual([]);
      });
    }

    test("related overlap toggles preserve the primary area", async ({ page, parksOrigin }) => {
      const browser = observeBrowser(page);
      await page.goto(`${parksOrigin}/parks/us-2878/`);
      await readyMap(page, "[data-park-detail-map]");
      const toggle = page.locator('[data-related-boundary-toggle="US-5483"]');
      const related = page.locator('[data-park-detail-map] path[stroke="#0b6670"]');
      await expect(toggle).toBeChecked();
      await expect(related).toHaveCount(1);
      const primary = await primaryShape(page);
      await toggle.uncheck();
      await expect(related).toHaveCount(0);
      expect(await primaryShape(page)).toEqual(primary);
      await toggle.check();
      await expect(related).toHaveCount(1);
      expect(await primaryShape(page)).toEqual(primary);
      expect(browser.canonicalRequests).toEqual([]);
      expect(browser.errors).toEqual([]);
    });

    test("location waits for canonical geometry, classifies, exits, and ignores late loads", async ({ page, context, parksOrigin }) => {
      const browser = observeBrowser(page);
      await context.grantPermissions(["geolocation"], { origin: parksOrigin });
      await context.setGeolocation(brentonPoint);
      const canonicalUrl = `${parksOrigin}/data/parks/3.1.1/boundaries/us-2870.geojson`;
      const releases: Array<() => void> = [];
      await page.route(canonicalUrl, async (route) => {
        await new Promise<void>((resolve) => { releases.push(resolve); });
        await route.continue();
      });
      await page.goto(`${parksOrigin}/parks/us-2870/`);
      await readyMap(page, "[data-park-detail-map]");
      expect(browser.canonicalRequests).toEqual([]);
      const status = page.locator("[data-park-location-status]");
      await page.getByRole("button", { name: "Show my location", exact: true }).click();
      await expect(status).toContainText("Loading mapped boundaries");
      await expect(status).toHaveAttribute("data-tone", "neutral");
      await expect(status).not.toContainText(/Inside|Outside|Near mapped/);
      expect(browser.canonicalRequests).toEqual([canonicalUrl]);
      await expect.poll(() => releases.length).toBe(1);
      const canonicalResponse = page.waitForResponse(canonicalUrl);
      releases.shift()?.();
      await expect(status).toContainText("Inside mapped boundary");
      expect((await canonicalResponse).headers()["content-type"]).toContain("application/geo+json");
      expect((await canonicalResponse).headers()["cache-control"]).toContain("max-age=31536000");
      expect((await canonicalResponse).headers()["cache-control"]).toContain("immutable");
      await expect(status).toHaveAttribute("data-tone", "inside");
      await page.getByRole("button", { name: "Exit location mode" }).click();
      await expect(status).toBeHidden();
      await expect(page.locator("[data-park-map-location]")).toHaveAttribute("aria-pressed", "false");

      await page.reload();
      await readyMap(page, "[data-park-detail-map]");
      await page.getByRole("button", { name: "Show my location", exact: true }).click();
      await expect(status).toContainText("Loading mapped boundaries");
      await page.getByRole("button", { name: "Exit location mode" }).click();
      await expect.poll(() => releases.length).toBe(1);
      releases.shift()?.();
      await page.waitForLoadState("networkidle");
      await expect(status).toBeHidden();
      await expect(page.locator("[data-park-detail-map-shell]")).not.toHaveAttribute("data-location-mode", "active");
      expect(browser.errors).toEqual([]);
    });

    test("canonical download failures make no location claim and can be retried", async ({ page, context, parksOrigin }) => {
      const browser = observeBrowser(page);
      await context.grantPermissions(["geolocation"], { origin: parksOrigin });
      await context.setGeolocation(brentonPoint);
      const canonicalUrl = `${parksOrigin}/data/parks/3.1.1/boundaries/us-2870.geojson`;
      browser.expectedFailures.add(canonicalUrl);
      await page.route(canonicalUrl, (route) => route.fulfill({ status: 503, body: "Synthetic geometry outage" }));
      await page.goto(`${parksOrigin}/parks/us-2870/`);
      await readyMap(page, "[data-park-detail-map]");
      await page.getByRole("button", { name: "Show my location", exact: true }).click();
      const status = page.locator("[data-park-location-status]");
      await expect(status).toContainText("Mapped boundaries could not load");
      await expect(status).toHaveAttribute("data-tone", "neutral");
      await expect(status).not.toContainText(/Inside|Outside|Near mapped/);
      await page.unroute(canonicalUrl);
      await page.route(canonicalUrl, (route) => route.fulfill({
        contentType: "application/geo+json",
        body: JSON.stringify({ type: "FeatureCollection", features: [] }),
      }));
      const incompleteResponse = page.waitForResponse(canonicalUrl);
      await page.getByRole("button", { name: "Recenter on my location", exact: true }).click();
      await incompleteResponse;
      await expect(status).toContainText("Mapped boundaries could not load");
      await expect(status).toHaveAttribute("data-tone", "neutral");
      expect(browser.canonicalRequests).toHaveLength(2);
      await page.unroute(canonicalUrl);
      await page.getByRole("button", { name: "Recenter on my location", exact: true }).click();
      await expect(status).toContainText("Inside mapped boundary");
      expect(browser.canonicalRequests).toHaveLength(3);
      await page.getByRole("button", { name: "Exit location mode" }).click();
      await expect(status).toBeHidden();
      expect(browser.errors).toEqual([]);
    });

    test("directory filters and location return preserve the map state", async ({ page, context, parksOrigin }, testInfo) => {
      const browser = observeBrowser(page);
      await context.grantPermissions(["geolocation"], { origin: parksOrigin });
      await context.setGeolocation(brentonPoint);
      await page.goto(`${parksOrigin}/parks/`);
      await readyMap(page, "[data-reference-map]");
      await expect(page.getByRole("heading", { level: 1, name: "Rhode Island park field guides" })).toBeVisible();
      await expect(page.locator(".leaflet-control-attribution").getByRole("link", { name: "map sources", exact: true })).toHaveAttribute("href", /\/DATA_SOURCES\.md$/);
      await expect(page.locator(".leaflet-control-attribution").getByRole("link", { name: "data license", exact: true })).toHaveAttribute("href", /\/DATA_LICENSE\.md$/);
      await expect(page.locator("[data-park-row]")).toHaveCount(61);
      await page.getByLabel("Search parks", { exact: true }).fill("US-2870");
      await expect(page.locator("[data-park-row]:visible")).toHaveCount(1);
      await expect(page.locator("[data-park-directory-count]")).toHaveText("Showing 1 of 61 parks");
      await page.getByLabel("Search parks", { exact: true }).fill("");
      await page.getByLabel("Possible 2-fers", { exact: true }).check();
      await expect(page.locator("[data-park-row]:visible")).toHaveCount(2);
      await page.getByLabel("Possible 2-fers", { exact: true }).uncheck();
      expect(browser.canonicalRequests).toEqual([]);
      await attachMap(page, testInfo, `directory-${viewport.name}`, ".parks-directory-hero");
      await page.locator("[data-reference-map-location]").click();
      const results = page.locator("[data-reference-location-results]");
      await expect(page.locator('[data-reference-location-section="inside"]')).toContainText("US-2870");
      await attachMap(page, testInfo, `directory-location-${viewport.name}`, ".parks-directory-hero");
      expect(browser.canonicalRequests).toContain(`${parksOrigin}/data/parks/3.1.1/all.geojson`);
      const result = results.locator('a[href^="/parks/us-2870/"]');
      await result.click();
      await expect(page).toHaveURL(/\/parks\/us-2870\/\?location=1&from=parks-map$/);
      await expect(page.locator("[data-park-location-status]")).toContainText("Inside mapped boundary");
      await page.getByRole("link", { name: "← Back to all parks" }).click();
      await expect(page).toHaveURL(/\/parks\/$/);
      await expect(page.locator(".parks-directory-hero")).toHaveAttribute("data-location-mode", "active");
      await expect(page.locator('[data-reference-location-section="inside"]')).toContainText("US-2870");
      expect(await page.evaluate(() => Boolean(window.history.state?.ripotaParksMapReturn?.camera))).toBe(true);
      await page.locator("[data-reference-location-stop]").click();
      await expect(results).toBeHidden();
      expect(await page.evaluate(() => window.history.state?.ripotaParksMapReturn)).toBeUndefined();
      await page.waitForLoadState("networkidle");
      expect(browser.errors).toEqual([]);
    });

    test("directory location never uses web geometry while canonical data is loading or unavailable", async ({ page, context, parksOrigin }) => {
      const browser = observeBrowser(page);
      await context.grantPermissions(["geolocation"], { origin: parksOrigin });
      await context.setGeolocation(brentonPoint);
      const canonicalUrl = `${parksOrigin}/data/parks/3.1.1/all.geojson`;
      browser.expectedFailures.add(canonicalUrl);
      const releases: Array<() => void> = [];
      await page.route(canonicalUrl, async (route) => {
        await new Promise<void>((resolve) => { releases.push(resolve); });
        await route.fulfill({ status: 503, body: "Synthetic geometry outage" });
      });
      await page.goto(`${parksOrigin}/parks/`);
      await readyMap(page, "[data-reference-map]");
      expect(browser.canonicalRequests).toEqual([]);
      await page.locator("[data-reference-map-location]").click();
      const results = page.locator("[data-reference-location-results]");
      await expect(results).toContainText("Loading mapped boundaries");
      await expect(results).toHaveAttribute("data-tone", "neutral");
      await expect(results.locator("[data-reference-location-reference]")).toHaveCount(0);
      await expect.poll(() => releases.length).toBe(1);
      releases.shift()?.();
      await expect(results).toContainText("Mapped boundaries could not load");
      await expect(results).toHaveAttribute("data-tone", "neutral");
      await expect(results.locator("[data-reference-location-reference]")).toHaveCount(0);
      await page.unroute(canonicalUrl);
      await page.locator("[data-reference-map-location]").click();
      await expect(page.locator('[data-reference-location-section="inside"]')).toContainText("US-2870");
      await page.locator("[data-reference-location-stop]").click();
      await expect(results).toBeHidden();
      expect(browser.errors).toEqual([]);
    });

    test("denied device location keeps map controls usable without fetching canonical geometry", async ({ page, parksOrigin }) => {
      const browser = observeBrowser(page);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "geolocation", {
          configurable: true,
          value: {
            watchPosition(_success: PositionCallback, error: PositionErrorCallback) {
              queueMicrotask(() => error({
                code: 1, message: "Synthetic permission denial",
                PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
              }));
              return 1;
            },
            clearWatch() {},
          },
        });
      });
      await page.goto(`${parksOrigin}/parks/us-2870/`);
      await readyMap(page, "[data-park-detail-map]");
      await page.getByRole("button", { name: "Show my location", exact: true }).click();
      await expect(page.locator("[data-park-location-status]")).toContainText("Location access is off");
      await expect(page.locator("[data-park-location-status]")).not.toContainText(/Inside|Outside|Near mapped/);
      await page.getByRole("button", { name: "Zoom in on the mapped area" }).click();
      await page.getByRole("button", { name: "Exit location mode" }).click();
      await expect(page.locator("[data-park-location-status]")).toBeHidden();
      await page.getByRole("button", { name: "Recenter map", exact: true }).click();
      expect(browser.canonicalRequests).toEqual([]);
      expect(browser.errors).toEqual([]);
    });

    test("public Activate RI routes retain event navigation and notices", async ({ page, parksOrigin }) => {
      const browser = observeBrowser(page);
      for (const route of [
        { path: "", heading: "Activate All RI", nav: "Overview" },
        { path: "help/", heading: "Activate All RI FAQ", nav: "FAQ" },
        { path: "parks/", heading: "Coverage by park", nav: "Parks" },
        { path: "schedule/", heading: "Event schedule", nav: "Schedule" },
        { path: "hunter/", heading: "Your Rhode Island park checklist", nav: "Hunter" },
      ]) {
        await page.goto(`${parksOrigin}/activate-ri-2026/${route.path}`);
        await page.waitForLoadState("networkidle");
        await expect(page.getByRole("heading", { level: 1, name: route.heading, exact: true })).toBeVisible();
        const nav = page.getByRole("navigation", { name: "Activate All RI navigation" });
        await expect(nav.getByRole("link", { name: route.nav, exact: true })).toHaveAttribute("aria-current", "page");
        await expect(page.locator("body")).toContainText("not an official Parks on the Air property");
        await expect(page.locator('a[href^="https://pota.app/"]').first()).toHaveAttribute("href", /^https:\/\/pota\.app\//);
        await page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("link", { name: "Activate All RI", exact: true }).click();
        await expect(page).toHaveURL(`${parksOrigin}/activate-ri-2026/`);
        await page.waitForLoadState("networkidle");
      }
      await page.waitForLoadState("networkidle");
      expect(browser.canonicalRequests).toEqual([]);
      expect(browser.errors).toEqual([]);
    });

    test("event maps and coverage retain lightweight filters and primary volunteer actions", async ({ page, parksOrigin }) => {
      const browser = observeBrowser(page);
      await page.route("**/api/activate-ri-2026/public/stops", (route) => route.fulfill({
        contentType: "application/json", body: JSON.stringify({ ok: true, stops: syntheticStops }),
      }));
      await page.goto(`${parksOrigin}/activate-ri-2026/`);
      await readyMap(page, "[data-reference-map]");
      await expect(page.locator('[aria-label="Event actions"] a[data-variant="primary"]:visible')).toHaveText("Volunteer to activate");
      await expect(page.locator("[data-hero-scheduled]:visible")).toHaveText("1 / 61");
      const payload = await referencePayload(page);
      expect(payload.items).toHaveLength(61);
      expect(payload.items.every((item: { geojson: unknown }) => item.geojson === null)).toBe(true);
      expect(payload.canonicalGeometryUrl).toBeUndefined();
      expect(await embeddedGeometryCollections(page)).toBe(0);
      const markerIndex = payload.items.findIndex((item: { reference: string }) => item.reference === "US-2870");
      await page.locator("[data-reference-map]:visible .reference-map-marker").nth(markerIndex).click();
      const popup = page.locator(".leaflet-popup-content");
      await expect(popup).toContainText("US-2870");
      await expect(popup).toContainText("Needs coverage");
      await popup.getByRole("link", { name: "Volunteer for this park" }).click();
      await expect(page).toHaveURL(`${parksOrigin}/activate-ri-2026/volunteer/?park=US-2870`);
      await expect(page.getByRole("heading", { level: 1, name: "Volunteer to activate" })).toBeVisible();
      await readyMap(page, "[data-reference-map]");
      await page.locator("[data-map-coverage-filter]").check();
      await expect(page.locator("[data-reference-map] .reference-map-marker")).toHaveCount(60);
      await page.locator("[data-map-coverage-filter]").uncheck();
      await expect(page.locator("[data-reference-map] .reference-map-marker")).toHaveCount(61);

      await page.goto(`${parksOrigin}/activate-ri-2026/parks/`);
      await expect(page.locator('[data-filter-row][data-needs-coverage="false"]')).toHaveCount(1);
      await page.getByLabel("Only parks needing coverage", { exact: true }).check();
      await expect(page.locator("[data-filter-row]:visible")).toHaveCount(60);
      const row = page.locator("[data-filter-row]").filter({ hasText: "US-2870" });
      const volunteer = row.getByRole("link", { name: "Volunteer", exact: true });
      await expect(volunteer).toHaveAttribute("data-variant", "primary");
      await expect(volunteer).toHaveAttribute("href", "/activate-ri-2026/volunteer/?park=US-2870");
      await page.waitForLoadState("networkidle");
      expect(browser.canonicalRequests).toEqual([]);
      expect(browser.errors).toEqual([]);
    });

    test("unavailable event API uses the checked-in fallback and then visible unavailable copy", async ({ page, parksOrigin }) => {
      const browser = observeBrowser(page);
      const liveUrl = `${parksOrigin}/api/activate-ri-2026/public/stops`;
      const fallbackUrl = `${parksOrigin}/data/activate-ri-2026/stops.json`;
      browser.expectedFailures.add(liveUrl);
      await page.route(liveUrl, (route) => route.fulfill({ status: 503, body: "Synthetic public API outage" }));
      const fallbackResponse = page.waitForResponse(fallbackUrl);
      await page.goto(`${parksOrigin}/activate-ri-2026/parks/`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("[data-live-coverage] [data-filter-row]")).toHaveCount(61);
      await expect(page.locator("[data-live-coverage]")).not.toContainText("unavailable");
      expect((await fallbackResponse).ok()).toBe(true);
      expect(await (await fallbackResponse).json()).toMatchObject({ ok: true, stops: expect.any(Array) });
      browser.expectedFailures.add(fallbackUrl);
      await page.route(fallbackUrl, (route) => route.fulfill({ status: 503, body: "Synthetic fallback outage" }));
      await page.reload();
      await expect(page.locator("[data-live-coverage]")).toContainText("Live coverage is unavailable");
      expect(browser.canonicalRequests).toEqual([]);
      expect(browser.errors).toEqual([]);
    });

    test("live event view retains textual official POTA evidence without geometry", async ({ page, parksOrigin }) => {
      const browser = observeBrowser(page);
      await page.clock.setSystemTime(new Date("2026-09-12T18:00:00Z"));
      const evidence = { qsoDate: "2026-09-12", activeCallsign: "W1AW", totalQsos: 12, qsosCw: 0, qsosData: 0, qsosPhone: 12 };
      await page.route("**/api/activate-ri-2026/public/park-status", (route) => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true, generatedAt: "2026-09-12T18:00:00Z", lastPotaSyncAt: "2026-09-12T17:59:00Z",
          lastSpotIngestAt: null, stale: false, warning: null,
          eventWindow: { startDate: "2026-09-11", endDate: "2026-09-13", timezone: "UTC" },
          summary: { total: 61, confirmed: 1, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 60, withoutConfirmation: 60 },
          parks: [{
            reference: "US-2870", name: "Brenton Point State Park", potaUrl: "https://pota.app/#/park/US-2870",
            status: "confirmed", live: false, scheduled: false, observed: false, attemptRecorded: false,
            confirmation: evidence, confirmations: [evidence], attempts: [], lastObservation: null,
          }],
        }),
      }));
      await page.goto(`${parksOrigin}/activate-ri-2026/`);
      await expect(page.locator("[data-event-phase-views]")).toHaveAttribute("data-phase", "event-live");
      await readyMap(page, "[data-reference-map]");
      const payload = await referencePayload(page);
      expect(payload.resultsMode).toBe(true);
      expect(await embeddedGeometryCollections(page)).toBe(0);
      const markerIndex = payload.items.findIndex((item: { reference: string }) => item.reference === "US-2870");
      await page.locator("[data-reference-map]:visible .reference-map-marker").nth(markerIndex).click();
      const popup = page.locator(".leaflet-popup-content");
      await expect(popup).toContainText("POTA confirmed");
      await expect(popup).toContainText("12 QSOs");
      await expect(popup.getByRole("link", { name: "Open official POTA page" })).toHaveAttribute("href", "https://pota.app/#/park/US-2870");
      await expect(popup.getByRole("link", { name: "Open full evidence list" })).toHaveAttribute("href", "/activate-ri-2026/parks/");
      expect(browser.canonicalRequests).toEqual([]);
      expect(browser.errors).toEqual([]);
    });
  });
}
