import { references } from "@ripota/parks";

import {
  normalizePotaSpotHistory,
  potaSpotReferenceEvidence,
  type LivePotaSpot,
} from "../lib/pota/spots";
import { isSpotCaptureTime } from "../lib/activate-ri/pota-event";
import type { Env } from "./env";
import { logWorkerError } from "./logging";
import { persistEventSpotObservations } from "./pota-event";
import { persistPotaSpotHistory } from "./pota-spot-history";

const collectionStateId = "ri-live-spots";
const safetySyncIntervalMilliseconds = 10 * 60_000;
const postCloseSyncDelayMilliseconds = 5 * 60_000;
const syncLeaseMilliseconds = 2 * 60_000;
const upstreamTimeoutMilliseconds = 10_000;
const historyConcurrency = 5;
const initialRetryMilliseconds = 60_000;
const maximumRetryMilliseconds = 10 * 60_000;
const parkNames = new Map(references.map((park) => [park.reference, park.name]));

type HistorySyncRow = {
  activator_callsign: string;
  park_reference: string;
  first_seen_at: number;
  last_seen_at: number;
  last_live_spot_id: string;
  last_live_count: number | null;
  active: number;
  last_history_sync_at: number | null;
  retry_after: number;
  consecutive_failures: number;
  declared_references_json: string;
  post_close_sync_at: number | null;
};

type HistoryTarget = {
  activatorCallsign: string;
  parkReference: string;
  parkName: string;
  live: boolean;
  phase: "live" | "close" | "post_close" | "backfill";
  currentSpot?: LivePotaSpot;
};

type HistoryOutcome = {
  target: HistoryTarget;
  spots: LivePotaSpot[];
  error: unknown | null;
};

export type PotaSpotHistorySyncResult = {
  acquired: boolean;
  considered: number;
  attempted: number;
  succeeded: number;
  failed: number;
  observations: number;
  liveAttempted: number;
  closeAttempted: number;
  postCloseAttempted: number;
  backfillAttempted: number;
};

export type PotaSpotHistorySyncOptions = {
  fetcher?: typeof fetch;
  now?: () => Date;
};

export async function syncPotaSpotHistories(
  env: Pick<Env, "DB"> & Partial<Pick<Env, "ACTIVATE_RI_EVENT_ID">>,
  liveSpots: readonly LivePotaSpot[],
  options: PotaSpotHistorySyncOptions = {},
): Promise<PotaSpotHistorySyncResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().valueOf();
  const leaseToken = crypto.randomUUID();
  const lease = await env.DB.prepare(
    `UPDATE pota_spot_collection_state
     SET history_lease_token = ?, history_lease_until = ?
     WHERE id = ? AND history_lease_until <= ?
     RETURNING id`,
  ).bind(
    leaseToken,
    startedAt + syncLeaseMilliseconds,
    collectionStateId,
    startedAt,
  ).first<{ id: string }>();
  if (!lease) return emptyResult(false, 0);

  try {
    const existingResult = await env.DB.prepare(
      `SELECT activator_callsign, park_reference, first_seen_at, last_seen_at,
        last_live_spot_id, last_live_count, active, last_history_sync_at,
        retry_after, consecutive_failures, declared_references_json,
        post_close_sync_at
       FROM pota_spot_history_sync`,
    ).all<HistorySyncRow>();
    const existing = new Map((existingResult.results ?? []).map((row) => [pairKey(row), row]));
    const current = uniqueLivePairs(liveSpots);

    if (current.length > 0) {
      await env.DB.batch(current.map((spot) => env.DB.prepare(
        `INSERT INTO pota_spot_history_sync (
           activator_callsign, park_reference, first_seen_at, last_seen_at,
           last_live_spot_id, last_live_count, active
         ) VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(activator_callsign, park_reference) DO UPDATE SET
           first_seen_at = CASE
             WHEN pota_spot_history_sync.active = 0 THEN excluded.first_seen_at
             ELSE pota_spot_history_sync.first_seen_at
           END,
           last_seen_at = excluded.last_seen_at,
           active = 1,
           last_history_sync_at = CASE
             WHEN pota_spot_history_sync.active = 0 THEN NULL
             ELSE pota_spot_history_sync.last_history_sync_at
           END,
           declared_references_json = CASE
             WHEN pota_spot_history_sync.active = 0 THEN '[]'
             ELSE pota_spot_history_sync.declared_references_json
           END,
           post_close_sync_at = CASE
             WHEN pota_spot_history_sync.active = 0 THEN NULL
             ELSE pota_spot_history_sync.post_close_sync_at
           END`,
      ).bind(
        spot.activatorCallsign,
        spot.parkReference,
        startedAt,
        startedAt,
        spot.id,
        spot.upstreamCount,
      )));
    }

    const currentKeys = new Set(current.map((spot) => pairKey(spot)));
    const currentTargets = current.flatMap((spot) => {
      const row = existing.get(pairKey(spot));
      return historyIsDue(row, spot, startedAt)
        ? [{
            activatorCallsign: spot.activatorCallsign,
            parkReference: spot.parkReference,
            parkName: spot.parkName,
            live: true,
            phase: "live" as const,
            currentSpot: spot,
          }]
        : [];
    });
    const inactiveTargets = [...existing.values()].flatMap((row): HistoryTarget[] => {
      if (currentKeys.has(pairKey(row)) || row.retry_after > startedAt) return [];
      const base = {
        activatorCallsign: row.activator_callsign,
        parkReference: row.park_reference,
        parkName: parkNames.get(row.park_reference) ?? row.park_reference,
        live: false,
      };
      if (row.active === 1) return [{ ...base, phase: "close" }];
      if (row.post_close_sync_at !== null) return [];
      if (row.last_history_sync_at === null) return [{ ...base, phase: "backfill" }];
      return startedAt - row.last_history_sync_at >= postCloseSyncDelayMilliseconds
        ? [{ ...base, phase: "post_close" }]
        : [];
    });
    const targets = [...currentTargets, ...inactiveTargets];
    const outcomes: HistoryOutcome[] = await mapWithConcurrency(
      targets,
      historyConcurrency,
      async (target): Promise<HistoryOutcome> => {
        try {
          return {
            target,
            spots: await fetchPotaSpotHistory(options.fetcher ?? fetch, target),
            error: null,
          } satisfies HistoryOutcome;
        } catch (error) {
          logWorkerError("pota-spot-history-sync-failed", error, {
            activatorCallsign: target.activatorCallsign,
            parkReference: target.parkReference,
          });
          return { target, spots: [], error } satisfies HistoryOutcome;
        }
      },
    );

    const successful = outcomes.filter((outcome) => outcome.error === null);
    const historySpots = successful.flatMap((outcome) => outcome.spots);
    if (historySpots.length > 0) {
      await persistPotaSpotHistory(env, historySpots, new Date(startedAt));
      if (env.ACTIVATE_RI_EVENT_ID && isSpotCaptureTime(new Date(startedAt))) {
        await persistEventSpotObservations(
          env as Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
          historySpots,
          new Date(startedAt),
        );
      }
    }

    const stateUpdates = outcomes.map((outcome) => {
      if (outcome.error === null) {
        return env.DB.prepare(
          `UPDATE pota_spot_history_sync
           SET active = ?, last_history_sync_at = ?, retry_after = 0,
             consecutive_failures = 0, last_error_at = NULL,
             declared_references_json = ?,
             post_close_sync_at = CASE
               WHEN ? THEN ?
               WHEN ? THEN NULL
               ELSE post_close_sync_at
             END,
             last_live_spot_id = CASE WHEN ? THEN ? ELSE last_live_spot_id END,
             last_live_count = CASE WHEN ? THEN ? ELSE last_live_count END
           WHERE activator_callsign = ? AND park_reference = ?`,
        ).bind(
          outcome.target.live ? 1 : 0,
          startedAt,
          JSON.stringify(declaredReferences(outcome)),
          outcome.target.phase === "post_close" || outcome.target.phase === "backfill" ? 1 : 0,
          startedAt,
          outcome.target.live ? 1 : 0,
          outcome.target.live ? 1 : 0,
          outcome.target.currentSpot?.id ?? "",
          outcome.target.live ? 1 : 0,
          outcome.target.currentSpot?.upstreamCount ?? null,
          outcome.target.activatorCallsign,
          outcome.target.parkReference,
        );
      }
      const previousFailures = existing.get(pairKey(outcome.target))?.consecutive_failures ?? 0;
      const retryMilliseconds = Math.min(
        initialRetryMilliseconds * (2 ** previousFailures),
        maximumRetryMilliseconds,
      );
      return env.DB.prepare(
        `UPDATE pota_spot_history_sync
         SET retry_after = ?, consecutive_failures = consecutive_failures + 1,
           last_error_at = ?
         WHERE activator_callsign = ? AND park_reference = ?`,
      ).bind(
        startedAt + retryMilliseconds,
        startedAt,
        outcome.target.activatorCallsign,
        outcome.target.parkReference,
      );
    });
    if (stateUpdates.length > 0) await env.DB.batch(stateUpdates);

    return {
      acquired: true,
      considered: current.length + inactiveTargets.length,
      attempted: outcomes.length,
      succeeded: successful.length,
      failed: outcomes.length - successful.length,
      observations: historySpots.length,
      liveAttempted: countPhase(outcomes, "live"),
      closeAttempted: countPhase(outcomes, "close"),
      postCloseAttempted: countPhase(outcomes, "post_close"),
      backfillAttempted: countPhase(outcomes, "backfill"),
    };
  } finally {
    await env.DB.prepare(
      `UPDATE pota_spot_collection_state
       SET history_lease_token = NULL, history_lease_until = 0
       WHERE id = ? AND history_lease_token = ?`,
    ).bind(collectionStateId, leaseToken).run();
  }
}

function declaredReferences(outcome: HistoryOutcome): string[] {
  const spots = outcome.target.currentSpot
    ? [outcome.target.currentSpot, ...outcome.spots]
    : outcome.spots;
  return [...new Set(spots.flatMap((spot) =>
    potaSpotReferenceEvidence(spot)
      .filter((reference) => reference.kind === "declared_nfer")
      .map((reference) => reference.parkReference)
  ))].sort();
}

function historyIsDue(
  row: HistorySyncRow | undefined,
  spot: LivePotaSpot,
  now: number,
): boolean {
  if (!row) return true;
  if (row.retry_after > now) return false;
  if (row.active !== 1 || row.last_history_sync_at === null) return true;
  if (spot.upstreamCount !== null && spot.upstreamCount !== row.last_live_count) return true;
  if (spot.id !== row.last_live_spot_id && spot.sourceLabel.trim().toUpperCase() !== "RBN") return true;
  return now - row.last_history_sync_at >= safetySyncIntervalMilliseconds;
}

async function fetchPotaSpotHistory(
  fetcher: typeof fetch,
  target: HistoryTarget,
): Promise<LivePotaSpot[]> {
  const response = await fetcher(
    `https://api.pota.app/spot/comments/${encodeURIComponent(target.activatorCallsign)}/${encodeURIComponent(target.parkReference)}`,
    {
      headers: {
        accept: "application/json",
        "user-agent": "ripota.org Rhode Island POTA spot history",
      },
      signal: AbortSignal.timeout(upstreamTimeoutMilliseconds),
    },
  );
  if (!response.ok) throw new Error(`POTA spot history responded with ${response.status}.`);
  const value: unknown = await response.json();
  return normalizePotaSpotHistory(value, target);
}

function uniqueLivePairs(spots: readonly LivePotaSpot[]): LivePotaSpot[] {
  const pairs = new Map<string, LivePotaSpot>();
  for (const spot of spots) {
    const key = pairKey(spot);
    const existing = pairs.get(key);
    if (!existing || spot.spotTime > existing.spotTime) pairs.set(key, spot);
  }
  return [...pairs.values()];
}

function pairKey(value: {
  activatorCallsign?: string;
  parkReference?: string;
  activator_callsign?: string;
  park_reference?: string;
}): string {
  return `${value.activatorCallsign ?? value.activator_callsign}:${value.parkReference ?? value.park_reference}`;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  }));
  return results;
}

function emptyResult(acquired: boolean, considered: number): PotaSpotHistorySyncResult {
  return {
    acquired,
    considered,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    observations: 0,
    liveAttempted: 0,
    closeAttempted: 0,
    postCloseAttempted: 0,
    backfillAttempted: 0,
  };
}

function countPhase(outcomes: readonly HistoryOutcome[], phase: HistoryTarget["phase"]): number {
  return outcomes.filter((outcome) => outcome.target.phase === phase).length;
}
