// Build-time static map renderer. Only the tiles visible in this viewport are read.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { DisplayReference, GeoJsonFeatureCollection } from "@ripota/parks/types";

type Point = readonly [number, number];
export type TileReader = (zoom: number, x: number, y: number) => Promise<Buffer>;
const tileSize = 256;
const cacheDirectory = join(process.cwd(), "tmp/park-share-cards/tiles");

export function project([longitude, latitude]: Point, zoom: number): Point {
  const sine = Math.sin(Math.max(-85.051129, Math.min(85.051129, latitude)) * Math.PI / 180);
  const scale = tileSize * 2 ** zoom;
  return [(longitude + 180) / 360 * scale, (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale];
}

export function mapViewport(display: DisplayReference, width: number, height: number) {
  const { longitude, latitude } = display.displayPoint;
  const [west, south, east, north] = display.bbox ?? [longitude, latitude, longitude, latitude];
  const padding = 32;
  let zoom = display.geometryKind === "point" ? 14 : 18;
  for (; zoom > 0; zoom--) {
    const nw = project([west, north], zoom);
    const se = project([east, south], zoom);
    if (se[0] - nw[0] <= width - padding * 2 && se[1] - nw[1] <= height - padding * 2) break;
  }
  const nw = project([west, north], zoom);
  const se = project([east, south], zoom);
  return { zoom, left: Math.round((nw[0] + se[0] - width) / 2), top: Math.round((nw[1] + se[1] - height) / 2) };
}

// One week minimum cache lifetime; completed cards are cached independently.
export async function readMapTile(zoom: number, x: number, y: number): Promise<Buffer> {
  await mkdir(cacheDirectory, { recursive: true });
  const path = join(cacheDirectory, `${zoom}-${x}-${y}.png`);
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs < 7 * 24 * 60 * 60 * 1000) return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, {
        headers: { "User-Agent": "RI-POTA-Share-Cards/1.0 (+https://ripota.org)", Referer: "https://ripota.org/" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(data).metadata();
      if (metadata.format !== "png" || metadata.width !== tileSize || metadata.height !== tileSize) {
        throw new Error("Invalid map tile image");
      }
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, data);
      await rename(temporary, path);
      return data;
    } catch (error) {
      if (attempt === 2) throw new Error(`Cannot render map tile ${zoom}/${x}/${y}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error("Map tile retries exhausted");
}

export async function renderShareMap(
  display: DisplayReference,
  geometry: GeoJsonFeatureCollection,
  width: number,
  height: number,
  readTile: TileReader = readMapTile,
): Promise<Buffer> {
  const { zoom, left, top } = mapViewport(display, width, height);
  const firstX = Math.floor(left / tileSize);
  const firstY = Math.floor(top / tileSize);
  const columns = Math.ceil((left + width) / tileSize) - firstX;
  const rows = Math.ceil((top + height) / tileSize) - firstY;
  const tiles: OverlayOptions[] = [];
  // Bound network concurrency and memory even during a complete fresh build.
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push({ input: await readTile(zoom, firstX + column, firstY + row), left: column * tileSize, top: row * tileSize });
    }
  }
  const mosaic = await sharp({ create: { width: columns * tileSize, height: rows * tileSize, channels: 3, background: "#e8eddf" } })
    .composite(tiles).png().toBuffer();
  const base = await sharp(mosaic).extract({ left: left - firstX * tileSize, top: top - firstY * tileSize, width, height }).toBuffer();
  const xy = (coordinate: Point): Point => {
    const point = project(coordinate, zoom);
    return [point[0] - left, point[1] - top];
  };
  const ring = (coordinates: readonly Point[]) => coordinates.map((coordinate, i) => `${i ? "L" : "M"}${xy(coordinate).map(n => n.toFixed(2)).join(",")}`).join(" ");
  const polygon = (rings: readonly (readonly Point[])[]) => `<path d="${rings.map(points => `${ring(points)} Z`).join(" ")}" fill="#d39a50" fill-opacity=".32" fill-rule="evenodd" stroke="#6f4618" stroke-width="3" stroke-linejoin="round"/>`;
  const shapes = geometry.features.map(({ geometry: feature }) => {
    if (feature.type === "Polygon") return polygon(feature.coordinates as readonly (readonly Point[])[]);
    if (feature.type === "MultiPolygon") return (feature.coordinates as readonly (readonly (readonly Point[])[])[]).map(polygon).join("");
    if (feature.type === "Point") return ""; // The display point below supplies the marker.
    throw new Error(`Unsupported share map geometry: ${feature.type}`);
  }).join("");
  const marker = xy([display.displayPoint.longitude, display.displayPoint.latitude]);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${shapes}<circle cx="${marker[0]}" cy="${marker[1]}" r="6" fill="#18312f" stroke="#fffaf0" stroke-width="2"/>
    <rect x="${width - 251}" y="${height - 25}" width="251" height="25" fill="#fffaf0" fill-opacity=".94"/>
    <text x="${width - 10}" y="${height - 8}" text-anchor="end" font-family="sans-serif" font-size="13" fill="#18312f">© OpenStreetMap contributors</text>
  </svg>`);
  return sharp(base).composite([{ input: overlay }]).png().toBuffer();
}
