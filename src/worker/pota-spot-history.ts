import type { LivePotaSpot } from "../lib/pota/spots";
import type { Env } from "./env";

export const potaSpotRetentionMilliseconds = 14 * 24 * 60 * 60_000;

const collectionStateId = "ri-live-spots";

export async function persistPotaSpotHistory(
  env: Pick<Env, "DB">,
  spots: readonly LivePotaSpot[],
  observedAt = new Date(),
): Promise<number> {
  const observedAtMilliseconds = observedAt.valueOf();
  const statements = spots.map((spot) => env.DB.prepare(
    `INSERT INTO pota_spot_observations (
      spot_key, source_spot_id, park_reference, park_name,
      activator_callsign, spot_time, first_observed_at, last_observed_at,
      reported_expires_at, frequency, mode, source_label, spotter_callsign,
      comments, upstream_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(spot_key) DO UPDATE SET
      source_spot_id = excluded.source_spot_id,
      park_name = excluded.park_name,
      last_observed_at = excluded.last_observed_at,
      reported_expires_at = COALESCE(
        excluded.reported_expires_at,
        pota_spot_observations.reported_expires_at
      ),
      frequency = excluded.frequency,
      mode = excluded.mode,
      source_label = excluded.source_label,
      spotter_callsign = excluded.spotter_callsign,
      comments = excluded.comments,
      upstream_count = COALESCE(
        excluded.upstream_count,
        pota_spot_observations.upstream_count
      )`,
  ).bind(
    spotKey(spot),
    spot.id,
    spot.parkReference,
    spot.parkName,
    spot.activatorCallsign,
    normalizedSpotTime(spot.spotTime),
    observedAtMilliseconds,
    observedAtMilliseconds,
    spot.expiresInSeconds === null
      ? null
      : observedAtMilliseconds + spot.expiresInSeconds * 1_000,
    spot.frequency,
    spot.mode,
    spot.sourceLabel,
    spot.spotterCallsign,
    spot.comments,
    spot.upstreamCount,
  ));

  for (let index = 0; index < statements.length; index += 100) {
    await env.DB.batch(statements.slice(index, index + 100));
  }
  await env.DB.prepare(
    `UPDATE pota_spot_collection_state
     SET last_collection_at = ?
     WHERE id = ?`,
  ).bind(observedAtMilliseconds, collectionStateId).run();
  return statements.length;
}

export async function cleanupPotaSpotHistory(
  env: Pick<Env, "DB">,
  now = new Date(),
): Promise<{ deleted: number; syncStatesDeleted: number; cutoff: string }> {
  const cutoff = now.valueOf() - potaSpotRetentionMilliseconds;
  const deleted = await env.DB.prepare(
    `DELETE FROM pota_spot_observations
     WHERE spot_time < ?`,
  ).bind(new Date(cutoff).toISOString()).run();
  const syncStatesDeleted = await env.DB.prepare(
    `DELETE FROM pota_spot_history_sync
     WHERE last_seen_at < ?`,
  ).bind(cutoff).run();
  await env.DB.prepare(
    `UPDATE pota_spot_collection_state
     SET last_cleanup_at = ?, last_cleanup_deleted = ?
     WHERE id = ?`,
  ).bind(now.valueOf(), deleted.meta.changes, collectionStateId).run();
  return {
    deleted: deleted.meta.changes,
    syncStatesDeleted: syncStatesDeleted.meta.changes,
    cutoff: new Date(cutoff).toISOString(),
  };
}

function spotKey(spot: LivePotaSpot): string {
  return spot.id;
}

function normalizedSpotTime(value: string): string {
  const normalized = /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : value;
}
