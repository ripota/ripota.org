#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const distDirectory = resolve("dist");
const volunteerHtmlPath = resolve(
  distDirectory,
  "activate-ri-2026/volunteer/index.html",
);
const baselineBrotliBytes = 584_894;
const maximumEntryBytes = 50_000;
const maximumEntryBrotliBytes = 20_000;
const minimumBrotliReductionBytes = 500_000;

const html = readFileSync(volunteerHtmlPath, "utf8");
const scriptPaths = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["']/g)]
  .map((match) => match[1])
  .filter((path) => path.startsWith("/"));
const volunteerEntryPaths = scriptPaths.filter((path) =>
  path.split("/").at(-1)?.startsWith("VolunteerForm.")
);

assert(
  volunteerEntryPaths.length === 1,
  `Expected one volunteer browser entry, found ${volunteerEntryPaths.length}.`,
);

const volunteerEntryPath = resolveDistAsset(volunteerEntryPaths[0]);
const graphPaths = collectStaticModuleGraph(volunteerEntryPath);
const entryBytes = statSync(volunteerEntryPath).size;
const entryBrotliBytes = brotliSize(readFileSync(volunteerEntryPath));
const graphBrotliBytes = graphPaths.reduce(
  (total, path) => total + brotliSize(readFileSync(path)),
  0,
);
const reductionBytes = baselineBrotliBytes - graphBrotliBytes;

assert(
  entryBytes < maximumEntryBytes,
  `Volunteer entry is ${entryBytes} B minified; expected less than ${maximumEntryBytes} B.`,
);
assert(
  entryBrotliBytes < maximumEntryBrotliBytes,
  `Volunteer entry is ${entryBrotliBytes} B Brotli; expected less than ${maximumEntryBrotliBytes} B.`,
);
assert(
  reductionBytes >= minimumBrotliReductionBytes,
  `Volunteer initial module graph reduces the ${baselineBrotliBytes} B baseline by only ${reductionBytes} B Brotli.`,
);

const forbiddenPayloads = [
  ["GeoJSON FeatureCollection", /FeatureCollection/],
  ["GeoJSON MultiPolygon", /MultiPolygon/],
  ["GeoJSON coordinates", /["']coordinates["']\s*:/],
  ["catalog source feature IDs", /["']featureIds["']\s*:/],
];
const forbiddenSources = [
  ["@ripota/parks catalog", /@ripota\/parks\/(?:dist\/)?catalog\.json$/],
  ["site catalog adapter", /src\/lib\/pota\/catalog\.ts$/],
];

for (const modulePath of graphPaths) {
  const source = readFileSync(modulePath, "utf8");
  for (const [label, pattern] of forbiddenPayloads) {
    assert(
      !pattern.test(source),
      `Volunteer browser graph contains ${label} in ${relative(distDirectory, modulePath)}.`,
    );
  }

  const sourceMap = JSON.parse(readFileSync(`${modulePath}.map`, "utf8"));
  for (const sourcePath of sourceMap.sources ?? []) {
    for (const [label, pattern] of forbiddenSources) {
      assert(
        !pattern.test(sourcePath),
        `Volunteer browser graph depends on ${label} through ${sourcePath}.`,
      );
    }
  }
}

console.log(
  [
    `Volunteer bundle: ${entryBytes} B minified, ${entryBrotliBytes} B Brotli q11.`,
    `Initial module graph: ${graphPaths.length} assets, ${graphBrotliBytes} B Brotli q11.`,
    `Brotli reduction from issue #30 baseline: ${reductionBytes} B.`,
    "No catalog dependency or geometry payload detected in the volunteer browser graph.",
  ].join("\n"),
);

function collectStaticModuleGraph(entryPath) {
  const pending = [entryPath];
  const visited = new Set();

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (!modulePath || visited.has(modulePath)) continue;
    visited.add(modulePath);

    const source = readFileSync(modulePath, "utf8");
    const imports = source.matchAll(
      /\bimport\s*(?!\()(?:(?:[^"'()]*?)from\s*)?["']([^"']+)["']/g,
    );
    for (const match of imports) {
      if (!match[1].startsWith(".")) continue;
      pending.push(resolve(dirname(modulePath), match[1]));
    }
  }

  return [...visited].sort();
}

function resolveDistAsset(pathname) {
  const assetPath = resolve(distDirectory, pathname.slice(1));
  assert(
    !relative(distDirectory, assetPath).startsWith(".."),
    `Browser asset resolves outside dist: ${pathname}`,
  );
  return assetPath;
}

function brotliSize(input) {
  return brotliCompressSync(input, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).byteLength;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
