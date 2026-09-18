-- Evergreen request totals. Embedder identifies a public URL, not a visitor.
-- No automatic purge or dependency on an event's archive schedule.
CREATE TABLE analytics_widget_daily (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  embedder TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('load', 'refresh', 'click')),
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (day, scope, embedder, action)
);
INSERT INTO analytics_collection_metadata(scope, stream, started_at)
VALUES ('on-air', 'widget_schema_available', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Keep the original AARI-only ingestion history intact, including writes from
-- the old Worker between migration and deployment. New diagnostics have scope.
CREATE TABLE analytics_ingestion_by_scope_daily (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'accepted', 'duplicate', 'rejected', 'rate_limited', 'storage_failed', 'mirror_failed'
  )),
  count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (day, scope, outcome)
);
