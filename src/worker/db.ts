import type {
  NormalizedRouteSubmission,
  StopExportRow,
} from "../lib/activate-ri/types";
import { generateEditToken, tokenHash } from "./edit-token";
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
  | { ok: true; editToken: string }
  | { ok: false; status: 404 | 409; error: string };

export type EditStopFields = {
  startTime: string;
  endTime: string;
  bands: string[];
  modes: string[];
  publicNotes: string;
};

export type EditStopResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

type RouteStatusRow = {
  status: string;
};

type PendingRouteRow = {
  id: string;
  event_id: string;
  submitter_callsign: string;
  submitter_name: string;
  submitter_email: string;
  submitter_phone: string;
  club: string;
  public_notes: string;
  organizer_notes: string;
  status: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
};

type PendingStopRow = {
  id: string;
  route_id: string;
  event_id: string;
  park_reference: string;
  planned_date: string;
  start_time: string;
  end_time: string;
  bands_json: string;
  modes_json: string;
  public_notes: string;
  organizer_notes: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PendingStopDto = {
  id: string;
  route_id: string;
  event_id: string;
  park_reference: string;
  planned_date: string;
  start_time: string;
  end_time: string;
  bands: string[];
  modes: string[];
  public_notes: string;
  organizer_notes: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PendingRouteDto = PendingRouteRow & {
  stops: PendingStopDto[];
};

export async function listPublicStopRows(env: Env): Promise<StopExportRow[]> {
  const result = await env.DB.prepare(
    `SELECT
       s.id,
       s.park_reference,
       s.planned_date,
       s.start_time,
       s.end_time,
       r.submitter_callsign,
       s.bands_json,
       s.modes_json,
       s.public_notes,
       s.status
     FROM activate_ri_stops s
     INNER JOIN activate_ri_routes r ON r.id = s.route_id
     WHERE s.event_id = ?
       AND r.event_id = ?
       AND r.status = 'approved'
       AND s.status IN ('scheduled', 'delayed', 'cancelled', 'completed')
     ORDER BY s.planned_date ASC, s.start_time ASC, s.park_reference ASC, s.id ASC`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID)
    .all<StopExportRow>();

  return result.results ?? [];
}

export async function listPendingRoutes(env: Env): Promise<PendingRouteDto[]> {
  const routeResult = await env.DB.prepare(
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
    .all<PendingRouteRow>();

  const routes = routeResult.results ?? [];
  if (routes.length === 0) {
    return [];
  }

  const routeIds = routes.map((route) => route.id);
  const stopResult = await env.DB.prepare(
    `SELECT
       id,
       route_id,
       event_id,
       park_reference,
       planned_date,
       start_time,
       end_time,
       bands_json,
       modes_json,
       public_notes,
       organizer_notes,
       status,
       created_at,
       updated_at
     FROM activate_ri_stops
     WHERE event_id = ? AND route_id IN (${routeIds.map(() => "?").join(", ")})
     ORDER BY planned_date ASC, start_time ASC, created_at ASC`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, ...routeIds)
    .all<PendingStopRow>();

  const stopsByRoute = new Map<string, PendingStopDto[]>();
  for (const stop of stopResult.results ?? []) {
    const stops = stopsByRoute.get(stop.route_id) ?? [];
    stops.push(toPendingStopDto(stop));
    stopsByRoute.set(stop.route_id, stops);
  }

  return routes.map((route) => ({
    ...route,
    stops: stopsByRoute.get(route.id) ?? [],
  }));
}

function toPendingStopDto(stop: PendingStopRow): PendingStopDto {
  return {
    id: stop.id,
    route_id: stop.route_id,
    event_id: stop.event_id,
    park_reference: stop.park_reference,
    planned_date: stop.planned_date,
    start_time: stop.start_time,
    end_time: stop.end_time,
    bands: parseStringArray(stop.bands_json),
    modes: parseStringArray(stop.modes_json),
    public_notes: stop.public_notes,
    organizer_notes: stop.organizer_notes,
    status: stop.status,
    created_at: stop.created_at,
    updated_at: stop.updated_at,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export async function approveRoute(
  env: Env,
  routeId: string,
  actorEmail: string,
  now = new Date().toISOString(),
): Promise<ApproveRouteResult> {
  const approvalOperationId = crypto.randomUUID();
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

  const editToken = generateEditToken();
  const editTokenHash = await tokenHash(editToken);
  const [updateResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_routes
       SET status = 'approved',
           approved_at = ?,
           approved_by = ?,
           edit_token_hash = ?,
           approval_operation_id = ?,
           updated_at = ?
       WHERE id = ? AND event_id = ? AND status = 'pending'`,
    ).bind(
      now,
      actorEmail,
      editTokenHash,
      approvalOperationId,
      now,
      routeId,
      env.ACTIVATE_RI_EVENT_ID,
    ),
    env.DB.prepare(
      `UPDATE activate_ri_stops
       SET status = 'scheduled', updated_at = ?
       WHERE route_id = ? AND event_id = ? AND status = 'pending-review'
         AND EXISTS (
           SELECT 1
           FROM activate_ri_routes
           WHERE id = ?
             AND event_id = ?
             AND status = 'approved'
             AND approval_operation_id = ?
         )`,
    ).bind(
      now,
      routeId,
      env.ACTIVATE_RI_EVENT_ID,
      routeId,
      env.ACTIVATE_RI_EVENT_ID,
      approvalOperationId,
    ),
    env.DB.prepare(
      `INSERT INTO activate_ri_audit_events
       (id, event_id, route_id, actor_email, action, details_json, created_at)
       SELECT ?, ?, ?, ?, 'approve-route', '{}', ?
       WHERE EXISTS (
         SELECT 1
         FROM activate_ri_routes
         WHERE id = ?
           AND event_id = ?
           AND status = 'approved'
           AND approval_operation_id = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      env.ACTIVATE_RI_EVENT_ID,
      routeId,
      actorEmail,
      now,
      routeId,
      env.ACTIVATE_RI_EVENT_ID,
      approvalOperationId,
    ),
  ]);

  if (updateResult.meta.changes < 1) {
    return { ok: false, status: 409, error: "Route is not pending" };
  }

  return { ok: true, editToken };
}

type EditStopRouteRow = {
  status: string;
};

async function findEditStopRoute(
  env: Env,
  tokenHash: string,
  stopId: string,
): Promise<EditStopRouteRow | null> {
  return env.DB.prepare(
    `SELECT r.status
     FROM activate_ri_stops s
     INNER JOIN activate_ri_routes r ON r.id = s.route_id
     WHERE s.id = ?
       AND s.event_id = ?
       AND r.event_id = ?
       AND r.edit_token_hash = ?`,
  )
    .bind(stopId, env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID, tokenHash)
    .first<EditStopRouteRow>();
}

export async function updateStopByToken(
  env: Env,
  tokenHash: string,
  stopId: string,
  fields: EditStopFields,
  now = new Date().toISOString(),
): Promise<EditStopResult> {
  const route = await findEditStopRoute(env, tokenHash, stopId);
  if (!route) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  if (route.status !== "approved") {
    return { ok: false, status: 409, error: "Route is not approved" };
  }

  const result = await env.DB.prepare(
    `UPDATE activate_ri_stops
     SET start_time = ?,
         end_time = ?,
         bands_json = ?,
         modes_json = ?,
         public_notes = ?,
         updated_at = ?
     WHERE id = ?
       AND event_id = ?
       AND route_id IN (
         SELECT id
         FROM activate_ri_routes
         WHERE event_id = ?
           AND edit_token_hash = ?
           AND status = 'approved'
       )`,
  )
    .bind(
      fields.startTime,
      fields.endTime,
      JSON.stringify(fields.bands),
      JSON.stringify(fields.modes),
      fields.publicNotes,
      now,
      stopId,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
      tokenHash,
    )
    .run();

  if ((result.meta?.changes ?? 0) < 1) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  return { ok: true };
}

export async function cancelStopByToken(
  env: Env,
  tokenHash: string,
  stopId: string,
  cancelReason: string,
  now = new Date().toISOString(),
): Promise<EditStopResult> {
  const route = await findEditStopRoute(env, tokenHash, stopId);
  if (!route) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  if (route.status !== "approved") {
    return { ok: false, status: 409, error: "Route is not approved" };
  }

  const result = await env.DB.prepare(
    `UPDATE activate_ri_stops
     SET status = 'cancelled',
         cancelled_at = ?,
         cancel_reason = ?,
         updated_at = ?
     WHERE id = ?
       AND event_id = ?
       AND route_id IN (
         SELECT id
         FROM activate_ri_routes
         WHERE event_id = ?
           AND edit_token_hash = ?
           AND status = 'approved'
       )`,
  )
    .bind(
      now,
      cancelReason,
      now,
      stopId,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
      tokenHash,
    )
    .run();

  if ((result.meta?.changes ?? 0) < 1) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  return { ok: true };
}
