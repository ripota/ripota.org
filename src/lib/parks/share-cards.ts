// Build-time only: publish complete, content-addressed cards as static PNGs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { getPark } from "@ripota/parks";
import { getDisplayReference } from "@ripota/parks/display";
import type { CatalogRecord, ParkImage } from "@ripota/parks/types";
import { parksCatalog } from "../pota/catalog";
import { getWebGeometry } from "../pota/geometry-assets";
import { resolveParkHeroImage } from "./images";
import { renderShareMap } from "./share-map";

export const shareCardSize = { width: 1200, height: 630 } as const;
const require = createRequire(import.meta.url);
const cacheDirectory = join(process.cwd(), "tmp/park-share-cards/cards");
const pending = new Map<string, Promise<ParkShareCard>>();
let queue: Promise<unknown> = Promise.resolve();

export type ParkShareCard = {
  filename: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  type: "image/png";
  data: Uint8Array<ArrayBuffer>;
};

function hash(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

async function textImage(text: string, width: number, maxHeight: number, size: number, color: string, font = "sans") {
  for (let current = size; current >= 12; current--) {
    const { data, info } = await sharp({ text: {
      text: `<span foreground="${color}">${escape(text)}</span>`,
      font: `${font} ${current}`, width, rgba: true, dpi: 72, wrap: "word",
    } }).png().toBuffer({ resolveWithObject: true });
    if (info.height <= maxHeight) return data;
  }
  throw new Error(`Share card text does not fit: ${text}`);
}

export function photoCrop(image: Pick<ParkImage, "width" | "height" | "focalPoint">, width: number, height: number) {
  const scale = Math.max(width / image.width, height / image.height);
  const cropWidth = Math.min(image.width, Math.round(width / scale));
  const cropHeight = Math.min(image.height, Math.round(height / scale));
  const point = image.focalPoint ?? { x: 0.5, y: 0.5 };
  return {
    left: Math.max(0, Math.min(image.width - cropWidth, Math.round(point.x * image.width - cropWidth / 2))),
    top: Math.max(0, Math.min(image.height - cropHeight, Math.round(point.y * image.height - cropHeight / 2))),
    width: cropWidth, height: cropHeight,
  };
}

export async function renderParkShareCard(
  park: Pick<CatalogRecord, "reference" | "name" | "counties" | "grid" | "geometryKind">,
  map: Buffer,
  photo?: { image: ParkImage; data: Buffer },
): Promise<Buffer> {
  const layers: OverlayOptions[] = [
    { input: await textImage(`${park.reference}  /  RHODE ISLAND FIELD GUIDE`, 1136, 26, 20, "#efc992", "sans bold"), left: 32, top: 24 },
    { input: await textImage(park.name, 1136, 112, 48, "#fffaf0", "serif bold"), left: 32, top: 62 },
    { input: await textImage(`${park.counties.join(" · ")}  ·  Grid ${park.grid}`, 1136, 26, 20, "#dce7df"), left: 32, top: 177 },
    { input: map, left: photo ? 668 : 32, top: 220 },
    { input: await textImage("RI POTA  ·  ripota.org", 430, 28, 22, "#fffaf0", "sans bold"), left: 32, top: 574 },
    { input: await textImage("Unofficial community site", 390, 24, 18, "#dce7df"), left: 778, top: 576 },
  ];
  if (photo) {
    layers.push({ input: await sharp(photo.data).extract(photoCrop(photo.image, 620, 336)).resize(620, 336).png().toBuffer(), left: 32, top: 220 });
    layers.push({ input: await textImage(`Photo: ${photo.image.credit} · ${photo.image.rights.label} · cropped · source and license on park page`, 1136, 18, 14, "#dce7df"), left: 32, top: 609 });
  }
  return sharp({ create: { ...shareCardSize, channels: 3, background: "#18312f" } })
    .composite(layers).png().toBuffer();
}

export function getParkShareCard(park: CatalogRecord): Promise<ParkShareCard> {
  let card = pending.get(park.reference);
  if (!card) {
    card = queue.then(() => buildCard(park));
    pending.set(park.reference, card);
    queue = card.catch(() => undefined);
  }
  return card;
}

async function buildCard(park: CatalogRecord): Promise<ParkShareCard> {
  const visitor = getPark(park.reference);
  const display = getDisplayReference(park.reference);
  if (!visitor || !display) throw new Error(`Missing share card metadata: ${park.reference}`);
  const image = resolveParkHeroImage(visitor);
  const master = image ? readFileSync(require.resolve(image.artifact)) : undefined;
  if (image && master && (master.byteLength !== image.bytes || hash(master) !== image.sha256)) {
    throw new Error(`Park share photo integrity mismatch: ${image.id}`);
  }
  const geometry = getWebGeometry(park.reference);
  // Read source paths from the project root: import.meta.url is bundled by Astro.
  const template = ["share-cards.ts", "share-map.ts"].map(file => readFileSync(join(process.cwd(), "src/lib/parks", file), "utf8"));
  const fingerprint = hash(JSON.stringify({ park, display, geometry, image, template, sharp: sharp.versions }));
  await mkdir(cacheDirectory, { recursive: true });
  const path = join(cacheDirectory, `${park.reference.toLowerCase()}.${fingerprint}.png`);
  let data: Buffer;
  try {
    data = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const map = await renderShareMap(display, geometry, image ? 500 : 1136, 336);
    data = await renderParkShareCard(park, map, image && master ? { image, data: master } : undefined);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, path);
  }
  const filename = `${park.reference.toLowerCase()}.${hash(data).slice(0, 16)}`;
  return {
    filename, src: `/assets/parks/share/${filename}.png`,
    alt: `${park.reference} · ${park.name}. ${image ? "Park photo and map" : "Map"} showing ${park.geometryKind === "point" ? "the reference location" : park.geometryKind === "activation-zone" ? "the mapped activation zone" : "the mapped park boundary"}. RI POTA field guide.`,
    ...shareCardSize, type: "image/png", data: new Uint8Array(data),
  };
}

export async function getParkShareCards(): Promise<ParkShareCard[]> {
  const cards: ParkShareCard[] = [];
  for (const park of parksCatalog.references) cards.push(await getParkShareCard(park));
  return cards;
}
