import { afterEach, describe, expect, it, vi } from "vitest";

import type { LivePotaSpot } from "../lib/pota/spots";
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
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json([historySpot()]));

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

    expect(fetcher).toHaveBeenCalledTimes(4);
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
      `SELECT active, last_live_count, consecutive_failures,
        declared_references_json
       FROM pota_spot_history_sync`,
    ).first()).resolves.toEqual({
      active: 0,
      last_live_count: 2,
      consecutive_failures: 0,
      declared_references_json: '["US-10544"]',
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
