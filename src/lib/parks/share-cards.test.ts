import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { getDisplayReference } from "@ripota/parks/display";
import type { DisplayReference, GeoJsonFeatureCollection, ParkImage } from "@ripota/parks/types";
import { parksCatalog } from "../pota/catalog";
import { mapViewport, project, renderShareMap } from "./share-map";
import { photoCrop, renderParkShareCard } from "./share-cards";

describe("park share maps", () => {
  it("fits every park's complete bounds within both card layouts", () => {
    for (const park of parksCatalog.references) {
      const display = getDisplayReference(park.reference)!;
      for (const width of [500, 1136]) {
        const viewport = mapViewport(display, width, 336);
        const [west, south, east, north] = display.bbox!;
        const nw = project([west, north], viewport.zoom);
        const se = project([east, south], viewport.zoom);
        expect(nw[0] - viewport.left, park.reference).toBeGreaterThanOrEqual(31);
        expect(nw[1] - viewport.top, park.reference).toBeGreaterThanOrEqual(31);
        expect(se[0] - viewport.left, park.reference).toBeLessThanOrEqual(width - 31);
        expect(se[1] - viewport.top, park.reference).toBeLessThanOrEqual(336 - 31);
      }
    }
  });

  it("centers point-only records with a capped zoom", () => {
    const display: DisplayReference = { reference: "US-TEST", status: "point-only", geometryKind: "point", displayPoint: { longitude: -71.4, latitude: 41.8, source: "official" } };
    const viewport = mapViewport(display, 500, 336);
    const point = project([-71.4, 41.8], viewport.zoom);
    expect(viewport.zoom).toBe(14);
    expect(point[0] - viewport.left).toBeCloseTo(250, 0);
    expect(point[1] - viewport.top).toBeCloseTo(168, 0);
  });

  it("renders polygon holes without fill and rejects missing tiles", async () => {
    const display: DisplayReference = { reference: "US-TEST", status: "available", geometryKind: "boundary", displayPoint: { longitude: 0.0008, latitude: 0.0008, source: "reviewed" }, bbox: [-0.001, -0.001, 0.001, 0.001] };
    const geometry: GeoJsonFeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [
      [[-0.001, -0.001], [0.001, -0.001], [0.001, 0.001], [-0.001, 0.001], [-0.001, -0.001]],
      [[-0.0004, -0.0004], [0.0004, -0.0004], [0.0004, 0.0004], [-0.0004, 0.0004], [-0.0004, -0.0004]],
    ] } }] };
    const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const map = await renderShareMap(display, geometry, 500, 336, async () => tile);
    const center = await sharp(map).extract({ left: 250, top: 168, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...center]).toEqual([255, 255, 255]);
    const filled = await sharp(map).extract({ left: 320, top: 168, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...filled]).not.toEqual([255, 255, 255]);
    await expect(renderShareMap(display, geometry, 500, 336, async () => { throw new Error("Tile unavailable"); })).rejects.toThrow("Tile unavailable");
  });
});

describe("park share card composition", () => {
  it("crops around the selected focal point without leaving the source image", () => {
    expect(photoCrop({ width: 1000, height: 1000, focalPoint: { x: 0, y: 0 } }, 620, 336)).toMatchObject({ left: 0, top: 0, width: 1000, height: 542 });
    expect(photoCrop({ width: 1000, height: 1000, focalPoint: { x: 1, y: 1 } }, 620, 336)).toMatchObject({ left: 0, top: 458 });
  });

  it("produces full-size photo/map and map-only PNGs, including the longest park name", async () => {
    const park = [...parksCatalog.references].sort((a, b) => b.name.length - a.name.length)[0];
    const photo = await sharp({ create: { width: 620, height: 336, channels: 3, background: "#ff0000" } }).png().toBuffer();
    for (const withPhoto of [true, false]) {
      const map = await sharp({ create: { width: withPhoto ? 500 : 1136, height: 336, channels: 3, background: "#00ff00" } }).png().toBuffer();
      const image = { width: 620, height: 336, credit: "Photographer & contributor <example>", rights: { label: "CC BY 4.0" } } as ParkImage;
      const card = await renderParkShareCard(park, map, withPhoto ? { image, data: photo } : undefined);
      expect(await sharp(card).metadata()).toMatchObject({ width: 1200, height: 630, format: "png" });
      const pixel = await sharp(card).extract({ left: 40, top: 230, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      expect([...pixel]).toEqual(withPhoto ? [255, 0, 0] : [0, 255, 0]);
    }
  });
});
