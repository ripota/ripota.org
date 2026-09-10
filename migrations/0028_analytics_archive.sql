-- Anonymous feature evidence uses the existing event-scoped HMAC browser key.
-- It has no relationship to authenticated actor IDs and contains no raw UUID,
-- IP address, callsign, URL, checklist contents, or message text.
CREATE TABLE analytics_anonymous_events (
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  clock_skewed INTEGER NOT NULL DEFAULT 0 CHECK (clock_skewed IN (0, 1)),
  properties_json TEXT NOT NULL CHECK (json_valid(properties_json)),
  retain_until TEXT NOT NULL DEFAULT '2027-01-01T00:00:00.000Z',
  PRIMARY KEY (scope, subject_hash, event_id)
);
CREATE INDEX analytics_anonymous_events_time_idx
  ON analytics_anonymous_events(scope, received_at, event_name);

CREATE TABLE IF NOT EXISTS analytics_collection_metadata (
  scope TEXT NOT NULL,
  stream TEXT NOT NULL,
  started_at TEXT NOT NULL,
  PRIMARY KEY (scope, stream)
);
INSERT INTO analytics_collection_metadata(scope, stream, started_at)
VALUES ('activate-ri-2026', 'anonymous_schema_available', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE analytics_ingestion_daily (
  day TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'accepted', 'duplicate', 'rejected', 'rate_limited', 'storage_failed', 'mirror_failed'
  )),
  count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(day, outcome)
);

-- No automatic purge. After Jan 1, deletion still requires a separately
-- authorized, verified export and deliberate retention decision.
