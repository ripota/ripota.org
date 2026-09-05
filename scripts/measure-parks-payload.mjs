import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const directory = resolve(process.argv[2] ?? "dist");
const routes = [
  "/", "/parks/", "/parks/us-2870/", "/parks/us-6979/",
  "/parks/us-6992/", "/parks/us-0513/", "/parks/us-4582/",
  "/activate-ri-2026/", "/activate-ri-2026/volunteer/",
];
const bytes = (text) => ({ raw: Buffer.byteLength(text), gzip: gzipSync(text).length });

console.log(JSON.stringify({ routes: routes.map((route) => {
  const html = readFileSync(resolve(directory, `.${route}index.html`), "utf8");
  const geometries = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.type === "FeatureCollection") {
      geometries.push(value);
      return;
    }
    Object.values(value).forEach(visit);
  }
  for (const match of html.matchAll(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    visit(JSON.parse(match[1]));
  }
  return {
    route,
    html: bytes(html),
    // Compress the serialized array of all initial FeatureCollections together.
    // Count zero when geometry is absent, excluding an artificial empty array.
    geometry: geometries.length ? bytes(JSON.stringify(geometries)) : { raw: 0, gzip: 0 },
    collections: geometries.length,
  };
}) }, null, 2));
