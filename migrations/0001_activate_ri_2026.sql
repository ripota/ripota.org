CREATE TABLE activate_ri_routes (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  submitter_callsign TEXT NOT NULL,
  submitter_name TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  submitter_phone TEXT NOT NULL DEFAULT '',
  club TEXT NOT NULL DEFAULT '',
  public_notes TEXT NOT NULL DEFAULT '',
  organizer_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  edit_token_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  approval_operation_id TEXT
);

CREATE TABLE activate_ri_stops (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES activate_ri_routes(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  planned_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
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

CREATE TABLE activate_ri_audit_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  route_id TEXT,
  stop_id TEXT,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX activate_ri_routes_status_idx ON activate_ri_routes(status);
CREATE UNIQUE INDEX activate_ri_routes_approval_operation_idx
  ON activate_ri_routes(approval_operation_id)
  WHERE approval_operation_id IS NOT NULL;
CREATE INDEX activate_ri_stops_route_idx ON activate_ri_stops(route_id);
CREATE INDEX activate_ri_stops_status_idx ON activate_ri_stops(status);
CREATE INDEX activate_ri_stops_park_idx ON activate_ri_stops(park_reference);
