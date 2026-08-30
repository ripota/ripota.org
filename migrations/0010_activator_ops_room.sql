CREATE TABLE activate_ri_ops_memberships (
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL
    REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('active', 'muted', 'banned')),
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

INSERT INTO activate_ri_ops_memberships (
  event_id, activator_id, status, created_at, updated_at
)
SELECT event_id, id, 'active', updated_at, updated_at
FROM activate_ri_activators
WHERE status = 'approved';

CREATE TABLE activate_ri_ops_settings (
  event_id TEXT PRIMARY KEY,
  room_mode TEXT NOT NULL
    CHECK (room_mode IN ('full', 'announcements', 'off')),
  pinned_message_id TEXT,
  rules_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO activate_ri_ops_settings (
  event_id, room_mode, rules_version, updated_at, updated_by
) VALUES (
  'activate-ri-2026', 'off', 'activate-ri-ops-v1',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration'
);

CREATE TABLE activate_ri_ops_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  author_type TEXT NOT NULL
    CHECK (author_type IN ('activator', 'admin', 'system')),
  author_key TEXT NOT NULL,
  author_activator_id TEXT
    REFERENCES activate_ri_activators(id) ON DELETE SET NULL,
  author_label TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'chat', 'access-note', 'running-late', 'need-backup',
      'announcement', 'system'
    )),
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
  message_id TEXT NOT NULL UNIQUE
    REFERENCES activate_ri_ops_messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'sending', 'sent', 'partial', 'failed')),
  requested_by TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE activate_ri_ops_email_recipients (
  broadcast_id TEXT NOT NULL
    REFERENCES activate_ri_ops_email_broadcasts(id) ON DELETE CASCADE,
  activator_id TEXT NOT NULL
    REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (broadcast_id, activator_id)
);
