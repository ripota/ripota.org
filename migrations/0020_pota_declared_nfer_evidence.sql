ALTER TABLE pota_spot_history_sync
  ADD COLUMN declared_references_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX pota_spot_history_sync_last_seen_idx
  ON pota_spot_history_sync(last_seen_at);

ALTER TABLE activate_ri_pota_spot_observations
  ADD COLUMN last_spotter_callsign TEXT NOT NULL DEFAULT '';

ALTER TABLE activate_ri_pota_spot_observations
  ADD COLUMN last_comments TEXT NOT NULL DEFAULT '';

ALTER TABLE activate_ri_pota_spot_observations
  ADD COLUMN last_spot_time TEXT NOT NULL DEFAULT '';

ALTER TABLE activate_ri_pota_spot_observations
  ADD COLUMN observation_kind TEXT NOT NULL DEFAULT 'structured_spot'
    CHECK (observation_kind IN ('structured_spot', 'declared_nfer'));

ALTER TABLE activate_ri_pota_spot_observations
  ADD COLUMN declared_by_reference TEXT;
