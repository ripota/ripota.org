import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";
import references from "../../src/data/ri-references.json" with { type: "json" };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = resolve(root, "public/data/activate-ri-2026");

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  root,
  server: { middlewareMode: true },
});

const { activateRi2026Event } = await server.ssrLoadModule(
  "/src/data/activate-ri-2026/event.ts",
);
const { sampleActivationStops } = await server.ssrLoadModule(
  "/src/data/activate-ri-2026/sample-stops.ts",
);
const { deriveParkCoverage } = await server.ssrLoadModule(
  "/src/lib/activate-ri/coverage.ts",
);

const parks = references.map((reference) => ({
  reference: reference.reference,
  name: reference.name,
  latitude: reference.latitude,
  longitude: reference.longitude,
  grid: reference.grid,
  potaUrl: reference.potaUrl,
}));

const coverage = deriveParkCoverage(parks, sampleActivationStops);

try {
  await mkdir(outputDir, { recursive: true });
  await writeJson("event.json", activateRi2026Event);
  await writeJson("parks.json", parks);
  await writeJson("schedule.json", sampleActivationStops);
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
