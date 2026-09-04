CREATE TABLE pota_spot_history_sync (
  activator_callsign TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_live_spot_id TEXT NOT NULL DEFAULT '',
  last_live_count INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_history_sync_at INTEGER,
  retry_after INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_at INTEGER,
  PRIMARY KEY (activator_callsign, park_reference)
);

CREATE INDEX pota_spot_history_sync_due_idx
  ON pota_spot_history_sync(active, retry_after, last_history_sync_at);

ALTER TABLE pota_spot_collection_state
  ADD COLUMN history_lease_token TEXT;

ALTER TABLE pota_spot_collection_state
  ADD COLUMN history_lease_until INTEGER NOT NULL DEFAULT 0;
