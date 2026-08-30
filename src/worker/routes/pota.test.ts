import { afterEach, describe, expect, it, vi } from "vitest";
import type { LivePotaSpot } from "../../lib/pota/spots";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import { handlePotaSpots } from "./pota";

const fetchedAt = Date.parse("2026-08-19T14:00:00.000Z");
let cleanup: (() => void) | undefined;

function request(headers?: HeadersInit): Request {
  return new Request("https://ripota.org/api/pota/spots", { headers });
}

function upstreamSpot(overrides: Record<string, unknown> = {}) {
  return {
    spotId: 1,
    activator: "N1BS",
    frequency: "14052.0",
    mode: "CW",
    reference: "US-10545",
    name: "Hillsdale Preserve Management Area",
    spotTime: "2026-08-19T13:57:46",
    spotter: "KW7MM-#",
    comments: "RBN 5 dB",
    source: "RBN",
    invalid: null,
    expire: 561,
    ...overrides,
  };
}

function storedSpot(overrides: Partial<LivePotaSpot> = {}): LivePotaSpot {
  return {
    id: "1",
    parkReference: "US-10545",
    parkName: "Hillsdale Preserve Management Area",
    activatorCallsign: "N1BS",
    frequency: "14052.0",
    mode: "CW",
    spotTime: "2026-08-19T13:57:46",
    spotterCallsign: "KW7MM-#",
    comments: "RBN 5 dB",
    sourceLabel: "RBN",
    locationDesc: "US-RI",
    expiresInSeconds: 561,
    parkUrl: "https://pota.app/#/park/US-10545",
    spotsUrl: "https://pota.app/",
    ...overrides,
  };
}

async function seedSnapshot(
  DB: D1Database,
  timestamp: number,
  spots: LivePotaSpot[] = [storedSpot()],
): Promise<void> {
  await DB.prepare(
    `UPDATE pota_spots_cache
    SET payload_json = ?, fetched_at = ?, refresh_lease_token = NULL,
      refresh_lease_until = 0, retry_after = 0, consecutive_failures = 0`,
  ).bind(JSON.stringify(spots), timestamp).run();
}

describe("handlePotaSpots", () => {
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
  });

  it("fills an empty D1 cache from POTA and reuses it for one minute", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const fetcher = vi.fn(async () => Response.json([
      upstreamSpot(),
      upstreamSpot({ spotId: 2, reference: "US-9999", name: "Outside RI" }),
    ]));

    const firstResponse = await handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now: () => new Date(fetchedAt) },
    );
    const firstData = await firstResponse.json() as {
      generatedAt: string;
      stale: boolean;
      spots: LivePotaSpot[];
    };

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe(
      "public, max-age=30, s-maxage=60",
    );
    expect(firstData).toMatchObject({
      generatedAt: "2026-08-19T14:00:00.000Z",
      stale: false,
      spots: [{ parkReference: "US-10545", activatorCallsign: "N1BS" }],
    });

    const secondResponse = await handlePotaSpots(
      request({ "cache-control": "no-cache" }),
      database,
      undefined,
      { fetcher, now: () => new Date(fetchedAt + 30_000) },
    );
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get("cache-control")).toBe(
      "public, max-age=30, s-maxage=30",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("coalesces stale requests and returns the shared refreshed snapshot", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    await seedSnapshot(database.DB, fetchedAt);
    let resolveUpstream: ((response: Response) => void) | undefined;
    const upstream = new Promise<Response>((resolve) => {
      resolveUpstream = resolve;
    });
    const fetcher = vi.fn(() => upstream);
    const now = () => new Date(fetchedAt + 61_000);
    let releaseWaiter: (() => void) | undefined;
    const sleep = vi.fn((_milliseconds: number) => new Promise<void>((resolve) => {
      releaseWaiter = resolve;
    }));

    const firstResponsePromise = handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now },
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const secondResponsePromise = handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now, sleep },
    );
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(1_000));

    resolveUpstream?.(Response.json([upstreamSpot({ spotId: 3 })]));
    const firstResponse = await firstResponsePromise;
    releaseWaiter?.();
    const secondResponse = await secondResponsePromise;

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      stale: false,
      spots: [{ id: "3" }],
    });
    await expect(secondResponse.json()).resolves.toMatchObject({
      stale: false,
      spots: [{ id: "3" }],
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("checks an active refresh after one, three, six, and ten seconds", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    await seedSnapshot(database.DB, fetchedAt);
    await database.DB.prepare(
      `UPDATE pota_spots_cache
      SET refresh_lease_token = 'another-request', refresh_lease_until = ?`,
    ).bind(fetchedAt + 91_000).run();
    const sleep = vi.fn(async (_milliseconds: number) => undefined);

    const response = await handlePotaSpots(
      request(),
      database,
      undefined,
      {
        fetcher: vi.fn(),
        now: () => new Date(fetchedAt + 61_000),
        sleep,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ stale: true });
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      1_000,
      2_000,
      3_000,
      4_000,
    ]);
  });

  it("releases waiters at their next check when the POTA refresh fails", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    await seedSnapshot(database.DB, fetchedAt);
    let resolveUpstream: ((response: Response) => void) | undefined;
    const upstream = new Promise<Response>((resolve) => {
      resolveUpstream = resolve;
    });
    const fetcher = vi.fn(() => upstream);
    const now = () => new Date(fetchedAt + 61_000);
    let releaseWaiter: (() => void) | undefined;
    const sleep = vi.fn((_milliseconds: number) => new Promise<void>((resolve) => {
      releaseWaiter = resolve;
    }));

    const winnerResponsePromise = handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now },
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const waiterResponsePromise = handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now, sleep },
    );
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(1_000));

    resolveUpstream?.(new Response("bad gateway", { status: 503 }));
    const winnerResponse = await winnerResponsePromise;
    releaseWaiter?.();
    const waiterResponse = await waiterResponsePromise;

    await expect(winnerResponse.json()).resolves.toMatchObject({ stale: true });
    await expect(waiterResponse.json()).resolves.toMatchObject({ stale: true });
    expect(sleep).toHaveBeenCalledOnce();

    const cacheRow = await database.DB.prepare(
      `SELECT refresh_lease_token, refresh_lease_until, retry_after
      FROM pota_spots_cache WHERE id = 'ri-live-spots'`,
    ).first<{
      refresh_lease_token: string | null;
      refresh_lease_until: number;
      retry_after: number;
    }>();
    expect(cacheRow).toMatchObject({
      refresh_lease_token: null,
      refresh_lease_until: 0,
      retry_after: fetchedAt + 121_000,
    });
  });

  it("never returns a snapshot older than fifteen minutes", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    await seedSnapshot(database.DB, fetchedAt);
    const fetcher = vi.fn(async () => new Response("bad gateway", { status: 503 }));
    const now = () => new Date(fetchedAt + 15 * 60_000 + 1);

    const response = await handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Live POTA spots are temporarily unavailable.",
    });

    const retryResponse = await handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now },
    );
    expect(retryResponse.status).toBe(503);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("removes spots whose upstream expiry elapsed in an allowed stale snapshot", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    await seedSnapshot(database.DB, fetchedAt, [storedSpot({ expiresInSeconds: 30 })]);
    const fetcher = vi.fn(async () => new Response("bad gateway", { status: 503 }));
    const response = await handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now: () => new Date(fetchedAt + 61_000) },
    );

    await expect(response.json()).resolves.toMatchObject({
      stale: true,
      spots: [],
    });
  });

  it("does not let client cache headers bypass a fresh edge response", async () => {
    const cachedResponse = Response.json(
      {
        ok: true,
        generatedAt: new Date(fetchedAt).toISOString(),
        stale: false,
        spots: [],
      },
      { headers: { "x-ripota-pota-fetched-at": String(fetchedAt) } },
    );
    const match = vi.fn(async () => cachedResponse);
    vi.stubGlobal("caches", { default: { match, put: vi.fn() } });
    const fetcher = vi.fn();
    const DB = { prepare: vi.fn() } as unknown as D1Database;

    const response = await handlePotaSpots(
      request({ "cache-control": "no-cache" }),
      { DB },
      undefined,
      { fetcher, now: () => new Date(fetchedAt + 30_000) },
    );

    expect(response).toBe(cachedResponse);
    expect(match).toHaveBeenCalledOnce();
    expect(DB.prepare).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
