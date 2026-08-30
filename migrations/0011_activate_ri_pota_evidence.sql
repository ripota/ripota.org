CREATE TABLE activate_ri_pota_spot_observations (
  event_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  spot_date TEXT NOT NULL,
  activator_callsign TEXT NOT NULL,
  location_desc TEXT NOT NULL,
  source_spot_id TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  last_frequency TEXT NOT NULL DEFAULT '',
  last_mode TEXT NOT NULL DEFAULT '',
  last_source_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, park_reference, spot_date, activator_callsign)
);

CREATE INDEX activate_ri_pota_spot_observations_park_idx
  ON activate_ri_pota_spot_observations(event_id, park_reference, last_observed_at);

CREATE TABLE activate_ri_pota_activation_evidence (
  event_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  location_desc TEXT NOT NULL,
  qso_date TEXT NOT NULL,
  activator_callsign TEXT NOT NULL,
  total_qsos INTEGER NOT NULL CHECK (total_qsos >= 0),
  qsos_cw INTEGER NOT NULL CHECK (qsos_cw >= 0),
  qsos_data INTEGER NOT NULL CHECK (qsos_data >= 0),
  qsos_phone INTEGER NOT NULL CHECK (qsos_phone >= 0),
  qualifying INTEGER NOT NULL CHECK (qualifying IN (0, 1)),
  source_version TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    event_id, park_reference, location_desc, qso_date, activator_callsign
  )
);

CREATE INDEX activate_ri_pota_activation_evidence_status_idx
  ON activate_ri_pota_activation_evidence(event_id, qualifying, park_reference);

CREATE TABLE activate_ri_pota_reconciliation (
  event_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  last_attempted_at INTEGER,
  last_success_at INTEGER,
  last_deep_at INTEGER,
  retry_after INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_category TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (event_id, park_reference)
);

CREATE INDEX activate_ri_pota_reconciliation_due_idx
  ON activate_ri_pota_reconciliation(event_id, retry_after, last_attempted_at);

CREATE TABLE activate_ri_pota_sync_state (
  event_id TEXT PRIMARY KEY,
  last_spot_ingest_at INTEGER,
  last_history_batch_at INTEGER,
  last_history_success_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  retry_after INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_category TEXT NOT NULL DEFAULT '',
  deep_requested_at INTEGER,
  deep_completed_at INTEGER
);

INSERT INTO activate_ri_pota_sync_state (event_id)
VALUES ('activate-ri-2026');
