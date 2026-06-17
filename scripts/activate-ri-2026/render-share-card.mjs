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

const dataInputs = {
  event: ["src/data/activate-ri-2026/event.ts"],
  parks: ["public/data/activate-ri-2026/parks.json"],
};
const templateInputs = [
  "scripts/activate-ri-2026/render-share-card.mjs",
  "src/pages/activate-ri-2026/index.astro",
  "src/components/activate-ri/EventHero.astro",
  "src/components/ReferenceMap.astro",
  "src/styles/global.css",
  "src/lib/reference-map.ts",
  "src/lib/activate-ri/coverage.ts",
  "src/lib/activate-ri/public-stops-client.ts",
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

  const stops = await readStopsInput();
  const inputs = {
    event: await hashFiles(dataInputs.event),
    parks: await hashFiles(dataInputs.parks),
    stops: hashStableJson(stops.data),
    template: await hashFiles(templateInputs),
  };
  const fingerprint = hashStableJson(inputs);
  const existingMetadata = await readExistingMetadata();

  if (!force && existingMetadata?.fingerprint === fingerprint) {
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
      viewport: { width: outputWidth, height: outputHeight },
    });

    if (stops.source === "remote") {
      await context.route("**/api/activate-ri-2026/public/stops", async (route) => {
        await route.fulfill({
          body: JSON.stringify({ ok: true, stops: stops.data }),
          contentType: "application/json; charset=utf-8",
          status: 200,
        });
      });
    }

    const page = await context.newPage();
    await page.goto(`${server.origin}/activate-ri-2026/`, {
      waitUntil: "domcontentloaded",
    });
    await page.addStyleTag({ content: shareCardCss() });
    await waitForShareCardReady(page);

    const hero = page.locator(captureSelector);
    await mkdir(new URL("public/assets/", root), { recursive: true });
    const tempOutputPath = `${outputPath.pathname}.tmp.png`;
    await hero.screenshot({
      animations: "disabled",
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
      stopsSource: stops.source,
      stopsUrl: stops.url,
    });
    console.log("Regenerated public/assets/activate-ri-2026-share-card.png");
  } finally {
    await browser?.close();
    await server.stop();
  }
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

function hashStableJson(value) {
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
      env: process.env,
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

async function waitForShareCardReady(page) {
  await page.locator(captureSelector).waitFor({ state: "visible", timeout: 20_000 });
  await page.locator(".event-hero__map .leaflet-container").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.waitForFunction(() => {
    const scheduled = document.querySelector("[data-hero-scheduled]")?.textContent?.trim();
    const gaps = document.querySelector("[data-hero-gaps]")?.textContent?.trim();
    return Boolean(scheduled && gaps && scheduled !== "Loading..." && gaps !== "Loading...");
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
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
    .skip-link {
      display: none !important;
    }

    ${captureSelector} {
      box-sizing: border-box !important;
      width: ${outputWidth}px !important;
      height: ${outputHeight}px !important;
      padding: 46px 0 !important;
    }

    ${captureSelector} .container {
      width: 1092px !important;
    }

    .event-hero__inner {
      height: 100% !important;
      grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.08fr) !important;
      gap: 42px !important;
    }

    .event-hero h1 {
      font-size: 86px !important;
    }

    .event-hero__copy {
      font-size: 20px !important;
    }

    .event-hero__map .map-preview,
    .event-hero__map .ri-reference-map {
      height: 488px !important;
      min-height: 488px !important;
    }
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
