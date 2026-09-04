ALTER TABLE pota_spot_observations
  ADD COLUMN spotter_callsign TEXT NOT NULL DEFAULT '';

ALTER TABLE pota_spot_observations
  ADD COLUMN comments TEXT NOT NULL DEFAULT '';

ALTER TABLE pota_spot_observations
  ADD COLUMN upstream_count INTEGER;

CREATE INDEX pota_spot_observations_spot_time_idx
  ON pota_spot_observations(spot_time);
