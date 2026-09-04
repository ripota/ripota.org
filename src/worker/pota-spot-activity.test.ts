import { afterEach, describe, expect, it } from "vitest";

import type { LivePotaSpot } from "../lib/pota/spots";
import { persistPotaSpotHistory } from "./pota-spot-history";
import {
  frequencyToAmateurBand,
  getPublicPotaSpotActivity,
} from "./pota-spot-activity";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("frequencyToAmateurBand", () => {
  it.each([
    ["14315", "20m"],
    ["14.315", "20m"],
    ["7,200", "40m"],
    ["146520", "2m"],
    ["", null],
    ["not-a-frequency", null],
  ])("maps %s to %s", (frequency, expected) => {
    expect(frequencyToAmateurBand(frequency)).toBe(expected);
  });
});

describe("public POTA spot activity", () => {
  it("counts complete reports and projects declared Ham2K N-fer parks", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const now = new Date("2026-09-04T12:05:00Z");
    await persistPotaSpotHistory(database, [
      spot({
        id: "manual-1",
        spotTime: "2026-09-04T11:45:28Z",
        spotterCallsign: "N1BS",
        sourceLabel: "Ham2K Portable Logger",
        comments: "CW 2-fer: US-6979 US-6980",
      }),
      spot({ id: "rbn-1" }),
    ], now);
    await database.DB.prepare(
      `UPDATE pota_spots_cache SET payload_json = ?, fetched_at = ?
       WHERE id = 'ri-live-spots'`,
    ).bind(JSON.stringify([spot({ id: "rbn-1" })]), now.valueOf()).run();
    await database.DB.prepare(
      `INSERT INTO pota_spot_history_sync (
         activator_callsign, park_reference, first_seen_at, last_seen_at,
         last_live_spot_id, active, declared_references_json
       ) VALUES ('N1BS', 'US-6979', ?, ?, 'rbn-1', 1, '["US-6980"]')`,
    ).bind(now.valueOf() - 20 * 60_000, now.valueOf()).run();

    const activity = await getPublicPotaSpotActivity(database, now);

    expect(activity.summary).toEqual({
      parks: 2,
      activators: 1,
      modes: 1,
      bands: 1,
      spots: 2,
      rbnSpots: 1,
      nonRbnSpots: 1,
      nonRbnSpotters: 1,
    });
    expect(activity.parks.find((park) => park.reference === "US-6979")).toMatchObject({
      live: true,
      spotCount: 2,
      structuredSpotCount: 2,
      declaredNferSpotCount: 0,
      rbnSpotCount: 1,
      nonRbnSpotCount: 1,
      nonRbnSpotters: ["N1BS"],
    });
    expect(activity.parks.find((park) => park.reference === "US-6980")).toMatchObject({
      live: true,
      spotCount: 1,
      structuredSpotCount: 0,
      declaredNferSpotCount: 1,
      declaredByReferences: ["US-6979"],
    });
  });
});

function spot(overrides: Partial<LivePotaSpot> = {}): LivePotaSpot {
  return {
    id: "rbn-1",
    parkReference: "US-6979",
    parkName: "Arcadia Management Area",
    activatorCallsign: "N1BS",
    frequency: "7054",
    mode: "CW",
    spotTime: "2026-09-04T12:00:00Z",
    spotterCallsign: "W1RBN-#",
    comments: "RBN 10 dB 22 WPM",
    sourceLabel: "RBN",
    upstreamCount: 1,
    locationDesc: "US-RI",
    expiresInSeconds: 600,
    parkUrl: "https://pota.app/#/park/US-6979",
    spotsUrl: "https://pota.app/",
    ...overrides,
  };
}
