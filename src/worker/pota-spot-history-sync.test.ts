import { afterEach, describe, expect, it, vi } from "vitest";

import type { LivePotaSpot } from "../lib/pota/spots";
import { persistPotaSpotHistory } from "./pota-spot-history";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";
import { syncPotaSpotHistories } from "./pota-spot-history-sync";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

describe("POTA spot history synchronization", () => {
  it("hydrates new, changed, periodic, and ended activations without polling every minute", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const start = Date.parse("2026-09-04T12:00:00Z");
    let historyFetches = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => {
      historyFetches += 1;
      return Response.json(historyFetches === 5
        ? [historySpot(), lateHistorySpot()]
        : [historySpot()]);
    });

    await expect(syncPotaSpotHistories(database, [liveSpot()], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start),
    })).resolves.toMatchObject({ attempted: 1, succeeded: 1, observations: 1 });

    await expect(syncPotaSpotHistories(database, [liveSpot()], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 60_000),
    })).resolves.toMatchObject({ attempted: 0 });

    await expect(syncPotaSpotHistories(database, [liveSpot({ upstreamCount: 2 })], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 2 * 60_000),
    })).resolves.toMatchObject({ attempted: 1 });

    await expect(syncPotaSpotHistories(database, [liveSpot({ upstreamCount: 2 })], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 12 * 60_000),
    })).resolves.toMatchObject({ attempted: 1 });

    await expect(syncPotaSpotHistories(database, [], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 13 * 60_000),
    })).resolves.toMatchObject({ attempted: 1 });
    await expect(syncPotaSpotHistories(database, [], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 14 * 60_000),
    })).resolves.toMatchObject({ attempted: 0 });
    await expect(syncPotaSpotHistories(database, [], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 18 * 60_000),
    })).resolves.toMatchObject({
      attempted: 1,
      postCloseAttempted: 1,
      succeeded: 1,
    });
    await expect(syncPotaSpotHistories(database, [], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 19 * 60_000),
    })).resolves.toMatchObject({ attempted: 0 });

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.pota.app/spot/comments/N1BS/US-10545",
    );
    await expect(database.DB.prepare(
      `SELECT spotter_callsign, comments, source_label
       FROM pota_spot_observations WHERE source_spot_id = 'history-1'`,
    ).first()).resolves.toEqual({
      spotter_callsign: "N1BS",
      comments: "CW 2-fer: US-10545 US-10544",
      source_label: "Ham2K Portable Logger",
    });
    await expect(database.DB.prepare(
      `SELECT spotter_callsign, comments, source_label
       FROM pota_spot_observations WHERE source_spot_id = 'history-late'`,
    ).first()).resolves.toEqual({
      spotter_callsign: "W1AW",
      comments: "Late manual report",
      source_label: "Web",
    });
    await expect(database.DB.prepare(
      `SELECT active, last_live_count, consecutive_failures,
        declared_references_json, post_close_sync_at
       FROM pota_spot_history_sync`,
    ).first()).resolves.toEqual({
      active: 0,
      last_live_count: 2,
      consecutive_failures: 0,
      declared_references_json: '["US-10544"]',
      post_close_sync_at: start + 18 * 60_000,
    });
  });

  it("backs off failed pairs and retries them after the delay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const start = Date.parse("2026-09-04T12:00:00Z");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json([historySpot()]))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 503 }))
      .mockResolvedValueOnce(Response.json([historySpot()]));

    await expect(syncPotaSpotHistories(database, [liveSpot()], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start),
    })).resolves.toMatchObject({ attempted: 1, succeeded: 1 });
    await expect(syncPotaSpotHistories(database, [liveSpot({ upstreamCount: 2 })], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 60_000),
    })).resolves.toMatchObject({ attempted: 1, failed: 1 });
    await expect(syncPotaSpotHistories(database, [liveSpot({ upstreamCount: 2 })], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 90_000),
    })).resolves.toMatchObject({ attempted: 0 });
    await expect(syncPotaSpotHistories(database, [liveSpot({ upstreamCount: 2 })], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(start + 121_000),
    })).resolves.toMatchObject({ attempted: 1, succeeded: 1 });

    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(database.DB.prepare(
      "SELECT consecutive_failures, retry_after FROM pota_spot_history_sync",
    ).first()).resolves.toEqual({ consecutive_failures: 0, retry_after: 0 });
  });

  it("seeds retained pairs for one backfill without replacing existing sync state", async () => {
    const database = createMigratedSqliteD1({
      through: "0020_pota_declared_nfer_evidence.sql",
    });
    cleanup = database.close;
    const firstSeen = new Date("2026-09-04T11:45:00Z");
    const lastSeen = new Date("2026-09-04T13:39:00Z");
    await persistPotaSpotHistory(database, [liveSpot({
      id: "retained-1",
      spotTime: firstSeen.toISOString(),
    })], firstSeen);
    await persistPotaSpotHistory(database, [liveSpot({
      id: "retained-2",
      spotTime: lastSeen.toISOString(),
    })], lastSeen);
    await persistPotaSpotHistory(database, [liveSpot({
      id: "existing-1",
      activatorCallsign: "KC1ZEW",
      parkReference: "US-2878",
      parkName: "Lincoln Woods State Park",
      spotTime: lastSeen.toISOString(),
    })], lastSeen);
    const existingSyncAt = Date.parse("2026-09-04T13:59:00Z");
    await database.DB.prepare(
      `INSERT INTO pota_spot_history_sync (
         activator_callsign, park_reference, first_seen_at, last_seen_at,
         active, last_history_sync_at, declared_references_json
       ) VALUES ('KC1ZEW', 'US-2878', ?, ?, 0, ?, '["US-5483"]')`,
    ).bind(lastSeen.valueOf(), lastSeen.valueOf(), existingSyncAt).run();

    database.applyMigrationFile("0021_pota_post_close_history_sync.sql");

    await expect(database.DB.prepare(
      `SELECT first_seen_at, last_seen_at, active, last_history_sync_at,
        post_close_sync_at
       FROM pota_spot_history_sync
       WHERE activator_callsign = 'N1BS' AND park_reference = 'US-10545'`,
    ).first()).resolves.toEqual({
      first_seen_at: firstSeen.valueOf(),
      last_seen_at: lastSeen.valueOf(),
      active: 0,
      last_history_sync_at: null,
      post_close_sync_at: null,
    });
    await expect(database.DB.prepare(
      `SELECT active, last_history_sync_at, declared_references_json
       FROM pota_spot_history_sync
       WHERE activator_callsign = 'KC1ZEW' AND park_reference = 'US-2878'`,
    ).first()).resolves.toEqual({
      active: 0,
      last_history_sync_at: existingSyncAt,
      declared_references_json: '["US-5483"]',
    });

    const fetcher = vi.fn(async () => Response.json([historySpot()]));
    const backfillAt = Date.parse("2026-09-04T14:00:00Z");
    await expect(syncPotaSpotHistories(database, [], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(backfillAt),
    })).resolves.toMatchObject({
      attempted: 1,
      backfillAttempted: 1,
      succeeded: 1,
      observations: 1,
    });
    await expect(database.DB.prepare(
      `SELECT active, last_history_sync_at, post_close_sync_at,
        declared_references_json
       FROM pota_spot_history_sync
       WHERE activator_callsign = 'N1BS' AND park_reference = 'US-10545'`,
    ).first()).resolves.toEqual({
      active: 0,
      last_history_sync_at: backfillAt,
      post_close_sync_at: backfillAt,
      declared_references_json: '["US-10544"]',
    });

    await expect(syncPotaSpotHistories(database, [], {
      fetcher: fetcher as typeof fetch,
      now: () => new Date(backfillAt + 60_000),
    })).resolves.toMatchObject({ attempted: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("processes every due pair while limiting simultaneous requests", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    let active = 0;
    let maximumActive = 0;
    const fetcher = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return Response.json([]);
    });
    const spots = Array.from({ length: 7 }, (_, index) =>
      liveSpot({ activatorCallsign: `N1BS${index}` })
    );

    await expect(syncPotaSpotHistories(database, spots, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-09-04T12:00:00Z"),
    })).resolves.toMatchObject({ attempted: 7, succeeded: 7 });
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(maximumActive).toBeLessThanOrEqual(5);
  });
});

function liveSpot(overrides: Partial<LivePotaSpot> = {}): LivePotaSpot {
  return {
    id: "live-1",
    parkReference: "US-10545",
    parkName: "Hillsdale Preserve Management Area",
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
    parkUrl: "https://pota.app/#/park/US-10545",
    spotsUrl: "https://pota.app/",
    ...overrides,
  };
}

function historySpot(): Record<string, unknown> {
  return {
    spotId: "history-1",
    spotTime: "2026-09-04T11:45:28",
    spotter: "N1BS",
    mode: "CW",
    frequency: "7054",
    source: "Ham2K Portable Logger",
    comments: "CW 2-fer: US-10545 US-10544",
  };
}

function lateHistorySpot(): Record<string, unknown> {
  return {
    spotId: "history-late",
    spotTime: "2026-09-04T12:17:49",
    spotter: "W1AW",
    mode: "CW",
    frequency: "7054",
    source: "Web",
    comments: "Late manual report",
  };
}
