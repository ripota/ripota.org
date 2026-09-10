-- Event evidence has no automatic deletion. A verified export and explicit
-- organizer decision are required before any purge, never before 2027-01-01.
CREATE TABLE activate_ri_pota_spot_archive (
  event_id TEXT NOT NULL,
  spot_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source_spot_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  park_name TEXT NOT NULL,
  activator_callsign TEXT NOT NULL,
  spot_time TEXT NOT NULL,
  frequency TEXT NOT NULL,
  mode TEXT NOT NULL,
  source_band TEXT,
  report_kind TEXT NOT NULL CHECK (report_kind IN ('spot', 'qrt')),
  source_label TEXT NOT NULL,
  spotter_callsign TEXT NOT NULL,
  comments TEXT NOT NULL,
  upstream_count INTEGER,
  reported_expires_at INTEGER,
  provenance_json TEXT NOT NULL,
  normalizer_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  source_fetched_at INTEGER,
  last_collected_at INTEGER NOT NULL,
  collection_source TEXT NOT NULL,
  collection_run_id TEXT,
  stale INTEGER CHECK (stale IN (0, 1)),
  retain_until TEXT NOT NULL DEFAULT '2027-01-01T00:00:00.000Z',
  PRIMARY KEY (event_id, spot_key, revision)
);
CREATE INDEX activate_ri_pota_spot_archive_time_idx
  ON activate_ri_pota_spot_archive(event_id, spot_time, park_reference);

-- The legacy collector did not retain fetch time/freshness. Do not invent them.
INSERT INTO activate_ri_pota_spot_archive (
  event_id, spot_key, revision, source_spot_id, park_reference, park_name,
  activator_callsign, spot_time, frequency, mode, report_kind, source_label,
  spotter_callsign, comments, upstream_count, reported_expires_at, provenance_json, normalizer_version, content_hash,
  first_observed_at, last_observed_at, last_collected_at, collection_source
)
SELECT 'activate-ri-2026', spot_key, 1, source_spot_id, park_reference, park_name,
  activator_callsign, spot_time, frequency, mode, 'spot', source_label,
  spotter_callsign, comments, upstream_count, reported_expires_at, '[]', 'legacy-rolling-v1', 'legacy:' || spot_key,
  first_observed_at, last_observed_at, last_observed_at, 'legacy_backfill'
FROM pota_spot_observations
WHERE spot_time >= '2026-09-10T00:00:00.000Z'
  AND spot_time < '2026-09-14T00:00:00.000Z';

CREATE TABLE activate_ri_pota_collection_runs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  source_fetched_at INTEGER,
  stale INTEGER CHECK (stale IN (0, 1)),
  live_report_count INTEGER,
  history_attempted INTEGER NOT NULL DEFAULT 0,
  history_succeeded INTEGER NOT NULL DEFAULT 0,
  history_failed INTEGER NOT NULL DEFAULT 0,
  history_report_count INTEGER NOT NULL DEFAULT 0,
  reconciliation_attempted INTEGER NOT NULL DEFAULT 0,
  reconciliation_succeeded INTEGER NOT NULL DEFAULT 0,
  reconciliation_failed INTEGER NOT NULL DEFAULT 0,
  error_category TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX activate_ri_pota_collection_runs_time_idx
  ON activate_ri_pota_collection_runs(event_id, scheduled_at);

CREATE TABLE activate_ri_pota_activation_revisions (
  event_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  location_desc TEXT NOT NULL,
  qso_date TEXT NOT NULL,
  activator_callsign TEXT NOT NULL,
  revision INTEGER NOT NULL,
  total_qsos INTEGER NOT NULL,
  qsos_cw INTEGER NOT NULL,
  qsos_data INTEGER NOT NULL,
  qsos_phone INTEGER NOT NULL,
  qualifying INTEGER NOT NULL,
  source_version TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (event_id, park_reference, location_desc, qso_date, activator_callsign, revision)
);
INSERT INTO activate_ri_pota_activation_revisions
SELECT event_id, park_reference, location_desc, qso_date, activator_callsign, 1,
  total_qsos, qsos_cw, qsos_data, qsos_phone, qualifying, source_version,
  last_verified_at, 'legacy'
FROM activate_ri_pota_activation_evidence;
