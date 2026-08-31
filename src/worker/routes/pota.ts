import {
  normalizeRiPotaSpots,
  type LivePotaSpot,
} from "../../lib/pota/spots";
import { riReferences as references } from "../../lib/pota/catalog";
import type { Env } from "../env";
import { json } from "../http";
import { isSpotCaptureTime } from "../../lib/activate-ri/pota-event";
import { persistEventSpotObservations } from "../pota-event";
import { logWorkerError } from "../logging";

const upstreamSpotsUrl = "https://api.pota.app/spot/activator";
const cacheId = "ri-live-spots";
const freshnessMilliseconds = 60_000;
const maximumStaleMilliseconds = 15 * 60_000;
const refreshLeaseMilliseconds = 30_000;
const upstreamTimeoutMilliseconds = 10_000;
const refreshWaitCheckpointsMilliseconds = [1_000, 3_000, 6_000, 10_000];
const initialRetryMilliseconds = 60_000;
const maximumRetryMilliseconds = 10 * 60_000;
const parkNames = new Map(
  references.map((reference) => [reference.reference, reference.name]),
);
const parkLocations = new Map(
  references.map((reference) => [reference.reference, reference.locationDesc]),
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
  sleep?: (milliseconds: number) => Promise<void>;
};

export type RiPotaSpotsSnapshot = {
  generatedAt: string;
  stale: boolean;
  spots: LivePotaSpot[];
};

export type RiPotaSpotsSnapshotResult =
  | {
      ok: true;
      snapshot: RiPotaSpotsSnapshot;
      fetchedAt: number;
      observedAt: number;
    }
  | {
      ok: false;
      retryAfterSeconds: number;
    };

export async function handlePotaSpots(
  request: Request,
  env: Pick<Env, "DB"> & Partial<Pick<Env, "ACTIVATE_RI_EVENT_ID">>,
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

  const result = await getRiPotaSpotsSnapshot(env, options);
  if (!result.ok) {
    return unavailableResponse(result.retryAfterSeconds);
  }

  if (env.ACTIVATE_RI_EVENT_ID && isSpotCaptureTime(new Date(result.observedAt))) {
    const persistence = persistEventSpotObservations(
      env as Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
      result.snapshot.spots,
      new Date(result.observedAt),
    );
    if (ctx) ctx.waitUntil(persistence);
    else await persistence;
  }

  return cacheResponse(
    cache,
    cacheKey,
    snapshotResponse(result),
    ctx,
  );
}

export async function getRiPotaSpotsSnapshot(
  env: Pick<Env, "DB">,
  options: PotaSpotsHandlerOptions = {},
): Promise<RiPotaSpotsSnapshotResult> {
  const now = options.now ?? (() => new Date());
  const requestTime = now().valueOf();

  const row = await readCacheRow(env);
  const snapshot = storedSnapshot(row);
  if (snapshot && snapshotIsFresh(snapshot, requestTime)) {
    return availableSnapshot(snapshot, requestTime, false);
  }

  const lease = await acquireRefreshLease(env, row, requestTime);
  const staleIsSafe = snapshot && snapshotIsSafeToDisplay(snapshot, requestTime);

  if (lease) {
    const refreshedSnapshot = await refreshSnapshot(
      env,
      lease,
      options.fetcher ?? fetch,
      now,
    );
    const responseTime = now().valueOf();
    if (refreshedSnapshot) {
      return availableSnapshot(refreshedSnapshot, responseTime, false);
    }

    if (snapshot && snapshotIsSafeToDisplay(snapshot, responseTime)) {
      return availableSnapshot(snapshot, responseTime, true);
    }

    return { ok: false, retryAfterSeconds: 60 };
  }

  const refreshMayBeInProgress = row.refresh_lease_until > requestTime ||
    row.retry_after <= requestTime;
  if (!refreshMayBeInProgress) {
    return staleIsSafe
      ? availableSnapshot(snapshot, requestTime, true)
      : {
          ok: false,
          retryAfterSeconds: retryAfterSeconds(row, requestTime),
        };
  }

  const latestRow = await waitForRefreshCompletion(
    env,
    row.fetched_at,
    options.sleep ?? sleep,
  );
  const latestSnapshot = storedSnapshot(latestRow);
  const responseTime = now().valueOf();
  if (latestSnapshot && snapshotIsFresh(latestSnapshot, responseTime)) {
    return availableSnapshot(latestSnapshot, responseTime, false);
  }
  if (latestSnapshot && snapshotIsSafeToDisplay(latestSnapshot, responseTime)) {
    return availableSnapshot(latestSnapshot, responseTime, true);
  }

  return {
    ok: false,
    retryAfterSeconds: retryAfterSeconds(latestRow, responseTime),
  };
}

async function waitForRefreshCompletion(
  env: Pick<Env, "DB">,
  previousFetchedAt: number | null,
  wait: (milliseconds: number) => Promise<void>,
): Promise<PotaCacheRow> {
  let previousCheckpoint = 0;
  let latestRow: PotaCacheRow | undefined;

  for (const checkpoint of refreshWaitCheckpointsMilliseconds) {
    await wait(checkpoint - previousCheckpoint);
    previousCheckpoint = checkpoint;
    latestRow = await readCacheRow(env);
    if (
      latestRow.fetched_at !== previousFetchedAt ||
      latestRow.refresh_lease_until === 0
    ) {
      return latestRow;
    }
  }

  return latestRow as PotaCacheRow;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
      spots: normalizeRiPotaSpots(upstreamData, { parkNames, parkLocations }),
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
  } catch (error) {
    const failureTime = now().valueOf();
    const retryMilliseconds = Math.min(
      initialRetryMilliseconds * (2 ** lease.consecutiveFailures),
      maximumRetryMilliseconds,
    );
    logWorkerError("pota-spots-refresh-failed", error, {
      consecutiveFailures: lease.consecutiveFailures,
      retryMilliseconds,
    });
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

function availableSnapshot(
  snapshot: StoredSnapshot,
  now: number,
  stale: boolean,
): RiPotaSpotsSnapshotResult {
  return {
    ok: true,
    fetchedAt: snapshot.fetchedAt,
    observedAt: now,
    snapshot: {
      generatedAt: new Date(snapshot.fetchedAt).toISOString(),
      stale,
      spots: unexpiredSpots(snapshot, now),
    },
  };
}

function snapshotResponse(result: Extract<RiPotaSpotsSnapshotResult, { ok: true }>): Response {
  return json(
    {
      ok: true,
      ...result.snapshot,
    },
    {
      headers: {
        "cache-control": result.snapshot.stale
          ? "no-store"
          : freshCacheControl(result.fetchedAt, result.observedAt),
        "x-content-type-options": "nosniff",
        "x-ripota-pota-fetched-at": String(result.fetchedAt),
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

function freshCacheControl(fetchedAt: number, now: number): string {
  const remainingSeconds = Math.floor(
    (fetchedAt + freshnessMilliseconds - now) / 1_000,
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
