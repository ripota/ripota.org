import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getDisplayReference } from "@ripota/parks/display";
import type { GeoJsonFeatureCollection } from "@ripota/parks/types";

const require = createRequire(import.meta.url);
export const parksGeometryVersion = "3.1.1";

/** Resolve opt-in package assets as files, never as JavaScript modules. */
export function readGeometryArtifact(artifact: string): string {
  return readFileSync(require.resolve(artifact), "utf8");
}

function canonicalArtifact(reference: string): string {
  const display = getDisplayReference(reference);
  if (!display?.artifact) throw new Error(`Missing park geometry: ${reference}`);
  return display.artifact;
}

export function getWebGeometry(reference: string): GeoJsonFeatureCollection {
  const artifact = canonicalArtifact(reference);
  // This adoption keeps the reviewed v2 dataset. A future v3 fallback must
  // choose its own fidelity explicitly instead of pretending it is reviewed.
  if (!artifact.startsWith("@ripota/parks/boundaries/")) {
    throw new Error(`No reviewed web geometry: ${reference}`);
  }
  return JSON.parse(readGeometryArtifact(
    artifact.replace("/boundaries/", "/boundaries-web/"),
  )) as GeoJsonFeatureCollection;
}

export function getCanonicalGeometryUrl(reference?: string): string {
  const artifact = reference
    ? canonicalArtifact(reference).replace("@ripota/parks/", "")
    : "all.geojson";
  return `/data/parks/${parksGeometryVersion}/${artifact}`;
}
