CREATE TABLE pota_spot_observations (
  spot_key TEXT PRIMARY KEY,
  source_spot_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  park_name TEXT NOT NULL,
  activator_callsign TEXT NOT NULL,
  spot_time TEXT NOT NULL,
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  reported_expires_at INTEGER,
  frequency TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT ''
);

CREATE INDEX pota_spot_observations_last_observed_idx
  ON pota_spot_observations(last_observed_at);

CREATE INDEX pota_spot_observations_park_idx
  ON pota_spot_observations(park_reference, spot_time);

CREATE TABLE pota_spot_collection_state (
  id TEXT PRIMARY KEY,
  last_collection_at INTEGER,
  last_cleanup_at INTEGER,
  last_cleanup_deleted INTEGER NOT NULL DEFAULT 0
);

INSERT INTO pota_spot_collection_state (id)
VALUES ('ri-live-spots');
