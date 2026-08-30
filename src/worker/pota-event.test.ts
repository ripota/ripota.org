import { afterEach, describe, expect, it, vi } from "vitest";
import type { LivePotaSpot } from "../lib/pota/spots";
import {
  getPotaAdminStatus,
  getPublicPotaParkStatus,
  persistEventSpotObservations,
  requestDeepPotaReconciliation,
  runPotaHistoryReconciliation,
} from "./pota-event";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("Activate RI POTA evidence store", () => {
  it("persists duplicate spot observations idempotently without comments", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    const first = new Date("2026-09-11T12:00:00Z");
    const second = new Date("2026-09-11T12:05:00Z");

    await persistEventSpotObservations(env, [liveSpot({ comments: "do not retain", frequency: "14.074" })], first);
    await persistEventSpotObservations(env, [liveSpot({ comments: "still private", frequency: "14.076" })], second);

    const rows = await database.DB.prepare(
      "SELECT * FROM activate_ri_pota_spot_observations",
    ).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results?.[0]).toMatchObject({
      first_observed_at: first.toISOString(),
      last_observed_at: second.toISOString(),
      last_frequency: "14.076",
    });
    expect(rows.results?.[0]).not.toHaveProperty("comments");
  });

  it("projects independent schedule, observation, attempts, confirmation, and live facts", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    await seedScheduledStop(database.DB, "US-2868", "completed");
    await persistEventSpotObservations(env, [liveSpot({ parkReference: "US-7971", parkName: "Blackstone" })], new Date("2026-09-11T12:00:00Z"));
    await seedEvidence(database.DB, "US-0513", "N1ONE", 9);
    await seedEvidence(database.DB, "US-0513", "N1TWO", 10);
    await seedLiveCache(database.DB, new Date("2026-09-11T12:01:00Z"));

    const projection = await getPublicPotaParkStatus(env, new Date("2026-09-11T12:02:00Z"));
    expect(projection.parks.find((park) => park.reference === "US-0513")).toMatchObject({
      status: "confirmed",
      confirmation: { activeCallsign: "N1TWO", totalQsos: 10 },
      attempts: [{ activeCallsign: "N1ONE", totalQsos: 9 }],
    });
    expect(projection.parks.find((park) => park.reference === "US-7971")).toMatchObject({
      status: "observed",
      live: true,
      observed: true,
    });
    expect(projection.parks.find((park) => park.reference === "US-2868")).toMatchObject({
      status: "scheduled",
      scheduled: true,
      confirmation: null,
    });
    expect(projection.summary).toMatchObject({ total: 61, confirmed: 1, observedNotConfirmed: 1 });
    expect(JSON.stringify(projection)).not.toMatch(/"(?:email|phone|token|notes|comments)"\s*:/i);
  });
});

describe("Activate RI POTA reconciliation", () => {
  it("prioritizes observed parks, bounds concurrency and batch size, and persists valid RI rows", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    await persistEventSpotObservations(env, [liveSpot()], new Date("2026-09-11T12:00:00Z"));
    let active = 0;
    let maximumActive = 0;
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const url = String(input);
      urls.push(url);
      await Promise.resolve();
      active -= 1;
      const reference = url.match(/activations\/(US-\d+)/)?.[1] ?? "US-0000";
      return Response.json([
        historyRow(reference === "US-7971" ? "N1LIVE" : "N1SYN", 12),
        historyRow("N1OUT", 100, "US-MD"),
      ]);
    });

    const result = await runPotaHistoryReconciliation(env, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-09-11T12:10:00Z"),
      force: true,
    });
    expect(result).toMatchObject({ acquired: true, attempted: 20, succeeded: 20, failed: 0 });
    expect(urls[0]).toContain("US-7971");
    expect(urls.every((url) => url.endsWith("?count=100"))).toBe(true);
    expect(maximumActive).toBeLessThanOrEqual(5);
    const projection = await getPublicPotaParkStatus(env, new Date("2026-09-11T12:11:00Z"));
    expect(projection.parks.find((park) => park.reference === "US-7971")).toMatchObject({ status: "confirmed" });
  });

  it("uses leases/backoff and completes organizer-triggered deep reconciliation in batches", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    const now = new Date("2026-10-13T12:00:00Z");
    await requestDeepPotaReconciliation(env, now);
    const malformed = vi.fn(async () => Response.json({ changed: true }));
    const failed = await runPotaHistoryReconciliation(env, {
      fetcher: malformed as typeof fetch,
      now: () => now,
      force: true,
    });
    expect(failed).toMatchObject({ attempted: 20, succeeded: 0, failed: 20, deep: true });

    const contended = await runPotaHistoryReconciliation(env, {
      fetcher: malformed as typeof fetch,
      now: () => new Date(now.valueOf() + 1_000),
      force: true,
    });
    expect(contended.acquired).toBe(false);
    const status = await getPotaAdminStatus(env, now);
    expect(status).toMatchObject({ deepReconciliationPending: true, consecutiveFailures: 1 });

    await database.DB.prepare(
      "UPDATE activate_ri_pota_sync_state SET retry_after = 0",
    ).run();
    await database.DB.prepare(
      "UPDATE activate_ri_pota_reconciliation SET retry_after = 0",
    ).run();
    const success = vi.fn(async (_input: RequestInfo | URL) => Response.json([]));
    let complete = false;
    for (let batch = 0; batch < 4; batch += 1) {
      const result = await runPotaHistoryReconciliation(env, {
        fetcher: success as typeof fetch,
        now: () => new Date(now.valueOf() + 120_000 + batch * 60_000),
        force: true,
      });
      complete = result.complete;
    }
    expect(complete).toBe(true);
    expect(success.mock.calls.every(([url]) => String(url).endsWith("?count=all"))).toBe(true);
    await expect(getPotaAdminStatus(env, new Date(now.valueOf() + 600_000))).resolves.toMatchObject({
      deepReconciliationPending: false,
    });
  });
});

function testEnv(DB: D1Database) {
  return { DB, ACTIVATE_RI_EVENT_ID: "activate-ri-2026" as const };
}

function liveSpot(overrides: Partial<LivePotaSpot> = {}): LivePotaSpot {
  return {
    id: "spot-1",
    parkReference: "US-7971",
    parkName: "Blackstone River Valley National Historical Park",
    activatorCallsign: "N1ABC",
    frequency: "14.074",
    mode: "FT8",
    spotTime: "2026-09-11T11:59:00Z",
    spotterCallsign: "N1XYZ",
    comments: "synthetic",
    sourceLabel: "POTA",
    locationDesc: "US-RI",
    expiresInSeconds: 600,
    parkUrl: "https://pota.app/#/park/US-7971",
    spotsUrl: "https://pota.app/",
    ...overrides,
  };
}

function historyRow(activeCallsign: string, totalQSOs: number, locationDesc = "US-RI") {
  return { activeCallsign, qso_date: "20260911", totalQSOs, qsosCW: 2, qsosDATA: 3, qsosPHONE: 7, locationDesc };
}

async function seedEvidence(DB: D1Database, reference: string, callsign: string, total: number) {
  await DB.prepare(
    `INSERT INTO activate_ri_pota_activation_evidence (
      event_id, park_reference, location_desc, qso_date, activator_callsign,
      total_qsos, qsos_cw, qsos_data, qsos_phone, qualifying, source_version,
      first_seen_at, last_verified_at, created_at, updated_at
    ) VALUES ('activate-ri-2026', ?, 'US-RI', '20260911', ?, ?, 0, 0, ?, ?,
      'synthetic-v1', '2026-09-11T12:00:00Z', '2026-09-11T12:00:00Z',
      '2026-09-11T12:00:00Z', '2026-09-11T12:00:00Z')`,
  ).bind(reference, callsign, total, total, total >= 10 ? 1 : 0).run();
}

async function seedScheduledStop(DB: D1Database, reference: string, status: string) {
  await DB.prepare(
    `INSERT INTO activate_ri_activators (
      id, event_id, email_normalized, name, primary_callsign, status, created_at, updated_at
    ) VALUES ('synthetic-activator', 'activate-ri-2026', 'synthetic@example.com',
      'Synthetic', 'N1SYN', 'approved', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
  ).run();
  await DB.prepare(
    `INSERT INTO activate_ri_stops (
      id, activator_id, event_id, park_reference, start_at, end_at,
      bands_json, modes_json, status, created_at, updated_at
    ) VALUES ('synthetic-stop', 'synthetic-activator', 'activate-ri-2026', ?,
      '2026-09-11T12:00:00Z', '2026-09-11T15:00:00Z', '[]', '[]', ?,
      '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
  ).bind(reference, status).run();
}

async function seedLiveCache(DB: D1Database, fetchedAt: Date) {
  await DB.prepare(
    `UPDATE pota_spots_cache SET payload_json = ?, fetched_at = ? WHERE id = 'ri-live-spots'`,
  ).bind(JSON.stringify([liveSpot()]), fetchedAt.valueOf()).run();
}
