import { afterEach, describe, expect, it } from "vitest";
import type { LivePotaSpot } from "../lib/pota/spots";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";
import {
  cleanupPotaSpotHistory,
  persistPotaSpotHistory,
  potaSpotRetentionMilliseconds,
} from "./pota-spot-history";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("POTA spot history", () => {
  it("retains first sighting while refreshing the latest spot details", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const firstSeen = new Date("2026-09-03T14:45:00Z");
    const lastSeen = new Date("2026-09-03T14:46:00Z");

    await persistPotaSpotHistory(database, [spot({ mode: "" })], firstSeen);
    await persistPotaSpotHistory(database, [spot({ mode: "SSB", expiresInSeconds: 300 })], lastSeen);

    const rows = await database.DB.prepare(
      `SELECT first_observed_at, last_observed_at, reported_expires_at,
        frequency, mode, spotter_callsign, comments, upstream_count
       FROM pota_spot_observations`,
    ).all<Record<string, unknown>>();
    expect(rows.results).toEqual([{
      first_observed_at: firstSeen.valueOf(),
      last_observed_at: lastSeen.valueOf(),
      reported_expires_at: lastSeen.valueOf() + 300_000,
      frequency: "14315",
      mode: "SSB",
      spotter_callsign: "K1NW",
      comments: "",
      upstream_count: null,
    }]);
  });

  it("expires rolling observations after 14 days without touching event evidence", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const now = new Date("2026-09-18T12:00:00Z");
    const old = new Date(now.valueOf() - potaSpotRetentionMilliseconds - 1);
    await persistPotaSpotHistory(database, [spot({ spotTime: old.toISOString() })], now);
    await database.DB.prepare(
      `INSERT INTO activate_ri_pota_spot_observations (
        event_id, park_reference, spot_date, activator_callsign, location_desc,
        source_spot_id, first_observed_at, last_observed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "activate-ri-2026", "US-10542", "2026-09-11", "K1NW", "US-RI",
      "42", old.toISOString(), old.toISOString(), old.toISOString(), old.toISOString(),
    ).run();

    await expect(cleanupPotaSpotHistory(database, now)).resolves.toMatchObject({ deleted: 1 });
    const rolling = await database.DB.prepare("SELECT COUNT(*) AS count FROM pota_spot_observations")
      .first<{ count: number }>();
    const event = await database.DB.prepare("SELECT COUNT(*) AS count FROM activate_ri_pota_spot_observations")
      .first<{ count: number }>();
    expect(rolling?.count).toBe(0);
    expect(event?.count).toBe(1);
  });
});

function spot(overrides: Partial<LivePotaSpot> = {}): LivePotaSpot {
  return {
    id: "42",
    parkReference: "US-10542",
    parkName: "Camp Cronin Fishing Area",
    activatorCallsign: "K1NW",
    frequency: "14315",
    mode: "SSB",
    spotTime: "2026-09-03T14:45:00",
    spotterCallsign: "K1NW",
    comments: "",
    sourceLabel: "POTA",
    upstreamCount: null,
    locationDesc: "US-RI",
    expiresInSeconds: 600,
    parkUrl: "https://pota.app/#/park/US-10542",
    spotsUrl: "https://pota.app/",
    ...overrides,
  };
}
