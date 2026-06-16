import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";
import references from "../../src/data/ri-references.json" with { type: "json" };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = resolve(root, "public/data/activate-ri-2026");
const publicStopRowsPath = resolve(
  root,
  "tmp/activate-ri-2026/public-stop-rows.json",
);

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  root,
  server: { middlewareMode: true },
});

const { activateRi2026Event } = await server.ssrLoadModule(
  "/src/data/activate-ri-2026/event.ts",
);
const { deriveParkCoverage } = await server.ssrLoadModule(
  "/src/lib/activate-ri/coverage.ts",
);
const { routeRowsToPublicStops } = await server.ssrLoadModule(
  "/src/lib/activate-ri/public-export.ts",
);

const parks = references.map((reference) => ({
  reference: reference.reference,
  name: reference.name,
  latitude: reference.latitude,
  longitude: reference.longitude,
  grid: reference.grid,
  potaUrl: reference.potaUrl,
}));

const publicStopRows = await readPublicStopRows(publicStopRowsPath);
const publicActivationStops = routeRowsToPublicStops(publicStopRows);
const coverage = deriveParkCoverage(parks, publicActivationStops);

try {
  await mkdir(outputDir, { recursive: true });
  await writeJson("event.json", activateRi2026Event);
  await writeJson("parks.json", parks);
  await writeJson("schedule.json", publicActivationStops);
  await writeJson("coverage.json", coverage);
} finally {
  await server.close();
}

console.log(`Wrote Activate RI public data to ${outputDir}`);

async function writeJson(filename, value) {
  await writeFile(
    resolve(outputDir, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function readPublicStopRows(filename) {
  let contents;

  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  try {
    const parsed = JSON.parse(contents);
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (isRecord(parsed) && Array.isArray(parsed.rows)) {
      return parsed.rows;
    }

    throw new Error("expected a JSON array or an object with a rows array");
  } catch (error) {
    throw new Error(`Failed to parse ${filename}: ${error.message}`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
