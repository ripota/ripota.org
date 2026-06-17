ALTER TABLE activate_ri_routes
  ADD COLUMN edit_link_sent_at TEXT;

ALTER TABLE activate_ri_routes
  ADD COLUMN last_edit_link_sent_at TEXT;

CREATE TABLE activate_ri_activity_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  route_id TEXT,
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

CREATE INDEX activate_ri_activity_events_route_created_idx
  ON activate_ri_activity_events(route_id, created_at);
