#!/usr/bin/env -S node --experimental-strip-types

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { normalizePotaReferences } from "../../src/lib/pota/references.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = path.join(root, "src/data/ri-references.json");
const boundaryDirectory = path.join(root, "src/data/boundaries");
const countyBoundaryUrl =
  "https://risegis.ri.gov/gpserver/rest/services/RIDOA/eSTIP/MapServer/12/query";

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

function countyName(name) {
  return `${name
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())} County`;
}

function ringContainsPoint(ring, point) {
  const [x, y] = point;
  let contains = false;

  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const [currentX, currentY] = ring[current];
    const [previousX, previousY] = ring[previous];
    const intersects =
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;

    if (intersects) {
      contains = !contains;
    }
  }

  return contains;
}

function polygonContainsPoint(polygon, point) {
  if (!ringContainsPoint(polygon[0], point)) {
    return false;
  }

  return !polygon.slice(1).some((ring) => ringContainsPoint(ring, point));
}

function geometryContainsPoint(geometry, point) {
  if (geometry.type === "Polygon") {
    return polygonContainsPoint(geometry.coordinates, point);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => polygonContainsPoint(polygon, point));
  }

  return false;
}

function flattenCoordinatePoints(coordinates, points = []) {
  if (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    points.push(coordinates);
    return points;
  }

  for (const coordinate of coordinates ?? []) {
    flattenCoordinatePoints(coordinate, points);
  }

  return points;
}

async function fetchCountyBoundaries() {
  const url = new URL(countyBoundaryUrl);
  url.search = new URLSearchParams({
    where: "1=1",
    outFields: "COUNTY",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  }).toString();

  const countyBoundaries = await fetchJson(url);

  return countyBoundaries.features.map((feature) => ({
    county: countyName(feature.properties.COUNTY),
    geometry: feature.geometry,
  }));
}

async function referencePoints(reference) {
  const fallbackPoint = [reference.longitude, reference.latitude];
  const boundaryPath = path.join(boundaryDirectory, `${reference.reference.toLowerCase()}.geojson`);

  try {
    const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
    const boundaryPoints = boundary.features.flatMap((feature) =>
      flattenCoordinatePoints(feature.geometry.coordinates),
    );

    return boundaryPoints.length > 0 ? boundaryPoints : [fallbackPoint];
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return [fallbackPoint];
  }
}

async function countyNamesForReference(reference, countyBoundaries) {
  const points = await referencePoints(reference);
  const counties = new Set();

  for (const countyBoundary of countyBoundaries) {
    if (
      points.some((point) =>
        geometryContainsPoint(countyBoundary.geometry, point),
      )
    ) {
      counties.add(countyBoundary.county);
    }
  }

  return [...counties].sort((left, right) => left.localeCompare(right));
}

async function addCountyMetadata(references) {
  const countyBoundaries = await fetchCountyBoundaries();

  return Promise.all(
    references.map(async (reference) => ({
      ...reference,
      counties: await countyNamesForReference(reference, countyBoundaries),
    })),
  );
}

export async function updateRiReferences() {
  const parks = await fetchJson("https://api.pota.app/location/parks/US-RI");
  const references = await addCountyMetadata(normalizePotaReferences(parks));

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
