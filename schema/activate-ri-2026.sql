CREATE TABLE activate_ri_activators (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  club TEXT NOT NULL DEFAULT '',
  primary_callsign TEXT NOT NULL DEFAULT '',
  magic_token_hash TEXT,
  public_notes TEXT NOT NULL DEFAULT '',
  organizer_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  magic_link_sent_at TEXT,
  last_magic_link_sent_at TEXT
);

CREATE UNIQUE INDEX activate_ri_activators_event_email_idx
  ON activate_ri_activators(event_id, email_normalized);

CREATE UNIQUE INDEX activate_ri_activators_magic_token_idx
  ON activate_ri_activators(magic_token_hash)
  WHERE magic_token_hash IS NOT NULL;

CREATE INDEX activate_ri_activators_status_idx
  ON activate_ri_activators(status);

CREATE TABLE activate_ri_edit_tokens (
  token_hash TEXT PRIMARY KEY,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_sent_at TEXT,
  revoked_at TEXT
);

CREATE INDEX activate_ri_edit_tokens_activator_idx
  ON activate_ri_edit_tokens(activator_id, event_id);

CREATE INDEX activate_ri_edit_tokens_active_idx
  ON activate_ri_edit_tokens(event_id, token_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE activate_ri_activator_sessions (
  token_hash TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX activate_ri_activator_sessions_actor_idx
  ON activate_ri_activator_sessions(event_id, activator_id);

CREATE INDEX activate_ri_activator_sessions_expiry_idx
  ON activate_ri_activator_sessions(expires_at);

CREATE TABLE activate_ri_stops (
  id TEXT PRIMARY KEY,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  bands_json TEXT NOT NULL,
  modes_json TEXT NOT NULL,
  public_notes TEXT NOT NULL DEFAULT '',
  organizer_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending-review', 'scheduled', 'delayed', 'cancelled', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancel_reason TEXT
);

CREATE INDEX activate_ri_stops_status_idx ON activate_ri_stops(status);
CREATE INDEX activate_ri_stops_park_idx ON activate_ri_stops(park_reference);
CREATE INDEX activate_ri_stops_activator_idx ON activate_ri_stops(activator_id);
CREATE INDEX activate_ri_stops_start_idx ON activate_ri_stops(start_at);

CREATE TABLE activate_ri_activity_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  plan_id TEXT,
  stop_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('activator', 'admin', 'system')),
  actor_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX activate_ri_activity_events_event_created_idx
  ON activate_ri_activity_events(event_id, created_at);

CREATE INDEX activate_ri_activity_events_plan_created_idx
  ON activate_ri_activity_events(plan_id, created_at);

CREATE TABLE activate_ri_ops_memberships (
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'muted', 'banned')),
  accepted_rules_version TEXT,
  accepted_rules_at TEXT,
  moderation_reason TEXT NOT NULL DEFAULT '',
  moderated_at TEXT,
  moderated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, activator_id)
);

CREATE INDEX activate_ri_ops_memberships_status_idx
  ON activate_ri_ops_memberships(event_id, status);

CREATE TABLE activate_ri_ops_settings (
  event_id TEXT PRIMARY KEY,
  room_mode TEXT NOT NULL CHECK (room_mode IN ('full', 'announcements', 'off')),
  pinned_message_id TEXT,
  rules_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE activate_ri_ops_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('activator', 'admin', 'system')),
  author_key TEXT NOT NULL,
  author_activator_id TEXT REFERENCES activate_ri_activators(id) ON DELETE SET NULL,
  author_label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'access-note', 'running-late', 'need-backup', 'announcement', 'system')),
  body TEXT NOT NULL,
  park_reference TEXT,
  stop_id TEXT REFERENCES activate_ri_stops(id) ON DELETE SET NULL,
  client_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  removed_at TEXT,
  removed_by TEXT NOT NULL DEFAULT '',
  removal_reason TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX activate_ri_ops_messages_nonce_idx
  ON activate_ri_ops_messages(event_id, author_key, client_nonce);
CREATE INDEX activate_ri_ops_messages_event_created_idx
  ON activate_ri_ops_messages(event_id, created_at);
CREATE INDEX activate_ri_ops_messages_park_created_idx
  ON activate_ri_ops_messages(event_id, park_reference, created_at);
CREATE INDEX activate_ri_ops_messages_stop_created_idx
  ON activate_ri_ops_messages(event_id, stop_id, created_at);
CREATE INDEX activate_ri_ops_messages_kind_created_idx
  ON activate_ri_ops_messages(event_id, kind, created_at);

CREATE TABLE activate_ri_ops_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX activate_ri_ops_events_event_sequence_idx
  ON activate_ri_ops_events(event_id, sequence);
CREATE UNIQUE INDEX activate_ri_ops_events_message_created_idx
  ON activate_ri_ops_events(event_id, message_id)
  WHERE event_type = 'message-created';
CREATE UNIQUE INDEX activate_ri_ops_events_message_removed_idx
  ON activate_ri_ops_events(event_id, message_id)
  WHERE event_type = 'message-removed';

CREATE TABLE activate_ri_ops_email_broadcasts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE REFERENCES activate_ri_ops_messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'partial', 'failed')),
  requested_by TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE activate_ri_ops_email_recipients (
  broadcast_id TEXT NOT NULL REFERENCES activate_ri_ops_email_broadcasts(id) ON DELETE CASCADE,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (broadcast_id, activator_id)
);

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
  PRIMARY KEY (event_id, park_reference, location_desc, qso_date, activator_callsign)
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

CREATE TABLE analytics_feature_usage (
  scope TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  first_used_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1 CHECK (use_count > 0),
  PRIMARY KEY (scope, subject_type, subject_id, feature)
);

CREATE INDEX analytics_feature_usage_report_idx
  ON analytics_feature_usage(scope, feature, last_used_at);

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
