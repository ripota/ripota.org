import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { ParkImage } from "@ripota/parks/types";
import {
  buildParkImageVariants,
  getParkHeroPhoto,
  parkImageWidths,
  resolveParkHeroImage,
} from "./images";

async function fixture(width = 1000, height = 700) {
  const master = await sharp({
    create: { width, height, channels: 3, background: { r: 19, g: 93, b: 106 } },
  }).webp().toBuffer();
  const sha256 = createHash("sha256").update(master).digest("hex");
  const image: ParkImage = {
    id: "coastal-park",
    artifact: `@ripota/parks/images/coastal-park.${sha256.slice(0, 12)}.webp`,
    width, height, bytes: master.byteLength, sha256, mimeType: "image/webp",
    alt: "A coastal park beside the water.",
    caption: "Coastal park at dawn",
    credit: "Example photographer",
    source: {
      pageUrl: "https://example.org/park",
      imageUrl: "https://example.org/park.jpg",
      sha256: "a".repeat(64),
      retrievedAt: "2026-09-12",
    },
    rights: {
      kind: "licensed", label: "CC BY-SA 4.0",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
      reviewedAt: "2026-09-12",
    },
    transforms: ["Resized original photograph and encoded as WebP."],
  };
  return { image, master };
}

describe("park hero photos", () => {
  it("permits absent photos and empty registries without placeholders", async () => {
    expect(resolveParkHeroImage({}, { schemaVersion: 1, images: [] })).toBeUndefined();
    expect(await getParkHeroPhoto({})).toBeUndefined();
  });

  it("resolves only the selected photo and preserves its attribution and provenance", async () => {
    const { image } = await fixture();
    const registry = { schemaVersion: 1 as const, images: [image] };
    expect(resolveParkHeroImage({}, registry)).toBeUndefined();
    expect(resolveParkHeroImage({ heroImageId: image.id }, registry)).toBe(image);
    expect(() => resolveParkHeroImage({ heroImageId: "not-in-release" }, registry))
      .toThrow("Missing selected park image: not-in-release");
  });

  it("caps each responsive width without duplicating or enlarging small masters", () => {
    expect(parkImageWidths(2400)).toEqual([480, 800, 1280, 1920]);
    expect(parkImageWidths(1000)).toEqual([480, 800, 1000]);
    expect(parkImageWidths(480)).toEqual([480]);
    expect(parkImageWidths(300)).toEqual([300]);
    for (const invalid of [0, -1, 10.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parkImageWidths(invalid)).toThrow(/positive integer/);
    }
  });

  it("emits decodable same-origin WebP files with real sizes, preserved aspect ratios, and content hashes", async () => {
    const { image, master } = await fixture();
    const variants = await buildParkImageVariants(image, master);
    expect(variants.map(({ width }) => width)).toEqual([480, 800, 1000]);
    for (const variant of variants) {
      const actual = await sharp(variant.data).metadata();
      expect(actual).toMatchObject({ format: "webp", width: variant.width, height: variant.height });
      expect(variant.height).toBe(Math.round(variant.width * image.height / image.width));
      expect(variant.width).toBeLessThanOrEqual(image.width);
      expect(variant.bytes).toBe(variant.data.byteLength);
      const digest = createHash("sha256").update(variant.data).digest("hex");
      expect(variant.sha256).toBe(digest);
      expect(variant.url).toBe(`/assets/parks/coastal-park-${variant.width}.${digest.slice(0, 16)}.webp`);
      expect(variant.url).not.toContain(image.source.imageUrl);
    }
    const repeated = await buildParkImageVariants(image, master);
    expect(repeated).toEqual(variants);
  });

  it("rejects altered or invalid masters instead of silently shipping an original or placeholder", async () => {
    const { image, master } = await fixture(20, 14);
    await expect(buildParkImageVariants({ ...image, bytes: image.bytes + 1 }, master))
      .rejects.toThrow(/integrity mismatch/);
    await expect(buildParkImageVariants({ ...image, sha256: "0".repeat(64) }, master))
      .rejects.toThrow(/integrity mismatch/);
    await expect(buildParkImageVariants({ ...image, width: 21 }, master))
      .rejects.toThrow(/metadata mismatch/);
    await expect(buildParkImageVariants({ ...image, id: "../escape" }, master))
      .rejects.toThrow(/Invalid park image ID/);
    const corrupt = Buffer.from("not an image");
    await expect(buildParkImageVariants({
      ...image,
      bytes: corrupt.byteLength,
      sha256: createHash("sha256").update(corrupt).digest("hex"),
    }, corrupt)).rejects.toThrow();
  });
});
