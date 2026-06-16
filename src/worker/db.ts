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

export type ApproveRouteResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

type RouteStatusRow = {
  status: string;
};

export async function listPendingRoutes(env: Env): Promise<unknown[]> {
  const result = await env.DB.prepare(
    `SELECT
       id,
       event_id,
       submitter_callsign,
       submitter_name,
       submitter_email,
       submitter_phone,
       club,
       public_notes,
       organizer_notes,
       status,
       created_at,
       updated_at,
       approved_at,
       approved_by
     FROM activate_ri_routes
     WHERE event_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID)
    .all();

  return result.results ?? [];
}

export async function approveRoute(
  env: Env,
  routeId: string,
  actorEmail: string,
  now = new Date().toISOString(),
): Promise<ApproveRouteResult> {
  const route = await env.DB.prepare(
    `SELECT status
     FROM activate_ri_routes
     WHERE id = ? AND event_id = ?`,
  )
    .bind(routeId, env.ACTIVATE_RI_EVENT_ID)
    .first<RouteStatusRow>();

  if (!route) {
    return { ok: false, status: 404, error: "Route not found" };
  }

  if (route.status !== "pending") {
    return { ok: false, status: 409, error: "Route is not pending" };
  }

  const updateResult = await env.DB.prepare(
    `UPDATE activate_ri_routes
     SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ?
     WHERE id = ? AND event_id = ? AND status = 'pending'`,
  )
    .bind(now, actorEmail, now, routeId, env.ACTIVATE_RI_EVENT_ID)
    .run();

  if (updateResult.meta.changes < 1) {
    return { ok: false, status: 409, error: "Route is not pending" };
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_stops
       SET status = 'scheduled', updated_at = ?
       WHERE route_id = ? AND event_id = ? AND status = 'pending-review'`,
    ).bind(now, routeId, env.ACTIVATE_RI_EVENT_ID),
    env.DB.prepare(
      `INSERT INTO activate_ri_audit_events
       (id, event_id, route_id, actor_email, action, details_json, created_at)
       VALUES (?, ?, ?, ?, 'approve-route', '{}', ?)`,
    ).bind(crypto.randomUUID(), env.ACTIVATE_RI_EVENT_ID, routeId, actorEmail, now),
  ]);

  return { ok: true };
}
