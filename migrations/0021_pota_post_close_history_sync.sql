ALTER TABLE pota_spot_history_sync
  ADD COLUMN post_close_sync_at INTEGER;

CREATE INDEX pota_spot_history_sync_post_close_due_idx
  ON pota_spot_history_sync(
    active, post_close_sync_at, retry_after, last_history_sync_at
  );

INSERT OR IGNORE INTO pota_spot_history_sync (
  activator_callsign,
  park_reference,
  first_seen_at,
  last_seen_at,
  active
)
SELECT
  activator_callsign,
  park_reference,
  MIN(first_observed_at),
  MAX(last_observed_at),
  0
FROM pota_spot_observations
GROUP BY activator_callsign, park_reference;
