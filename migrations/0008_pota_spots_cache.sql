CREATE TABLE pota_spots_cache (
  id TEXT PRIMARY KEY CHECK (id = 'ri-live-spots'),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  fetched_at INTEGER,
  refresh_lease_token TEXT,
  refresh_lease_until INTEGER NOT NULL DEFAULT 0,
  retry_after INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_at INTEGER
);

INSERT INTO pota_spots_cache (id) VALUES ('ri-live-spots');
