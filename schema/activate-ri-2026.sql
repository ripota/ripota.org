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
