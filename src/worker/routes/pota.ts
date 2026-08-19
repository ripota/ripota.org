import references from "../../data/ri-references.json";
import {
  normalizeRiPotaSpots,
  type LivePotaSpot,
} from "../../lib/pota/spots";
import type { Env } from "../env";
import { json } from "../http";

const upstreamSpotsUrl = "https://api.pota.app/spot/activator";
const cacheId = "ri-live-spots";
const freshnessMilliseconds = 60_000;
const maximumStaleMilliseconds = 15 * 60_000;
const refreshLeaseMilliseconds = 30_000;
const upstreamTimeoutMilliseconds = 10_000;
const initialRetryMilliseconds = 60_000;
const maximumRetryMilliseconds = 10 * 60_000;
const parkNames = new Map(
  references.map((reference) => [reference.reference, reference.name]),
);

type WorkerCacheStorage = CacheStorage & { default?: Cache };

type PotaCacheRow = {
  payload_json: string | null;
  fetched_at: number | null;
  refresh_lease_until: number;
  retry_after: number;
  consecutive_failures: number;
};

type StoredSnapshot = {
  spots: LivePotaSpot[];
  fetchedAt: number;
};

type RefreshLease = {
  token: string;
  consecutiveFailures: number;
};

export type PotaSpotsHandlerOptions = {
  fetcher?: typeof fetch;
  now?: () => Date;
};

export async function handlePotaSpots(
  request: Request,
  env: Pick<Env, "DB">,
  ctx?: ExecutionContext,
  options: PotaSpotsHandlerOptions = {},
): Promise<Response> {
  const now = options.now ?? (() => new Date());
  const requestTime = now().valueOf();
  const cache = (globalThis.caches as WorkerCacheStorage | undefined)?.default;
  const cacheKey = potaSpotsCacheKey(request);

  if (cache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse && cachedResponseIsFresh(cachedResponse, requestTime)) {
      return cachedResponse;
    }
  }

  const row = await readCacheRow(env);
  const snapshot = storedSnapshot(row);
  if (snapshot && snapshotIsFresh(snapshot, requestTime)) {
    return cacheResponse(
      cache,
      cacheKey,
      snapshotResponse(snapshot, requestTime, false),
      ctx,
    );
  }

  const lease = await acquireRefreshLease(env, row, requestTime);
  const staleIsSafe = snapshot && snapshotIsSafeToDisplay(snapshot, requestTime);

  if (staleIsSafe) {
    if (lease) {
      const refresh = refreshSnapshot(env, lease, options.fetcher ?? fetch, now);
      if (ctx) {
        ctx.waitUntil(refresh);
      } else {
        void refresh.catch(() => undefined);
      }
    }

    return snapshotResponse(snapshot, requestTime, true);
  }

  if (!lease) {
    const latestRow = await readCacheRow(env);
    const latestSnapshot = storedSnapshot(latestRow);
    if (latestSnapshot && snapshotIsFresh(latestSnapshot, requestTime)) {
      return cacheResponse(
        cache,
        cacheKey,
        snapshotResponse(latestSnapshot, requestTime, false),
        ctx,
      );
    }
    if (latestSnapshot && snapshotIsSafeToDisplay(latestSnapshot, requestTime)) {
      return snapshotResponse(latestSnapshot, requestTime, true);
    }

    return unavailableResponse(retryAfterSeconds(latestRow, requestTime));
  }

  const refreshedSnapshot = await refreshSnapshot(
    env,
    lease,
    options.fetcher ?? fetch,
    now,
  );
  if (!refreshedSnapshot) {
    return unavailableResponse();
  }

  const responseTime = now().valueOf();
  return cacheResponse(
    cache,
    cacheKey,
    snapshotResponse(refreshedSnapshot, responseTime, false),
    ctx,
  );
}

async function readCacheRow(env: Pick<Env, "DB">): Promise<PotaCacheRow> {
  const row = await env.DB.prepare(
    `SELECT payload_json, fetched_at, refresh_lease_until, retry_after,
      consecutive_failures
    FROM pota_spots_cache
    WHERE id = ?`,
  ).bind(cacheId).first<PotaCacheRow>();

  if (!row) {
    throw new Error("POTA spots cache row is missing.");
  }

  return row;
}

function storedSnapshot(row: PotaCacheRow): StoredSnapshot | null {
  if (!row.payload_json || !Number.isFinite(row.fetched_at)) {
    return null;
  }

  try {
    const spots = JSON.parse(row.payload_json) as unknown;
    return Array.isArray(spots)
      ? { spots: spots as LivePotaSpot[], fetchedAt: row.fetched_at as number }
      : null;
  } catch {
    return null;
  }
}

function snapshotIsFresh(snapshot: StoredSnapshot, now: number): boolean {
  const age = now - snapshot.fetchedAt;
  return age >= 0 && age < freshnessMilliseconds;
}

function snapshotIsSafeToDisplay(snapshot: StoredSnapshot, now: number): boolean {
  const age = now - snapshot.fetchedAt;
  return age >= 0 && age <= maximumStaleMilliseconds;
}

async function acquireRefreshLease(
  env: Pick<Env, "DB">,
  row: PotaCacheRow,
  now: number,
): Promise<RefreshLease | null> {
  if (row.refresh_lease_until > now || row.retry_after > now) {
    return null;
  }

  const token = crypto.randomUUID();
  const acquired = await env.DB.prepare(
    `UPDATE pota_spots_cache
    SET refresh_lease_token = ?, refresh_lease_until = ?
    WHERE id = ?
      AND refresh_lease_until <= ?
      AND retry_after <= ?
      AND fetched_at IS ?
    RETURNING consecutive_failures`,
  ).bind(
    token,
    now + refreshLeaseMilliseconds,
    cacheId,
    now,
    now,
    row.fetched_at,
  ).first<{ consecutive_failures: number }>();

  return acquired
    ? { token, consecutiveFailures: acquired.consecutive_failures }
    : null;
}

async function refreshSnapshot(
  env: Pick<Env, "DB">,
  lease: RefreshLease,
  fetcher: typeof fetch,
  now: () => Date,
): Promise<StoredSnapshot | null> {
  try {
    const upstreamResponse = await fetcher(upstreamSpotsUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "ripota.org live Rhode Island POTA spots",
      },
      signal: AbortSignal.timeout(upstreamTimeoutMilliseconds),
    });
    if (!upstreamResponse.ok) {
      throw new Error(`POTA spots responded with ${upstreamResponse.status}.`);
    }

    const upstreamData: unknown = await upstreamResponse.json();
    if (!Array.isArray(upstreamData)) {
      throw new Error("POTA spots returned an unexpected payload.");
    }

    const snapshot = {
      spots: normalizeRiPotaSpots(upstreamData, { parkNames }),
      fetchedAt: now().valueOf(),
    };
    const stored = await env.DB.prepare(
      `UPDATE pota_spots_cache
      SET payload_json = ?, fetched_at = ?, refresh_lease_token = NULL,
        refresh_lease_until = 0, retry_after = 0, consecutive_failures = 0,
        last_error_at = NULL
      WHERE id = ? AND refresh_lease_token = ?`,
    ).bind(
      JSON.stringify(snapshot.spots),
      snapshot.fetchedAt,
      cacheId,
      lease.token,
    ).run();

    if (stored.meta.changes !== 1) {
      return null;
    }

    return snapshot;
  } catch {
    const failureTime = now().valueOf();
    const retryMilliseconds = Math.min(
      initialRetryMilliseconds * (2 ** lease.consecutiveFailures),
      maximumRetryMilliseconds,
    );
    await env.DB.prepare(
      `UPDATE pota_spots_cache
      SET refresh_lease_token = NULL, refresh_lease_until = 0,
        retry_after = ?, consecutive_failures = consecutive_failures + 1,
        last_error_at = ?
      WHERE id = ? AND refresh_lease_token = ?`,
    ).bind(
      failureTime + retryMilliseconds,
      failureTime,
      cacheId,
      lease.token,
    ).run();

    return null;
  }
}

function snapshotResponse(
  snapshot: StoredSnapshot,
  now: number,
  stale: boolean,
): Response {
  return json(
    {
      ok: true,
      generatedAt: new Date(snapshot.fetchedAt).toISOString(),
      stale,
      spots: unexpiredSpots(snapshot, now),
    },
    {
      headers: {
        "cache-control": stale ? "no-store" : freshCacheControl(snapshot, now),
        "x-content-type-options": "nosniff",
        "x-ripota-pota-fetched-at": String(snapshot.fetchedAt),
      },
    },
  );
}

function unexpiredSpots(snapshot: StoredSnapshot, now: number): LivePotaSpot[] {
  const elapsedSeconds = Math.max(0, Math.floor((now - snapshot.fetchedAt) / 1_000));

  return snapshot.spots.flatMap((spot) => {
    if (spot.expiresInSeconds === null) {
      return [spot];
    }

    const expiresInSeconds = spot.expiresInSeconds - elapsedSeconds;
    return expiresInSeconds > 0 ? [{ ...spot, expiresInSeconds }] : [];
  });
}

function freshCacheControl(snapshot: StoredSnapshot, now: number): string {
  const remainingSeconds = Math.floor(
    (snapshot.fetchedAt + freshnessMilliseconds - now) / 1_000,
  );
  if (remainingSeconds <= 0) {
    return "no-store";
  }

  return `public, max-age=${Math.min(30, remainingSeconds)}, s-maxage=${remainingSeconds}`;
}

function cachedResponseIsFresh(response: Response, now: number): boolean {
  const fetchedAt = Number(response.headers.get("x-ripota-pota-fetched-at"));
  return Number.isFinite(fetchedAt) && now >= fetchedAt &&
    now - fetchedAt < freshnessMilliseconds;
}

async function cacheResponse(
  cache: Cache | undefined,
  cacheKey: Request,
  response: Response,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (!cache || response.headers.get("cache-control") === "no-store") {
    return response;
  }

  const cachePut = cache.put(cacheKey, response.clone());
  if (ctx) {
    ctx.waitUntil(cachePut);
  } else {
    await cachePut;
  }

  return response;
}

function potaSpotsCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url.origin + "/api/pota/spots", {
    headers: { accept: "application/json" },
  });
}

function retryAfterSeconds(row: PotaCacheRow, now: number): number {
  const nextAttempt = Math.max(row.refresh_lease_until, row.retry_after);
  return Math.max(1, Math.ceil((nextAttempt - now) / 1_000));
}

function unavailableResponse(retryAfter = 60): Response {
  return json(
    { ok: false, error: "Live POTA spots are temporarily unavailable." },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(retryAfter),
        "x-content-type-options": "nosniff",
      },
    },
  );
}
