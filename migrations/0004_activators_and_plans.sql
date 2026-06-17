CREATE TABLE activate_ri_activators (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  club TEXT NOT NULL DEFAULT '',
  primary_callsign TEXT NOT NULL DEFAULT '',
  magic_token_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  magic_link_sent_at TEXT,
  last_magic_link_sent_at TEXT
);

INSERT INTO activate_ri_activators (
  id,
  event_id,
  email_normalized,
  name,
  phone,
  club,
  primary_callsign,
  magic_token_hash,
  created_at,
  updated_at,
  magic_link_sent_at,
  last_magic_link_sent_at
)
SELECT
  event_id || ':' || lower(trim(submitter_email)),
  event_id,
  lower(trim(submitter_email)),
  submitter_name,
  submitter_phone,
  club,
  submitter_callsign,
  edit_token_hash,
  min(created_at),
  max(updated_at),
  min(edit_link_sent_at),
  max(last_edit_link_sent_at)
FROM activate_ri_routes
GROUP BY event_id, lower(trim(submitter_email));

CREATE UNIQUE INDEX activate_ri_activators_event_email_idx
  ON activate_ri_activators(event_id, email_normalized);

CREATE UNIQUE INDEX activate_ri_activators_magic_token_idx
  ON activate_ri_activators(magic_token_hash)
  WHERE magic_token_hash IS NOT NULL;

ALTER TABLE activate_ri_routes
  RENAME TO activate_ri_plans;

ALTER TABLE activate_ri_plans
  ADD COLUMN activator_id TEXT REFERENCES activate_ri_activators(id);

UPDATE activate_ri_plans
SET activator_id = event_id || ':' || lower(trim(submitter_email));

ALTER TABLE activate_ri_stops
  RENAME COLUMN route_id TO plan_id;

ALTER TABLE activate_ri_activity_events
  RENAME COLUMN route_id TO plan_id;

CREATE INDEX activate_ri_plans_status_idx ON activate_ri_plans(status);
CREATE INDEX activate_ri_plans_activator_idx ON activate_ri_plans(activator_id);
CREATE INDEX activate_ri_stops_plan_idx ON activate_ri_stops(plan_id);
CREATE INDEX activate_ri_activity_events_plan_created_idx
  ON activate_ri_activity_events(plan_id, created_at);
