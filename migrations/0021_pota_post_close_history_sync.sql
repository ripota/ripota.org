ALTER TABLE pota_spot_history_sync
  ADD COLUMN post_close_sync_at INTEGER;

CREATE INDEX pota_spot_history_sync_post_close_due_idx
  ON pota_spot_history_sync(
    active, post_close_sync_at, retry_after, last_history_sync_at
  );
