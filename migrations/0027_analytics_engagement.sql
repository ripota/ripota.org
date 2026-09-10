-- Preserve the un-timestamped baseline without inventing historical events.
CREATE TABLE analytics_feature_usage_legacy AS SELECT * FROM analytics_feature_usage;

CREATE TABLE IF NOT EXISTS analytics_collection_metadata (
  scope TEXT NOT NULL,
  stream TEXT NOT NULL,
  started_at TEXT NOT NULL,
  PRIMARY KEY (scope, stream)
);
INSERT INTO analytics_collection_metadata (scope, stream, started_at) VALUES
  ('activate-ri-2026', 'authenticated_schema_available', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('activate-ri-2026', 'ops_engagement_schema_available', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE analytics_feature_events (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX analytics_feature_events_window_idx
  ON analytics_feature_events(scope, occurred_at, feature, subject_type, subject_id);

-- One server-timestamped foreground sample per actor/minute, across tabs.
-- Samples establish visible room use, not reading time or comprehension.
CREATE TABLE activate_ri_ops_foreground_samples (
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL,
  utc_minute TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  entry_source TEXT NOT NULL CHECK (entry_source IN ('direct', 'message_link')),
  PRIMARY KEY (event_id, activator_id, utc_minute)
);
CREATE INDEX activate_ri_ops_foreground_window_idx
  ON activate_ri_ops_foreground_samples(event_id, occurred_at, activator_id);

-- First exposure each UTC date, deduplicated across tabs/reconnects.
-- No message content or anonymous-browser identifier is copied here.
CREATE TABLE activate_ri_ops_message_exposures (
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  utc_date TEXT NOT NULL,
  first_exposed_at TEXT NOT NULL,
  entry_source TEXT NOT NULL CHECK (entry_source IN ('direct', 'message_link')),
  PRIMARY KEY (event_id, activator_id, message_id, utc_date)
);
CREATE INDEX activate_ri_ops_exposure_window_idx
  ON activate_ri_ops_message_exposures(event_id, first_exposed_at, activator_id);
