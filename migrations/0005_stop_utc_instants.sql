CREATE TABLE activate_ri_stops_next (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES activate_ri_plans(id) ON DELETE CASCADE,
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

INSERT INTO activate_ri_stops_next (
  id,
  plan_id,
  event_id,
  park_reference,
  start_at,
  end_at,
  bands_json,
  modes_json,
  public_notes,
  organizer_notes,
  status,
  created_at,
  updated_at,
  cancelled_at,
  cancel_reason
)
SELECT
  id,
  plan_id,
  event_id,
  park_reference,
  planned_date || 'T' || start_time || ':00.000Z',
  planned_date || 'T' || end_time || ':00.000Z',
  bands_json,
  modes_json,
  public_notes,
  organizer_notes,
  status,
  created_at,
  updated_at,
  cancelled_at,
  cancel_reason
FROM activate_ri_stops;

DROP TABLE activate_ri_stops;

ALTER TABLE activate_ri_stops_next RENAME TO activate_ri_stops;

CREATE INDEX activate_ri_stops_status_idx ON activate_ri_stops(status);
CREATE INDEX activate_ri_stops_park_idx ON activate_ri_stops(park_reference);
CREATE INDEX activate_ri_stops_plan_idx ON activate_ri_stops(plan_id);
CREATE INDEX activate_ri_stops_start_idx ON activate_ri_stops(start_at);
