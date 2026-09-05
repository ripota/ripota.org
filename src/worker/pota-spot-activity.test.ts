import { afterEach, describe, expect, it } from "vitest";

import type { LivePotaSpot } from "../lib/pota/spots";
import { cleanupPotaSpotHistory, persistPotaSpotHistory } from "./pota-spot-history";
import { persistEventSpotObservations } from "./pota-event";
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
  it("keeps observed event parks out of the missing list after detailed reports expire", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = { ...database, ACTIVATE_RI_EVENT_ID: "activate-ri-2026" as const };
    const eventSpot = spot({
      spotTime: "2026-09-11T12:00:00Z", sourceLabel: "Ham2K Portable Logger",
      comments: "CW 2-fer: US-6979 US-6980",
    });
    await persistPotaSpotHistory(env, [eventSpot], new Date("2026-09-11T12:00:00Z"));
    await persistEventSpotObservations(env, [eventSpot], new Date("2026-09-11T12:00:00Z"));
    const afterRetention = new Date("2026-10-01T12:00:00Z");
    await cleanupPotaSpotHistory(env, afterRetention);
    const activity = await getPublicPotaSpotActivity(env, afterRetention);
    expect(activity.summary).toMatchObject({ parks: 2, unspottedParks: 59, spots: 0 });
    expect(activity.unspottedParks.some(park => ["US-6979", "US-6980"].includes(park.reference))).toBe(false);
    expect(activity.parks.every(park => park.retainedEventEvidence && park.coverage?.status === "spotted")).toBe(true);
  });
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
      totalParks: 61,
      unspottedParks: 59,
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
    expect(activity.unspottedParks).toHaveLength(59);
    expect(activity.unspottedParks.some(park => ["US-6979", "US-6980"].includes(park.reference))).toBe(false);
    expect(new Set([...activity.parks, ...activity.unspottedParks].map(park => park.reference)).size).toBe(61);
  });

  it("starts event coverage empty and joins schedules and confirmations without inferring spots", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    await persistPotaSpotHistory(database, [spot()], new Date("2026-09-04T12:00:00Z"));
    await database.DB.prepare(
      `INSERT INTO activate_ri_activators (
        id, event_id, email_normalized, name, primary_callsign, status, created_at, updated_at
      ) VALUES ('fixture', 'activate-ri-2026', 'private@example.invalid', 'Fixture', 'W1AW',
        'approved', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
    ).run();
    await database.DB.prepare(
      `INSERT INTO activate_ri_stops (
        id, activator_id, event_id, park_reference, start_at, end_at,
        bands_json, modes_json, status, created_at, updated_at
      ) VALUES ('fixture', 'fixture', 'activate-ri-2026', 'US-6979',
        '2026-09-11T23:30:00Z', '2026-09-12T01:00:00Z', '[]', '[]', 'scheduled',
        '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
    ).run();
    await database.DB.prepare(
      `INSERT INTO activate_ri_pota_activation_evidence (
        event_id, park_reference, location_desc, qso_date, activator_callsign,
        total_qsos, qsos_cw, qsos_data, qsos_phone, qualifying, source_version,
        first_seen_at, last_verified_at, created_at, updated_at
      ) VALUES ('activate-ri-2026', 'US-6980', 'US-RI', '20260910', 'W1AW',
        51, 51, 0, 0, 1, 'fixture', '2026-09-10', '2026-09-10', '2026-09-10', '2026-09-10')`,
    ).run();
    const activity = await getPublicPotaSpotActivity(database, new Date("2026-09-10T00:00:00Z"));
    expect(activity).toMatchObject({ scope: "event", summary: { parks: 0, unspottedParks: 61, spots: 0 } });
    expect(activity.parks).toEqual([]);
    expect(activity.unspottedParks.find(park => park.reference === "US-6979")).toMatchObject({
      spotCount: 0, coverage: { status: "scheduled_later", stop: { activatorCallsign: "W1AW", startAt: "2026-09-11T23:30:00Z" } },
    });
    expect(activity.unspottedParks.find(park => park.reference === "US-6980")).toMatchObject({
      spotCount: 0, coverage: { status: "confirmed" }, confirmation: { activatorCallsign: "W1AW", totalQsos: 51 },
    });
    expect(JSON.stringify(activity)).not.toContain("private@example.invalid");
    const during = await getPublicPotaSpotActivity(database, new Date("2026-09-12T00:30:00Z"));
    expect(during.unspottedParks.find(park => park.reference === "US-6979")?.coverage?.status).toBe("scheduled_now");
    const after = await getPublicPotaSpotActivity(database, new Date("2026-09-12T01:00:00Z"));
    expect(after.unspottedParks.find(park => park.reference === "US-6979")?.coverage?.status).toBe("window_passed");
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
