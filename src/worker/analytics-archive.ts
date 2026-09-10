import type { AnalyticsEvent } from "../lib/analytics/events";

/** Receipt time is authoritative for intervals; client time is evidence only. */
export async function persistAnonymousAnalyticsEvent(
  db: D1Database,
  event: AnalyticsEvent,
  subjectHash: string,
  receivedAt: string,
): Promise<boolean> {
  const modern = event.schemaVersion === 2;
  const eventId = modern ? String(event.eventId) : crypto.randomUUID();
  const occurredAt = modern ? String(event.occurredAt) : receivedAt;
  const clockSkewed = Math.abs(Date.parse(occurredAt) - Date.parse(receivedAt)) > 300_000;
  const results = await db.batch([db.prepare(`INSERT INTO analytics_anonymous_events (
    scope, subject_hash, event_id, event_name, schema_version,
    occurred_at, received_at, clock_skewed, properties_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(scope, subject_hash, event_id) DO NOTHING`).bind(
    event.scope, subjectHash, eventId, event.name, event.schemaVersion,
    occurredAt, receivedAt, Number(clockSkewed), JSON.stringify(event.properties ?? {}),
  ), db.prepare(`INSERT INTO analytics_collection_metadata(scope, stream, started_at)
    VALUES (?, 'anonymous_events', ?) ON CONFLICT(scope, stream) DO UPDATE
    SET started_at = MIN(started_at, excluded.started_at)`).bind(event.scope, receivedAt)]);
  const result = results[0]!;
  if (!result.success) throw new Error("Anonymous event storage failed");
  return result.meta.changes > 0;
}

export type AnalyticsIngestionOutcome =
  | "accepted" | "duplicate" | "rejected" | "rate_limited" | "storage_failed" | "mirror_failed";

/** Diagnostic counts only: no request identifiers, bodies, or network metadata. */
export async function recordAnalyticsIngestionOutcome(
  db: D1Database,
  outcome: AnalyticsIngestionOutcome,
  at = new Date().toISOString(),
): Promise<void> {
  await db.prepare(`INSERT INTO analytics_ingestion_daily
    (day, outcome, count, first_seen_at, last_seen_at) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(day, outcome) DO UPDATE SET
      count = count + 1, last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`)
    .bind(at.slice(0, 10), outcome, at, at).run();
}
