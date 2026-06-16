import type { NormalizedRouteSubmission } from "../lib/activate-ri/types";
import type { Env } from "./env";

export async function insertPendingRoute(
  env: Env,
  submission: NormalizedRouteSubmission,
  now = new Date().toISOString(),
): Promise<void> {
  const routeId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `INSERT INTO activate_ri_routes (
        id, event_id, submitter_callsign, submitter_name, submitter_email,
        submitter_phone, club, public_notes, organizer_notes, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(
      routeId,
      env.ACTIVATE_RI_EVENT_ID,
      submission.submitterCallsign,
      submission.submitterName,
      submission.submitterEmail,
      submission.submitterPhone,
      submission.club,
      submission.publicNotes,
      submission.organizerNotes,
      now,
      now,
    ),
    ...submission.stops.map((stop) =>
      env.DB.prepare(
        `INSERT INTO activate_ri_stops (
          id, route_id, event_id, park_reference, planned_date, start_time,
          end_time, bands_json, modes_json, public_notes, organizer_notes,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending-review', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        routeId,
        env.ACTIVATE_RI_EVENT_ID,
        stop.parkReference,
        stop.plannedDate,
        stop.startTime,
        stop.endTime,
        JSON.stringify(stop.bands),
        JSON.stringify(stop.modes),
        stop.publicNotes,
        stop.organizerNotes,
        now,
        now,
      ),
    ),
  ];

  await env.DB.batch(statements);
}
