ALTER TABLE activate_ri_activators
  ADD COLUMN public_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE activate_ri_activators
  ADD COLUMN organizer_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE activate_ri_activators
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'));

ALTER TABLE activate_ri_activators
  ADD COLUMN approved_at TEXT;

ALTER TABLE activate_ri_activators
  ADD COLUMN approved_by TEXT;

UPDATE activate_ri_activators
SET
  public_notes = COALESCE((
    SELECT p.public_notes
    FROM activate_ri_plans p
    WHERE p.activator_id = activate_ri_activators.id
    ORDER BY p.updated_at DESC
    LIMIT 1
  ), ''),
  organizer_notes = COALESCE((
    SELECT p.organizer_notes
    FROM activate_ri_plans p
    WHERE p.activator_id = activate_ri_activators.id
    ORDER BY p.updated_at DESC
    LIMIT 1
  ), ''),
  status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM activate_ri_plans p
      WHERE p.activator_id = activate_ri_activators.id
        AND p.status = 'approved'
    ) THEN 'approved'
    WHEN EXISTS (
      SELECT 1
      FROM activate_ri_plans p
      WHERE p.activator_id = activate_ri_activators.id
        AND p.status = 'pending'
    ) THEN 'pending'
    WHEN EXISTS (
      SELECT 1
      FROM activate_ri_plans p
      WHERE p.activator_id = activate_ri_activators.id
        AND p.status = 'rejected'
    ) THEN 'rejected'
    ELSE 'withdrawn'
  END,
  approved_at = (
    SELECT p.approved_at
    FROM activate_ri_plans p
    WHERE p.activator_id = activate_ri_activators.id
      AND p.approved_at IS NOT NULL
    ORDER BY p.approved_at DESC
    LIMIT 1
  ),
  approved_by = (
    SELECT p.approved_by
    FROM activate_ri_plans p
    WHERE p.activator_id = activate_ri_activators.id
      AND p.approved_by IS NOT NULL
    ORDER BY p.approved_at DESC
    LIMIT 1
  );

CREATE TABLE activate_ri_stops_next (
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

INSERT INTO activate_ri_stops_next (
  id,
  activator_id,
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
  s.id,
  p.activator_id,
  s.event_id,
  s.park_reference,
  s.start_at,
  s.end_at,
  s.bands_json,
  s.modes_json,
  s.public_notes,
  s.organizer_notes,
  s.status,
  s.created_at,
  s.updated_at,
  s.cancelled_at,
  s.cancel_reason
FROM activate_ri_stops s
INNER JOIN activate_ri_plans p ON p.id = s.plan_id;

DROP TABLE activate_ri_stops;

ALTER TABLE activate_ri_stops_next RENAME TO activate_ri_stops;

DROP TABLE activate_ri_plans;

CREATE INDEX activate_ri_activators_status_idx
  ON activate_ri_activators(status);

CREATE INDEX activate_ri_stops_status_idx ON activate_ri_stops(status);
CREATE INDEX activate_ri_stops_park_idx ON activate_ri_stops(park_reference);
CREATE INDEX activate_ri_stops_activator_idx ON activate_ri_stops(activator_id);
CREATE INDEX activate_ri_stops_start_idx ON activate_ri_stops(start_at);
