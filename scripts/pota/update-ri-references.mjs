#!/usr/bin/env -S node --experimental-strip-types

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { normalizePotaReferences } from "../../src/lib/pota/references.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = path.join(root, "src/data/ri-references.json");

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "ripota.org POTA reference cache",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }

  return response.json();
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmpPath, filePath);
}

export async function updateRiReferences() {
  const parks = await fetchJson("https://api.pota.app/location/parks/US-RI");
  const references = normalizePotaReferences(parks);

  await writeJson(outputPath, references);
  console.log(`Wrote ${references.length} references to ${path.relative(root, outputPath)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await updateRiReferences();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
