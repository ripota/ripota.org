import { activateRiPotaEndDate, activateRiPotaStartDate, type PotaActivationEvidence } from "../lib/activate-ri/pota-event";
import { potaSpotReferenceEvidence, type LivePotaSpot } from "../lib/pota/spots";
import type { Env } from "./env";

type ArchiveEnv = Pick<Env, "DB"> & Partial<Pick<Env, "ACTIVATE_RI_EVENT_ID">>;
export type SpotArchiveContext = {
  observedAt: Date;
  sourceFetchedAt: number | null;
  source: "live" | "history";
  stale: boolean;
  runId?: string;
};

// Version report content separately from collection metadata. A -> B -> A is
// three revisions; repeatedly observing A creates no additional revision.
// Reports retain upstream TTL values relative to sourceFetchedAt, unlike the
// public live snapshot, which adjusts remaining TTL for the current time.
export async function archiveEventSpotReports(
  env: ArchiveEnv,
  reports: readonly LivePotaSpot[],
  context: SpotArchiveContext,
): Promise<number> {
  if (!env.ACTIVATE_RI_EVENT_ID) return 0;
  let archived = 0;
  for (const report of reports) {
    const instant = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(report.spotTime)
      ? report.spotTime : `${report.spotTime}Z`);
    if (!Number.isFinite(instant)) continue;
    const spotTime = new Date(instant).toISOString();
    if (spotTime.slice(0, 10) < activateRiPotaStartDate || spotTime.slice(0, 10) > activateRiPotaEndDate) continue;
    const provenance = JSON.stringify(potaSpotReferenceEvidence(report));
    const kind = /\bQRT\b/i.test(report.comments) ? "qrt" : "spot";
    const contentHash = await hashEvidence([
      report.id, report.parkReference, report.parkName, report.activatorCallsign,
      spotTime, report.frequency, report.mode, report.sourceBand ?? null, kind,
      report.sourceLabel, report.spotterCallsign, report.comments, provenance,
    ]);
    const key = [env.ACTIVATE_RI_EVENT_ID, report.id];
    const timestamp = context.observedAt.valueOf();
    const expiresAt = report.expiresInSeconds === null ? null
      : (context.sourceFetchedAt ?? timestamp) + report.expiresInSeconds * 1_000;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO activate_ri_pota_spot_archive (
          event_id, spot_key, revision, source_spot_id, park_reference, park_name,
          activator_callsign, spot_time, frequency, mode, source_band, report_kind,
          source_label, spotter_callsign, comments, upstream_count, reported_expires_at, provenance_json,
          normalizer_version, content_hash, first_observed_at, last_observed_at,
          source_fetched_at, last_collected_at, collection_source, collection_run_id, stale
        ) SELECT ?, ?, COALESCE((SELECT MAX(revision) FROM activate_ri_pota_spot_archive
             WHERE event_id = ? AND spot_key = ?), 0) + 1,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pota-report-v2', ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT content_hash FROM activate_ri_pota_spot_archive
          WHERE event_id = ? AND spot_key = ? ORDER BY revision DESC LIMIT 1), '') <> ?`,
      ).bind(
        ...key, ...key, report.id, report.parkReference, report.parkName,
        report.activatorCallsign, spotTime, report.frequency, report.mode,
        report.sourceBand ?? null, kind, report.sourceLabel, report.spotterCallsign,
        report.comments, report.upstreamCount, expiresAt,
        provenance, contentHash, timestamp, timestamp,
        context.sourceFetchedAt, timestamp, context.source, context.runId ?? null,
        context.stale ? 1 : 0, ...key, contentHash,
      ),
      env.DB.prepare(
        `UPDATE activate_ri_pota_spot_archive
         SET last_observed_at = MAX(last_observed_at, ?),
           upstream_count = COALESCE(?, upstream_count),
           reported_expires_at = COALESCE(?, reported_expires_at),
           source_fetched_at = CASE WHEN ? >= last_collected_at THEN ? ELSE source_fetched_at END,
           collection_source = CASE WHEN ? >= last_collected_at THEN ? ELSE collection_source END,
           collection_run_id = CASE WHEN ? >= last_collected_at THEN ? ELSE collection_run_id END,
           stale = CASE WHEN ? >= last_collected_at THEN ? ELSE stale END,
           last_collected_at = MAX(last_collected_at, ?)
         WHERE event_id = ? AND spot_key = ? AND revision = (
           SELECT MAX(revision) FROM activate_ri_pota_spot_archive WHERE event_id = ? AND spot_key = ?
         ) AND content_hash = ?`,
      ).bind(timestamp, report.upstreamCount, expiresAt,
        timestamp, context.sourceFetchedAt, timestamp, context.source,
        timestamp, context.runId ?? null, timestamp, context.stale ? 1 : 0,
        timestamp, ...key, ...key, contentHash),
    ]);
    archived += 1;
  }
  return archived;
}

export async function activationRevisionStatement(
  env: Pick<Env, "DB" | "ACTIVATE_RI_EVENT_ID">,
  row: PotaActivationEvidence,
  observedAt: string,
  sourceVersion: string,
): Promise<D1PreparedStatement> {
  const key = [env.ACTIVATE_RI_EVENT_ID, row.parkReference, row.locationDesc, row.qsoDate, row.activatorCallsign];
  const contentHash = await hashEvidence([row.totalQsos, row.qsosCw, row.qsosData, row.qsosPhone, row.qualifying]);
  return env.DB.prepare(
    `INSERT INTO activate_ri_pota_activation_revisions (
      event_id, park_reference, location_desc, qso_date, activator_callsign,
      revision, total_qsos, qsos_cw, qsos_data, qsos_phone, qualifying,
      source_version, observed_at, content_hash
    ) SELECT ?, ?, ?, ?, ?, COALESCE((SELECT MAX(revision)
      FROM activate_ri_pota_activation_revisions WHERE event_id = ? AND park_reference = ?
        AND location_desc = ? AND qso_date = ? AND activator_callsign = ?), 0) + 1,
      ?, ?, ?, ?, ?, ?, ?, ?
    WHERE COALESCE((SELECT content_hash FROM activate_ri_pota_activation_revisions
      WHERE event_id = ? AND park_reference = ? AND location_desc = ? AND qso_date = ?
        AND activator_callsign = ? ORDER BY revision DESC LIMIT 1), '') <> ?`,
  ).bind(...key, ...key, row.totalQsos, row.qsosCw, row.qsosData, row.qsosPhone,
    row.qualifying ? 1 : 0, sourceVersion, observedAt, contentHash, ...key, contentHash);
}

async function hashEvidence(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
