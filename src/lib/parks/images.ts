// Build-time only: package files are decoded locally and emitted as static assets.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import type { Park, ParkImage, ParkImageRegistry } from "@ripota/parks/types";

export type ParkImageVariant = Readonly<{
  filename: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}>;

export type ParkImageAsset = ParkImageVariant & Readonly<{
  data: Uint8Array<ArrayBuffer>;
}>;

export type ParkHeroPhoto = Readonly<{
  image: ParkImage;
  variants: readonly ParkImageVariant[];
  src: string;
  srcset: string;
  width: number;
  height: number;
  objectPosition: string;
}>;

const require = createRequire(import.meta.url);
let registry: ParkImageRegistry | undefined;
const assetCache = new Map<string, Promise<readonly ParkImageAsset[]>>();
// Static pages may render concurrently; serialize decoding to bound build memory.
let renderingQueue: Promise<unknown> = Promise.resolve();

function readImageRegistry(): ParkImageRegistry {
  if (!registry) {
    const value = JSON.parse(readFileSync(require.resolve("@ripota/parks/images.json"), "utf8")) as ParkImageRegistry;
    if (value.schemaVersion !== 1 || !Array.isArray(value.images)) {
      throw new Error("Unsupported park image registry");
    }
    registry = value;
  }
  return registry;
}

/** Missing selection means no photo. A selected but missing ID is a broken package. */
export function resolveParkHeroImage(
  park: Pick<Park, "heroImageId">,
  images: ParkImageRegistry = readImageRegistry(),
): ParkImage | undefined {
  if (park.heroImageId === undefined) return undefined;
  const image = images.images.find(({ id }) => id === park.heroImageId);
  if (!image) throw new Error(`Missing selected park image: ${park.heroImageId}`);
  return image;
}

export function parkImageWidths(sourceWidth: number): number[] {
  if (!Number.isInteger(sourceWidth) || sourceWidth < 1) {
    throw new Error("Park image width must be a positive integer");
  }
  return [...new Set([480, 800, 1280, 1920].map((width) => Math.min(width, sourceWidth)))];
}

/** Encode real responsive derivatives; names hash the emitted bytes, not settings. */
export async function buildParkImageVariants(
  image: ParkImage,
  master: Uint8Array,
): Promise<readonly ParkImageAsset[]> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(image.id)) {
    throw new Error(`Invalid park image ID: ${image.id}`);
  }
  const digest = createHash("sha256").update(master).digest("hex");
  if (master.byteLength !== image.bytes || digest !== image.sha256) {
    throw new Error(`Park image master integrity mismatch: ${image.id}`);
  }
  const metadata = await sharp(master, { failOn: "error" }).metadata();
  if (
    metadata.format !== "webp" ||
    metadata.width !== image.width ||
    metadata.height !== image.height ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new Error(`Park image master metadata mismatch: ${image.id}`);
  }
  const variants: ParkImageAsset[] = [];
  for (const width of parkImageWidths(image.width)) {
    const { data, info } = await sharp(master, { failOn: "error" })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    const sha256 = createHash("sha256").update(data).digest("hex");
    const filename = `${image.id}-${info.width}.${sha256.slice(0, 16)}`;
    variants.push({
      filename,
      url: `/assets/parks/${filename}.webp`,
      width: info.width,
      height: info.height,
      bytes: data.byteLength,
      sha256,
      data: new Uint8Array(data),
    });
  }
  return variants;
}

function imageAssets(image: ParkImage): Promise<readonly ParkImageAsset[]> {
  let pending = assetCache.get(image.id);
  if (!pending) {
    pending = renderingQueue.then(() => buildParkImageVariants(
      image,
      readFileSync(require.resolve(image.artifact)),
    ));
    assetCache.set(image.id, pending);
    renderingQueue = pending.catch(() => undefined);
  }
  return pending;
}

/** Every shipped derivative has an explicit static route; an empty registry is valid. */
export async function getParkImageAssets(): Promise<readonly ParkImageAsset[]> {
  const assets: ParkImageAsset[] = [];
  for (const image of readImageRegistry().images) assets.push(...await imageAssets(image));
  return assets;
}

export async function getParkHeroPhoto(
  park: Pick<Park, "heroImageId">,
): Promise<ParkHeroPhoto | undefined> {
  const image = resolveParkHeroImage(park);
  if (!image) return undefined;
  const assets = await imageAssets(image);
  const variants = assets.map(({ data: _data, ...variant }) => variant);
  const fallback = variants.find(({ width }) => width >= 1280) ?? variants.at(-1)!;
  const point = image.focalPoint ?? { x: 0.5, y: 0.5 };
  return {
    image,
    variants,
    src: fallback.url,
    srcset: variants.map(({ url, width }) => `${url} ${width}w`).join(", "),
    width: fallback.width,
    height: fallback.height,
    objectPosition: `${point.x * 100}% ${point.y * 100}%`,
  };
}
