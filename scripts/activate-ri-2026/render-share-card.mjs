#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import process from "node:process";

import { chromium } from "@playwright/test";

const root = new URL("../../", import.meta.url);
const outputPath = new URL("public/assets/activate-ri-2026-share-card.png", root);
const metadataPath = new URL("public/assets/activate-ri-2026-share-card.meta.json", root);
const localStopsPath = new URL("public/data/activate-ri-2026/stops.json", root);
const localEventPath = new URL("public/data/activate-ri-2026/event.json", root);
const localParksPath = new URL("public/data/activate-ri-2026/parks.json", root);
const outputWidth = 1200;
const outputHeight = 630;
const captureSelector = "[data-share-card-capture]";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const useLocalStops = args.has("--local-stops");
const defaultStopsUrl = "https://ripota.org/api/activate-ri-2026/public/stops";
const stopsUrl = useLocalStops
  ? ""
  : process.env.ACTIVATE_RI_SHARE_CARD_STOPS_URL?.trim() || defaultStopsUrl;
const requireRemoteStops = Boolean(stopsUrl && !useLocalStops);
const parkStatusUrl = process.env.ACTIVATE_RI_SHARE_CARD_PARK_STATUS_URL?.trim()
  || "https://ripota.org/api/activate-ri-2026/public/park-status";

const dataInputs = {
  event: ["src/data/activate-ri-2026/event.ts", "public/data/activate-ri-2026/event.json"],
  parks: ["public/data/activate-ri-2026/parks.json"],
};
const templateInputs = [
  "scripts/activate-ri-2026/render-share-card.mjs",
  "src/pages/activate-ri-2026/index.astro",
  "src/components/activate-ri/EventHero.astro",
  "src/components/activate-ri/EventHeroContent.astro",
  "src/components/activate-ri/EventPhaseViews.astro",
  "src/components/ReferenceMap.astro",
  "src/styles/global.css",
  "src/lib/reference-map.ts",
  "src/lib/activate-ri/coverage.ts",
  "src/lib/activate-ri/public-stops-client.ts",
  "src/lib/activate-ri/event-phase.ts",
  "src/lib/activate-ri/pota-status-client.ts",
  "src/lib/activate-ri/pota-status-store.ts",
  "src/lib/pota/live-spots-client.ts",
  "src/lib/pota/live-spots-store.ts",
  "src/lib/pota/spots.ts",
  "src/lib/pota/geometry-assets.ts",
  "package-lock.json",
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

async function main() {
  const allowedArgs = new Set(["--force", "--local-stops"]);
  const unknownArgs = [...args].filter((arg) => !allowedArgs.has(arg));
  if (unknownArgs.length > 0) {
    throw new Error("Usage: render-share-card.mjs [--force] [--local-stops]");
  }

  const capturedAt = new Date();
  const event = JSON.parse(await readFile(localEventPath, "utf8"));
  const parks = JSON.parse(await readFile(localParksPath, "utf8"));
  const phase = shareCardPhaseAt(event, capturedAt);
  const results = phase === "event-live" || phase === "post-event";
  const status = results ? normalizeParkStatusResponse(
    await fetchJson(parkStatusUrl), parks.map((park) => park.reference),
  ) : null;
  const stops = results ? null : await readStopsInput();
  const inputs = {
    phase,
    event: await hashFiles(dataInputs.event),
    parks: await hashFiles(dataInputs.parks),
    ...(status ? { status: hashStableJson(shareCardStatusInput(status)) } : { stops: hashStableJson(stops.data) }),
    template: await hashFiles(templateInputs),
  };
  const fingerprint = hashStableJson(inputs);
  const existingMetadata = await readExistingMetadata();

  if (!force && existsSync(outputPath) && existingMetadata?.fingerprint === fingerprint) {
    console.log("Activate RI share card inputs unchanged; skipping render.");
    return;
  }

  run("npm", ["run", "build:local"]);
  const server = await startPreviewServer();
  let browser;

  try {
    browser = await chromium.launch(chromiumLaunchOptions());
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "light",
      locale: "en-US",
      viewport: { width: outputWidth, height: outputHeight },
    });

    // Both phase views exist in the page. Supply the captured data to every
    // poll so the counters and map cannot drift apart during rendering.
    await context.route("**/api/activate-ri-2026/public/stops", (route) =>
      route.fulfill({ json: { ok: true, stops: stops?.data ?? [] } }));
    await context.route("**/api/activate-ri-2026/public/park-status", (route) =>
      status ? route.fulfill({ json: status }) : route.abort());
    // Live marker state comes from park-status. Radio details are hover-only
    // and are not part of this static card.
    await context.route("**/api/pota/spots", (route) => route.abort());

    const page = await context.newPage();
    // Let time advance: Leaflet uses Date.now() to fade loaded tiles in.
    await page.clock.install({ time: capturedAt });
    await page.goto(`${server.origin}/activate-ri-2026/`, {
      waitUntil: "domcontentloaded",
    });
    await page.addStyleTag({ content: shareCardCss() });
    await waitForShareCardReady(page, phase, status);

    await mkdir(new URL("public/assets/", root), { recursive: true });
    const tempOutputPath = `${outputPath.pathname}.tmp.png`;
    await page.screenshot({
      animations: "disabled",
      clip: { x: 0, y: 0, width: outputWidth, height: outputHeight },
      path: tempOutputPath,
    });

    const dimensions = await readPngDimensions(tempOutputPath);
    if (dimensions.width !== outputWidth || dimensions.height !== outputHeight) {
      throw new Error(
        `Expected ${outputWidth}x${outputHeight} PNG, got ${dimensions.width}x${dimensions.height}.`,
      );
    }

    await rename(tempOutputPath, outputPath);
    await writeMetadata({
      fingerprint,
      generatedAt: new Date().toISOString(),
      inputs,
      ...(status ? { parkStatusUrl, snapshotGeneratedAt: status.generatedAt }
        : { stopsSource: stops.source, stopsUrl: stops.url }),
    });
    console.log("Regenerated public/assets/activate-ri-2026-share-card.png");
  } finally {
    await browser?.close();
    await server.stop();
  }
}

export function shareCardPhaseAt(event, now = new Date()) {
  if (now.valueOf() >= Date.parse(`${event.mainEndDate}T00:00:00Z`) + 86_400_000) return "post-event";
  if (now.valueOf() >= Date.parse(`${event.softStartDate}T00:00:00Z`)) return "event-live";
  return event.phase;
}

export function shareCardStatusInput(snapshot) {
  return {
    total: snapshot.summary.total,
    activated: snapshot.summary.confirmed + snapshot.summary.observedNotConfirmed,
    live: snapshot.parks.filter((park) => park.live).length,
    warning: snapshot.warning,
    parks: snapshot.parks.map(({ reference, status, live }) => ({
      reference,
      status: status === "confirmed" || status === "observed" ? "activated" : status,
      live,
    })).sort((left, right) => left.reference.localeCompare(right.reference)),
  };
}

export function normalizeParkStatusResponse(data, parkReferences) {
  const fail = () => { throw new Error("Public park-status response was unavailable, incomplete, or inconsistent."); };
  if (!data || data.ok !== true || !Number.isFinite(Date.parse(data.generatedAt)) ||
      typeof data.stale !== "boolean" || !(data.warning === null || typeof data.warning === "string") ||
      !data.summary || !Array.isArray(data.parks) || data.parks.length !== parkReferences.length) fail();
  const expected = new Set(parkReferences);
  const counts = { confirmed: 0, observed: 0, scheduled: 0, needed: 0 };
  for (const park of data.parks) {
    if (!park || !expected.delete(park.reference) || !Object.hasOwn(counts, park.status) ||
        typeof park.live !== "boolean" || typeof park.name !== "string" ||
        typeof park.scheduled !== "boolean" || typeof park.observed !== "boolean" ||
        typeof park.attemptRecorded !== "boolean" || !Array.isArray(park.confirmations) ||
        !Array.isArray(park.attempts)) fail();
    counts[park.status]++;
  }
  const summary = data.summary;
  if (expected.size || !Object.values(summary).every((count) => Number.isInteger(count) && count >= 0) ||
      summary.total !== parkReferences.length || summary.confirmed !== counts.confirmed ||
      summary.observedNotConfirmed !== counts.observed || summary.scheduledNotConfirmed !== counts.scheduled ||
      summary.stillNeeded !== counts.needed || summary.withoutConfirmation !== summary.total - counts.confirmed) fail();
  return data;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Could not fetch share card data from ${url}: HTTP ${response.status}`);
  return response.json();
}

export function chromiumLaunchOptions(env = process.env) {
  const channel = env.PLAYWRIGHT_CHROMIUM_CHANNEL?.trim();

  if (!channel) {
    return {};
  }

  return { channel };
}

export function previewProcessOptions(platform = process.platform) {
  return {
    detached: platform !== "win32",
    shell: platform === "win32",
  };
}

async function readStopsInput() {
  if (stopsUrl) {
    try {
      const response = await fetch(stopsUrl, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return {
        data: normalizeStopsResponse(await response.json()),
        source: "remote",
        url: stopsUrl,
      };
    } catch (error) {
      if (requireRemoteStops) {
        throw new Error(`Could not fetch production stops from ${stopsUrl}: ${error}`);
      }
      console.warn(`Could not fetch stops from ${stopsUrl}; using local fallback.`);
    }
  }

  return {
    data: normalizeStopsResponse(JSON.parse(await readFile(localStopsPath, "utf8"))),
    source: "local",
    url: null,
  };
}

function normalizeStopsResponse(data) {
  if (!data || !Array.isArray(data.stops)) {
    throw new Error("Public stops response did not include a stops array.");
  }

  return data.stops;
}

async function readExistingMetadata() {
  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    return JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

async function writeMetadata(metadata) {
  const tempPath = `${metadataPath.pathname}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await rename(tempPath, metadataPath);
}

async function hashFiles(paths) {
  const contents = [];
  for (const path of paths) {
    contents.push([path, await readFile(new URL(path, root), "utf8")]);
  }

  return hashStableJson(contents);
}

export function hashStableJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function startPreviewServer() {
  const port = await freePort();
  const child = spawn(
    "npx",
    ["astro", "preview", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: root.pathname,
      env: { ...process.env, ASTRO_PREVIEW_BACKGROUND: "0" },
      ...previewProcessOptions(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const origin = `http://127.0.0.1:${port}`;

  try {
    await waitForPreview(child, origin);
  } catch (error) {
    signalProcess(child, "SIGTERM");
    throw error;
  }

  return {
    origin,
    async stop() {
      await stopProcess(child);
    },
  };
}

async function waitForPreview(child, origin) {
  const deadline = Date.now() + 30_000;
  let logs = "";
  child.stdout?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    logs += chunk.toString();
  });

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`astro preview exited early:\n${logs}`);
    }

    try {
      const response = await fetch(`${origin}/activate-ri-2026/`);
      if (response.ok) {
        return;
      }
    } catch {
      // Preview server is still starting.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for astro preview:\n${logs}`);
}

export async function waitForShareCardReady(page, phase, status) {
  const hero = page.locator(captureSelector).filter({ visible: true });
  await hero.waitFor({ state: "visible", timeout: 20_000 });
  await hero.locator(".event-hero__map .leaflet-container").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.waitForFunction(({ selector, phase, status }) => {
    const visibleHero = [...document.querySelectorAll(selector)].find(
      (element) => element.getClientRects().length > 0,
    );
    if (visibleHero?.closest("[data-event-phase-views]")?.getAttribute("data-phase") !== phase) return false;
    const state = visibleHero?.querySelector("[data-live-hero-coverage]")?.getAttribute("data-state");
    if (state === "unavailable") throw new Error("Share card event data is unavailable.");
    if (state !== "ready") return false;
    const scheduled = visibleHero.querySelector("[data-hero-scheduled]")?.textContent?.trim();
    const gaps = visibleHero?.querySelector("[data-hero-gaps]")?.textContent?.trim();
    if (!/^\d+ \/ \d+$/.test(scheduled ?? "") || !/^\d+$/.test(gaps ?? "")) return false;
    if (!status) return true;
    const progress = visibleHero.querySelector("[data-hero-pota-progress]");
    const activated = status.summary.confirmed + status.summary.observedNotConfirmed;
    return scheduled === `${activated} / ${status.summary.total}` &&
      gaps === String(status.parks.filter((park) => park.live).length) &&
      progress?.value === activated && progress?.max === status.summary.total &&
      visibleHero.querySelectorAll(".reference-map-status-symbol--activated").length === activated &&
      visibleHero.querySelectorAll(".reference-map-live-indicator--active").length === Number(gaps);
  }, { selector: captureSelector, phase, status }, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await hero.locator(".leaflet-tile").first().waitFor({ state: "visible" });
  await page.waitForFunction((selector) => {
    const hero = [...document.querySelectorAll(selector)].find((element) => element.getClientRects().length > 0);
    return [...hero.querySelectorAll(".leaflet-tile")].every((tile) =>
      tile.complete && tile.naturalWidth > 0 && Number(getComputedStyle(tile).opacity) >= 0.99);
  }, captureSelector, { timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await hero.locator(".event-hero__content").evaluate((content, height) => {
    if (content.getBoundingClientRect().bottom > height) throw new Error("Share card content is clipped.");
  }, outputHeight);
}

function shareCardCss() {
  return `
    html,
    body {
      width: ${outputWidth}px !important;
      min-width: ${outputWidth}px !important;
      margin: 0 !important;
      overflow: hidden !important;
      background: #0f4d49 !important;
    }

    .site-header,
    .skip-link,
    .event-overview-nav {
      display: none !important;
    }

    ${captureSelector} {
      position: fixed !important;
      inset: 0 auto auto 0 !important;
      margin: 0 !important;
      box-sizing: border-box !important;
      width: ${outputWidth}px !important;
      height: ${outputHeight}px !important;
      padding: 32px 0 !important;
    }

    ${captureSelector} .container {
      width: 1128px !important;
    }

    .event-hero__inner {
      height: 100% !important;
      grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.08fr) !important;
      gap: 36px !important;
    }

    .event-hero__content { gap: 14px !important; }
    .event-hero__date { font-size: 18px !important; }
    .event-hero h1 {
      font-size: 82px !important;
      line-height: 0.98 !important;
    }

    .event-hero__copy {
      font-size: 17px !important;
      line-height: 1.5 !important;
    }

    .event-hero__stats { margin: 0 !important; }
    .event-hero__stats div { padding: 12px !important; }
    .event-hero__stats dd { font-size: 34px !important; }
    .event-hero__progress { font-size: 14px !important; gap: 5px !important; }
    .event-hero__progress progress { height: 12px !important; }
    .event-hero .button-row { gap: 12px !important; }
    .event-hero .button { font-size: 14px !important; padding: 12px 14px !important; min-height: 0 !important; }

    .event-hero__map .map-preview,
    .event-hero__map .ri-reference-map {
      height: 550px !important;
      min-height: 550px !important;
    }
    .event-hero__map .map-preview { margin: 0 !important; }
    .leaflet-control-zoom { display: none !important; }
    .leaflet-control-attribution { font-size: 9px !important; }
    .map-legend { font-size: 12px !important; gap: 8px !important; }
  `;
}

async function readPngDimensions(path) {
  const file = await readFile(path);
  const pngSignature = "89504e470d0a1a0a";
  if (file.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`${path} is not a PNG file.`);
  }

  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
  };
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  await once(server, "close");

  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local port.");
  }

  return address.port;
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  let exited = false;
  const exitPromise = once(child, "exit").then(() => {
    exited = true;
  });

  signalProcess(child, "SIGTERM");
  await Promise.race([exitPromise, delay(3000)]);

  if (!exited) {
    signalProcess(child, "SIGKILL");
    await Promise.race([exitPromise, delay(1000)]);
  }
}

export function terminationSignalTarget(child, platform = process.platform) {
  if (platform === "win32" || typeof child.pid !== "number") {
    return child.pid;
  }

  return -child.pid;
}

function signalProcess(child, signal) {
  const target = terminationSignalTarget(child);

  try {
    if (typeof target === "number") {
      process.kill(target, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root.pathname,
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}.`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
