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
    expiresInSeconds: 561,
    parkUrl: "https://pota.app/#/park/US-10545",
    spotsUrl: "https://pota.app/",
    ...overrides,
  };
}

function executionContext() {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        promises.push(promise);
      },
    } as unknown as ExecutionContext,
    promises,
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

  it("serves safe stale data while one lease winner refreshes it", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    await seedSnapshot(database.DB, fetchedAt);
    let resolveUpstream: ((response: Response) => void) | undefined;
    const upstream = new Promise<Response>((resolve) => {
      resolveUpstream = resolve;
    });
    const fetcher = vi.fn(() => upstream);
    const context = executionContext();
    const now = () => new Date(fetchedAt + 61_000);

    const [firstResponse, secondResponse] = await Promise.all([
      handlePotaSpots(request(), database, context.ctx, { fetcher, now }),
      handlePotaSpots(request(), database, context.ctx, { fetcher, now }),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");
    await expect(firstResponse.json()).resolves.toMatchObject({ stale: true });
    await expect(secondResponse.json()).resolves.toMatchObject({ stale: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(context.promises).toHaveLength(1);

    resolveUpstream?.(Response.json([upstreamSpot({ spotId: 3 })]));
    await Promise.all(context.promises);

    const refreshedResponse = await handlePotaSpots(
      request(),
      database,
      undefined,
      { fetcher, now: () => new Date(fetchedAt + 62_000) },
    );
    await expect(refreshedResponse.json()).resolves.toMatchObject({
      stale: false,
      spots: [{ id: "3" }],
    });
    expect(fetcher).toHaveBeenCalledOnce();
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
    const context = executionContext();

    const response = await handlePotaSpots(
      request(),
      database,
      context.ctx,
      { fetcher, now: () => new Date(fetchedAt + 61_000) },
    );

    await expect(response.json()).resolves.toMatchObject({
      stale: true,
      spots: [],
    });
    await Promise.all(context.promises);
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
