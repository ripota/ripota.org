import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
const { routeRowsToPublicStopsStrict } = await server.ssrLoadModule(
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

const publicStopExport = await readPublicStopRows(publicStopRowsPath);
const publicActivationStops = routeRowsToPublicStopsStrict(publicStopExport.rows);
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
  let fileStat;

  try {
    fileStat = await stat(filename);
    contents = await readFile(filename, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log(
        `No temp public stop export found at ${filename}; using default empty schedule.`,
      );
      return { rows: [] };
    }

    throw error;
  }

  try {
    const parsed = JSON.parse(contents);
    if (Array.isArray(parsed)) {
      logPublicStopRowsSource(filename, parsed, fileStat);
      return { rows: parsed };
    }

    if (isRecord(parsed) && Array.isArray(parsed.rows)) {
      const generatedAt =
        typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined;
      logPublicStopRowsSource(filename, parsed.rows, fileStat, generatedAt);
      return { rows: parsed.rows, generatedAt };
    }

    throw new Error("expected a JSON array or an object with a rows array");
  } catch (error) {
    throw new Error(`Failed to parse ${filename}: ${error.message}`);
  }
}

function logPublicStopRowsSource(filename, rows, fileStat, generatedAt) {
  const details = [
    `${rows.length} rows`,
    `mtime ${fileStat.mtime.toISOString()}`,
    `age ${formatAge(Date.now() - fileStat.mtimeMs)}`,
  ];

  if (generatedAt !== undefined) {
    details.push(`generatedAt ${generatedAt}`);
  }

  console.log(`Using temp public stop export ${filename} (${details.join(", ")}).`);
}

function formatAge(ageMs) {
  const totalSeconds = Math.max(0, Math.round(ageMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
