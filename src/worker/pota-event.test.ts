import { afterEach, describe, expect, it, vi } from "vitest";
import type { LivePotaSpot } from "../lib/pota/spots";
import { potaApiUserAgent } from "./pota-api";
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
  vi.restoreAllMocks();
});

describe("Activate RI POTA evidence store", () => {
  it.each([
    ["2026-09-20T23:45:00Z", false],
    ["2026-09-20T21:59:00Z", true],
    [null, true],
  ])("preserves final sync freshness after collection closes (last success: %s)", async (lastSuccess, stale) => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    await database.DB.prepare(
      "UPDATE activate_ri_pota_sync_state SET last_history_success_at = ? WHERE event_id = ?",
    ).bind(lastSuccess ? Date.parse(lastSuccess) : null, "activate-ri-2026").run();

    const projection = await getPublicPotaParkStatus(testEnv(database.DB), new Date("2026-09-22T12:00:00Z"));
    expect(projection.stale).toBe(stale);
    expect(projection.warning === null).toBe(!stale);
  });

  it("persists duplicate spot observations idempotently with public provenance", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    const first = new Date("2026-09-11T12:00:00Z");
    const second = new Date("2026-09-11T12:05:00Z");

    await persistEventSpotObservations(env, [liveSpot({
      comments: "first report",
      frequency: "14.074",
      spotTime: "2026-09-11T11:59:00Z",
    })], first);
    await persistEventSpotObservations(env, [
      liveSpot({
        id: "newer",
        comments: "newest report",
        frequency: "14.076",
        spotTime: "2026-09-11T12:04:00Z",
      }),
      liveSpot({
        id: "older",
        comments: "older history report",
        frequency: "7.074",
        spotTime: "2026-09-11T11:45:00Z",
      }),
    ], second);

    const rows = await database.DB.prepare(
      "SELECT * FROM activate_ri_pota_spot_observations",
    ).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results?.[0]).toMatchObject({
      first_observed_at: first.toISOString(),
      last_observed_at: second.toISOString(),
      last_frequency: "14.076",
      last_comments: "newest report",
      last_spot_time: "2026-09-11T12:04:00.000Z",
      last_spotter_callsign: "N1XYZ",
      observation_kind: "structured_spot",
    });
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

  it("keeps a declared N-fer provisional and live until POTA confirms it", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    const now = new Date("2026-09-11T12:05:00Z");
    const primary = liveSpot({
      parkReference: "US-6979",
      parkName: "Arcadia Management Area",
      sourceLabel: "Ham2K Portable Logger",
      comments: "CW 2-fer: US-6979 US-6980",
      spotTime: "2026-09-11T11:45:28Z",
    });
    await persistEventSpotObservations(env, [primary], now);
    await seedLiveCache(database.DB, now, [liveSpot({
      parkReference: "US-6979",
      parkName: "Arcadia Management Area",
      sourceLabel: "RBN",
      comments: "RBN 10 dB 22 WPM",
    })]);
    await database.DB.prepare(
      `INSERT INTO pota_spot_history_sync (
         activator_callsign, park_reference, first_seen_at, last_seen_at,
         last_live_spot_id, active, declared_references_json
       ) VALUES ('N1ABC', 'US-6979', ?, ?, 'spot-1', 1, '["US-6980"]')`,
    ).bind(now.valueOf() - 20 * 60_000, now.valueOf()).run();

    const observed = await getPublicPotaParkStatus(env, now);
    expect(observed.parks.find((park) => park.reference === "US-6980")).toMatchObject({
      status: "observed",
      live: true,
      lastObservation: {
        activeCallsign: "N1ABC",
        evidenceKind: "declared_nfer",
        declaredByReference: "US-6979",
      },
    });

    await seedEvidence(database.DB, "US-6980", "N1ABC", 10);
    const confirmed = await getPublicPotaParkStatus(env, now);
    expect(confirmed.parks.find((park) => park.reference === "US-6980")).toMatchObject({
      status: "confirmed",
      live: true,
      confirmation: { activeCallsign: "N1ABC", totalQsos: 10 },
    });
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
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://api.pota.app/park/activations/US-7971?count=all",
      expect.objectContaining({
        headers: {
          accept: "application/json",
          "user-agent": potaApiUserAgent,
        },
      }),
    );
    expect(urls.every((url) => url.endsWith("?count=all"))).toBe(true);
    expect(maximumActive).toBeLessThanOrEqual(5);
    const projection = await getPublicPotaParkStatus(env, new Date("2026-09-11T12:11:00Z"));
    expect(projection.parks.find((park) => park.reference === "US-7971")).toMatchObject({ status: "confirmed" });
  });

  it("automatically revisits confirmed parks for later operators, dates, and corrected QSO counts", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    const startedAt = new Date("2026-09-12T12:00:00Z");
    await persistEventSpotObservations(env, [liveSpot()], startedAt);
    let upstreamRows = [historyRow("N1FIRST", 12)];
    const targetFetchTimes: number[] = [];
    let currentTime = startedAt;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/US-7971?")) {
        targetFetchTimes.push(currentTime.valueOf());
        return Response.json(upstreamRows);
      }
      return Response.json([]);
    });
    const reconcile = async (minutes: number) => {
      currentTime = new Date(startedAt.valueOf() + minutes * 60_000);
      return runPotaHistoryReconciliation(env, {
        fetcher: fetcher as typeof fetch,
        now: () => currentTime,
      });
    };

    await expect(reconcile(0)).resolves.toMatchObject({
      acquired: true, deep: false, attempted: 20, succeeded: 20,
    });
    const initial = await getPublicPotaParkStatus(env, currentTime);
    expect(initial.parks.find((park) => park.reference === "US-7971")).toMatchObject({
      status: "confirmed",
      confirmations: [{ activeCallsign: "N1FIRST", qsoDate: "20260911", totalQsos: 12 }],
    });

    await expect(reconcile(14)).resolves.toMatchObject({ acquired: false, attempted: 0 });
    expect(fetcher).toHaveBeenCalledTimes(20);
    upstreamRows = [
      { ...historyRow("N1FIRST", 24), qsosCW: 5, qsosDATA: 6, qsosPHONE: 13 },
      historyRow("N1LATE", 12),
      { ...historyRow("N1FIRST", 12), qso_date: "20260912" },
    ];
    for (const minutes of [15, 30, 45]) await reconcile(minutes);
    expect(targetFetchTimes).toEqual([startedAt.valueOf()]);

    await expect(reconcile(60)).resolves.toMatchObject({
      acquired: true, deep: false, attempted: 20, succeeded: 20,
    });
    const updated = await getPublicPotaParkStatus(env, currentTime);
    expect(updated.parks.find((park) => park.reference === "US-7971")).toMatchObject({
      status: "confirmed",
      confirmations: [
        { activeCallsign: "N1FIRST", qsoDate: "20260912", totalQsos: 12 },
        {
          activeCallsign: "N1FIRST", qsoDate: "20260911", totalQsos: 24,
          qsosCw: 5, qsosData: 6, qsosPhone: 13,
        },
        { activeCallsign: "N1LATE", qsoDate: "20260911", totalQsos: 12 },
      ],
    });

    for (const minutes of [75, 90, 105, 120]) await reconcile(minutes);
    expect(targetFetchTimes).toEqual([0, 60, 120].map((minutes) =>
      startedAt.valueOf() + minutes * 60_000,
    ));
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith("?count=all"))).toBe(true);
    const rows = await database.DB.prepare(
      `SELECT activator_callsign, qso_date, total_qsos, qsos_cw, qsos_data, qsos_phone,
        first_seen_at, last_verified_at
       FROM activate_ri_pota_activation_evidence WHERE park_reference = 'US-7971'`,
    ).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(3);
    expect((await database.DB.prepare(
      `SELECT revision, total_qsos FROM activate_ri_pota_activation_revisions
       WHERE park_reference = 'US-7971' AND activator_callsign = 'N1FIRST'
         AND qso_date = '20260911' ORDER BY revision`,
    ).all()).results).toEqual([{ revision: 1, total_qsos: 12 }, { revision: 2, total_qsos: 24 }]);
    expect(rows.results).toContainEqual({
      activator_callsign: "N1FIRST",
      qso_date: "20260911",
      total_qsos: 24,
      qsos_cw: 5,
      qsos_data: 6,
      qsos_phone: 13,
      first_seen_at: startedAt.toISOString(),
      last_verified_at: currentTime.toISOString(),
    });
  });

  it("rotates through older parks before revisiting an observed park after a collection gap", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    const startedAt = new Date("2026-09-12T12:00:00Z");
    await persistEventSpotObservations(env, [liveSpot()], startedAt);
    const batches: string[][] = [];

    for (let batch = 0; batch < 4; batch += 1) {
      const references: string[] = [];
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        references.push(new URL(String(input)).pathname.split("/").at(-1)!);
        return Response.json([]);
      });
      const result = await runPotaHistoryReconciliation(env, {
        fetcher: fetcher as typeof fetch,
        now: () => new Date(startedAt.valueOf() + batch * 60 * 60_000),
      });
      expect(result).toMatchObject({ acquired: true, deep: false, attempted: 20, succeeded: 20 });
      batches.push(references);
    }

    expect(batches[0][0]).toBe("US-7971");
    expect(new Set(batches.slice(0, 3).flat()).size).toBe(60);
    expect(batches[1]).not.toContain("US-7971");
    expect(batches[2]).not.toContain("US-7971");
    expect(batches.slice(0, 3).flat()).not.toContain(batches[3][0]);
    expect(new Set(batches.flat()).size).toBe(61);
    expect(batches[3]).toContain("US-7971");
  });

  it("finds a late event log beyond the latest 100 activations during normal post-event polling", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    const now = new Date("2026-09-20T12:00:00Z");
    await persistEventSpotObservations(env, [liveSpot()], now);
    const history = [
      ...Array.from({ length: 101 }, (_, index) => ({
        ...historyRow(`N1POST${index}`, 12), qso_date: "20260920",
      })),
      { ...historyRow("N1LATE", 12), qso_date: "20260913" },
    ];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/US-7971")) return Response.json([]);
      const count = url.searchParams.get("count");
      return Response.json(count === "all" ? history : history.slice(0, Number(count ?? 100)));
    });

    await expect(runPotaHistoryReconciliation(env, {
      fetcher: fetcher as typeof fetch,
      now: () => now,
    })).resolves.toMatchObject({
      acquired: true, deep: false, attempted: 20, succeeded: 20, evidenceRows: 1,
    });
    const projection = await getPublicPotaParkStatus(env, now);
    expect(projection.parks.find((park) => park.reference === "US-7971")).toMatchObject({
      status: "confirmed",
      confirmations: [{ activeCallsign: "N1LATE", qsoDate: "20260913", totalQsos: 12 }],
    });
  });

  it("uses leases/backoff and completes organizer-triggered deep reconciliation in batches", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    expect(consoleError).toHaveBeenCalledTimes(20);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"event":"pota-history-reconciliation-park-failed"'),
    );

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
    upstreamCount: null,
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

async function seedLiveCache(
  DB: D1Database,
  fetchedAt: Date,
  spots: LivePotaSpot[] = [liveSpot()],
) {
  await DB.prepare(
    `UPDATE pota_spots_cache SET payload_json = ?, fetched_at = ? WHERE id = 'ri-live-spots'`,
  ).bind(JSON.stringify(spots), fetchedAt.valueOf()).run();
}
