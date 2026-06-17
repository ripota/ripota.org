import type {
  ActivationStopInput,
  NormalizedRouteSubmission,
  StopExportRow,
} from "../lib/activate-ri/types";
import { generateEditToken, tokenHash } from "./edit-token";
import type { Env } from "./env";

export type ActivityActorType = "activator" | "admin" | "system";

export type ActivityEventInput = {
  routeId?: string;
  stopId?: string;
  actorType: ActivityActorType;
  actorEmail?: string;
  action: string;
  summary: string;
  details?: unknown;
};

export type ActivityEventDto = {
  id: string;
  event_id: string;
  route_id: string | null;
  stop_id: string | null;
  actor_type: ActivityActorType;
  actor_email: string;
  action: string;
  summary: string;
  details: unknown;
  created_at: string;
};

export type InsertPendingRouteResult = {
  routeId: string;
  editToken: string;
};

export async function insertPendingRoute(
  env: Env,
  submission: NormalizedRouteSubmission,
  now = new Date().toISOString(),
): Promise<InsertPendingRouteResult> {
  const routeId = crypto.randomUUID();
  const editToken = generateEditToken();
  const editTokenHash = await tokenHash(editToken);
  const statements = [
    env.DB.prepare(
      `INSERT INTO activate_ri_routes (
        id, event_id, submitter_callsign, submitter_name, submitter_email,
        submitter_phone, club, public_notes, organizer_notes, status,
        edit_token_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
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
      editTokenHash,
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
    activityInsert(env, {
      routeId,
      actorType: "activator",
      actorEmail: submission.submitterEmail,
      action: "route-created",
      summary: `${submission.submitterCallsign} submitted ${submission.stops.length} activation stop${submission.stops.length === 1 ? "" : "s"}.`,
      details: {
        submitterCallsign: submission.submitterCallsign,
        submitterEmail: submission.submitterEmail,
        stopCount: submission.stops.length,
      },
    }, now),
  ];

  await env.DB.batch(statements);

  return { routeId, editToken };
}

export type ApproveRouteResult =
  | { ok: true }
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

type RouteRow = {
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

type StopRow = {
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

export type PendingRouteDto = RouteRow & {
  stops: PendingStopDto[];
};

export type EditableRouteDto = PendingRouteDto;

export type EditableRouteSubmission = Omit<NormalizedRouteSubmission, "stops"> & {
  stops: Array<Required<ActivationStopInput> & { id?: string }>;
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
    `${routeSelectSql}
     FROM activate_ri_routes
     WHERE event_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID)
    .all<RouteRow>();

  return withStops(env, routeResult.results ?? []);
}

export async function listActivityEvents(
  env: Env,
  limit = 100,
): Promise<ActivityEventDto[]> {
  const result = await env.DB.prepare(
    `SELECT
       id,
       event_id,
       route_id,
       stop_id,
       actor_type,
       actor_email,
       action,
       summary,
       details_json,
       created_at
     FROM activate_ri_activity_events
     WHERE event_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, limit)
    .all<ActivityEventRow>();

  return (result.results ?? []).map(toActivityEventDto);
}

export async function getRouteByTokenHash(
  env: Env,
  editTokenHash: string,
): Promise<EditableRouteDto | null> {
  const route = await env.DB.prepare(
    `${routeSelectSql}
     FROM activate_ri_routes
     WHERE event_id = ? AND edit_token_hash = ?`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, editTokenHash)
    .first<RouteRow>();

  if (!route) {
    return null;
  }

  return (await withStops(env, [route]))[0] ?? null;
}

export async function findRouteForEditLinkResend(
  env: Env,
  callsign: string,
  email: string,
): Promise<{ route: EditableRouteDto; editToken: string } | null> {
  const route = await env.DB.prepare(
    `${routeSelectSql}
     FROM activate_ri_routes
     WHERE event_id = ? AND submitter_callsign = ? AND submitter_email = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, callsign, email)
    .first<RouteRow>();

  if (!route) {
    return null;
  }

  const editToken = generateEditToken();
  const editTokenHash = await tokenHash(editToken);
  await env.DB.prepare(
    `UPDATE activate_ri_routes
     SET edit_token_hash = ?, updated_at = ?
     WHERE id = ? AND event_id = ?`,
  )
    .bind(editTokenHash, new Date().toISOString(), route.id, env.ACTIVATE_RI_EVENT_ID)
    .run();

  return {
    route: (await withStops(env, [route]))[0] ?? { ...route, stops: [] },
    editToken,
  };
}

async function withStops(
  env: Env,
  routes: RouteRow[],
): Promise<PendingRouteDto[]> {
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
    .all<StopRow>();

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

function toPendingStopDto(stop: StopRow): PendingStopDto {
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

  const [updateResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_routes
       SET status = 'approved',
           approved_at = ?,
           approved_by = ?,
           approval_operation_id = ?,
           updated_at = ?
       WHERE id = ? AND event_id = ? AND status = 'pending'`,
    ).bind(
      now,
      actorEmail,
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
    activityInsert(env, {
      routeId,
      actorType: "admin",
      actorEmail,
      action: "route-approved",
      summary: "Route approved and published.",
      details: { approvalOperationId },
    }, now),
  ]);

  if (updateResult.meta.changes < 1) {
    return { ok: false, status: 409, error: "Route is not pending" };
  }

  return { ok: true };
}

type UpdateRouteResult =
  | { ok: true; highImpactEvents: ActivityEventInput[] }
  | { ok: false; status: 404; error: string };

export async function updateRouteByTokenHash(
  env: Env,
  editTokenHash: string,
  submission: EditableRouteSubmission,
  now = new Date().toISOString(),
): Promise<UpdateRouteResult> {
  const existing = await getRouteByTokenHash(env, editTokenHash);
  if (!existing) {
    return { ok: false, status: 404, error: "Route not found" };
  }

  const approved = existing.status === "approved";
  const nextStopStatus = approved ? "scheduled" : "pending-review";
  const existingStops = new Map(existing.stops.map((stop) => [stop.id, stop]));
  const incomingIds = new Set(
    submission.stops
      .map((stop) => stop.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const highImpactEvents: ActivityEventInput[] = [];
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE activate_ri_routes
       SET submitter_callsign = ?,
           submitter_name = ?,
           submitter_email = ?,
           submitter_phone = ?,
           club = ?,
           public_notes = ?,
           organizer_notes = ?,
           updated_at = ?
       WHERE id = ? AND event_id = ? AND edit_token_hash = ?`,
    ).bind(
      submission.submitterCallsign,
      submission.submitterName,
      submission.submitterEmail,
      submission.submitterPhone,
      submission.club,
      submission.publicNotes,
      submission.organizerNotes,
      now,
      existing.id,
      env.ACTIVATE_RI_EVENT_ID,
      editTokenHash,
    ),
    activityInsert(env, {
      routeId: existing.id,
      actorType: "activator",
      actorEmail: submission.submitterEmail,
      action: "route-updated",
      summary: `${submission.submitterCallsign} updated route details.`,
      details: {
        previous: routeSnapshot(existing),
        next: {
          submitterCallsign: submission.submitterCallsign,
          submitterName: submission.submitterName,
          submitterEmail: submission.submitterEmail,
          club: submission.club,
          publicNotes: submission.publicNotes,
          organizerNotes: submission.organizerNotes,
        },
      },
    }, now),
  ];

  for (const stop of submission.stops) {
    const existingStop = stop.id ? existingStops.get(stop.id) : undefined;
    if (existingStop) {
      statements.push(
        env.DB.prepare(
          `UPDATE activate_ri_stops
           SET park_reference = ?,
               planned_date = ?,
               start_time = ?,
               end_time = ?,
               bands_json = ?,
               modes_json = ?,
               public_notes = ?,
               organizer_notes = ?,
               status = CASE WHEN status = 'completed' THEN status ELSE ? END,
               updated_at = ?,
               cancelled_at = CASE WHEN status = 'cancelled' THEN NULL ELSE cancelled_at END,
               cancel_reason = CASE WHEN status = 'cancelled' THEN '' ELSE cancel_reason END
           WHERE id = ? AND route_id = ? AND event_id = ?`,
        ).bind(
          stop.parkReference,
          stop.plannedDate,
          stop.startTime,
          stop.endTime,
          JSON.stringify(stop.bands),
          JSON.stringify(stop.modes),
          stop.publicNotes,
          stop.organizerNotes,
          nextStopStatus,
          now,
          existingStop.id,
          existing.id,
          env.ACTIVATE_RI_EVENT_ID,
        ),
      );
      statements.push(activityInsert(env, {
        routeId: existing.id,
        stopId: existingStop.id,
        actorType: "activator",
        actorEmail: submission.submitterEmail,
        action: "stop-updated",
        summary: `${submission.submitterCallsign} updated ${existingStop.park_reference}.`,
        details: {
          previous: stopSnapshot(existingStop),
          next: stop,
        },
      }, now));

      if (
        approved &&
        (existingStop.park_reference !== stop.parkReference ||
          existingStop.planned_date !== stop.plannedDate)
      ) {
        highImpactEvents.push({
          routeId: existing.id,
          stopId: existingStop.id,
          actorType: "activator",
          actorEmail: submission.submitterEmail,
          action: "admin-notification-needed",
          summary: `${submission.submitterCallsign} changed ${existingStop.park_reference} to ${stop.parkReference} on an approved route.`,
          details: {
            previous: stopSnapshot(existingStop),
            next: stop,
          },
        });
      }
    } else {
      const stopId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          `INSERT INTO activate_ri_stops (
            id, route_id, event_id, park_reference, planned_date, start_time,
            end_time, bands_json, modes_json, public_notes, organizer_notes,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          stopId,
          existing.id,
          env.ACTIVATE_RI_EVENT_ID,
          stop.parkReference,
          stop.plannedDate,
          stop.startTime,
          stop.endTime,
          JSON.stringify(stop.bands),
          JSON.stringify(stop.modes),
          stop.publicNotes,
          stop.organizerNotes,
          nextStopStatus,
          now,
          now,
        ),
      );
      statements.push(activityInsert(env, {
        routeId: existing.id,
        stopId,
        actorType: "activator",
        actorEmail: submission.submitterEmail,
        action: "stop-added",
        summary: `${submission.submitterCallsign} added ${stop.parkReference}.`,
        details: { next: stop },
      }, now));
    }
  }

  for (const existingStop of existing.stops) {
    if (incomingIds.has(existingStop.id) || existingStop.status === "cancelled") {
      continue;
    }

    statements.push(
      env.DB.prepare(
        `UPDATE activate_ri_stops
         SET status = 'cancelled',
             cancelled_at = ?,
             cancel_reason = ?,
             updated_at = ?
         WHERE id = ? AND route_id = ? AND event_id = ?`,
      ).bind(
        now,
        "Removed by activator.",
        now,
        existingStop.id,
        existing.id,
        env.ACTIVATE_RI_EVENT_ID,
      ),
    );
    const event = {
      routeId: existing.id,
      stopId: existingStop.id,
      actorType: "activator" as const,
      actorEmail: submission.submitterEmail,
      action: "stop-withdrawn",
      summary: `${submission.submitterCallsign} removed ${existingStop.park_reference}.`,
      details: { previous: stopSnapshot(existingStop) },
    };
    statements.push(activityInsert(env, event, now));
    if (approved) {
      highImpactEvents.push(event);
    }
  }

  await env.DB.batch(statements);

  return { ok: true, highImpactEvents };
}

export async function cancelRouteByTokenHash(
  env: Env,
  editTokenHash: string,
  cancelReason: string,
  now = new Date().toISOString(),
): Promise<
  | { ok: true; route: EditableRouteDto; highImpactEvents: ActivityEventInput[] }
  | { ok: false; status: 404; error: string }
> {
  const existing = await getRouteByTokenHash(env, editTokenHash);
  if (!existing) {
    return { ok: false, status: 404, error: "Route not found" };
  }

  const approved = existing.status === "approved";
  const highImpactEvent: ActivityEventInput = {
    routeId: existing.id,
    actorType: "activator",
    actorEmail: existing.submitter_email,
    action: "route-cancelled",
    summary: `${existing.submitter_callsign} cancelled the route.`,
    details: {
      cancelReason,
      previous: {
        route: routeSnapshot(existing),
        stops: existing.stops.map(stopSnapshot),
      },
    },
  };

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_routes
       SET status = CASE WHEN status = 'approved' THEN status ELSE 'withdrawn' END,
           updated_at = ?
       WHERE id = ? AND event_id = ? AND edit_token_hash = ?`,
    ).bind(now, existing.id, env.ACTIVATE_RI_EVENT_ID, editTokenHash),
    env.DB.prepare(
      `UPDATE activate_ri_stops
       SET status = 'cancelled',
           cancelled_at = ?,
           cancel_reason = ?,
           updated_at = ?
       WHERE route_id = ?
         AND event_id = ?
         AND status != 'completed'`,
    ).bind(
      now,
      cancelReason,
      now,
      existing.id,
      env.ACTIVATE_RI_EVENT_ID,
    ),
    activityInsert(env, highImpactEvent, now),
  ]);

  return {
    ok: true,
    route: existing,
    highImpactEvents: approved ? [highImpactEvent] : [],
  };
}

type EditStopRouteRow = {
  status: string;
};

async function findEditStopRoute(
  env: Env,
  editTokenHash: string,
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
    .bind(stopId, env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID, editTokenHash)
    .first<EditStopRouteRow>();
}

export async function updateStopByToken(
  env: Env,
  editTokenHash: string,
  stopId: string,
  fields: EditStopFields,
  now = new Date().toISOString(),
): Promise<EditStopResult> {
  const route = await findEditStopRoute(env, editTokenHash, stopId);
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
      editTokenHash,
    )
    .run();

  if ((result.meta?.changes ?? 0) < 1) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  return { ok: true };
}

export async function cancelStopByToken(
  env: Env,
  editTokenHash: string,
  stopId: string,
  cancelReason: string,
  now = new Date().toISOString(),
): Promise<EditStopResult> {
  const route = await findEditStopRoute(env, editTokenHash, stopId);
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
      editTokenHash,
    )
    .run();

  if ((result.meta?.changes ?? 0) < 1) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  return { ok: true };
}

export async function markEditLinkEmailEvent(
  env: Env,
  routeId: string,
  actorEmail: string,
  action: "edit-link-sent" | "edit-link-send-failed" | "edit-link-resent",
  summary: string,
  details: unknown = {},
  now = new Date().toISOString(),
): Promise<void> {
  const statements = [
    activityInsert(env, {
      routeId,
      actorType: "system",
      actorEmail,
      action,
      summary,
      details,
    }, now),
  ];

  if (action === "edit-link-sent") {
    statements.push(
      env.DB.prepare(
        `UPDATE activate_ri_routes
         SET edit_link_sent_at = COALESCE(edit_link_sent_at, ?),
             last_edit_link_sent_at = ?,
             updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(now, now, now, routeId, env.ACTIVATE_RI_EVENT_ID),
    );
  } else if (action === "edit-link-resent") {
    statements.push(
      env.DB.prepare(
        `UPDATE activate_ri_routes
         SET last_edit_link_sent_at = ?,
             updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(now, now, routeId, env.ACTIVATE_RI_EVENT_ID),
    );
  }

  await env.DB.batch(statements);
}

export async function logActivityEvent(
  env: Env,
  event: ActivityEventInput,
  now = new Date().toISOString(),
): Promise<void> {
  await activityInsert(env, event, now).run();
}

function activityInsert(
  env: Env,
  event: ActivityEventInput,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO activate_ri_activity_events
     (id, event_id, route_id, stop_id, actor_type, actor_email, action, summary, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    env.ACTIVATE_RI_EVENT_ID,
    event.routeId ?? null,
    event.stopId ?? null,
    event.actorType,
    event.actorEmail ?? "",
    event.action,
    event.summary,
    JSON.stringify(event.details ?? {}),
    now,
  );
}

type ActivityEventRow = {
  id: string;
  event_id: string;
  route_id: string | null;
  stop_id: string | null;
  actor_type: ActivityActorType;
  actor_email: string;
  action: string;
  summary: string;
  details_json: string;
  created_at: string;
};

function toActivityEventDto(row: ActivityEventRow): ActivityEventDto {
  return {
    id: row.id,
    event_id: row.event_id,
    route_id: row.route_id,
    stop_id: row.stop_id,
    actor_type: row.actor_type,
    actor_email: row.actor_email,
    action: row.action,
    summary: row.summary,
    details: parseJson(row.details_json),
    created_at: row.created_at,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function routeSnapshot(route: EditableRouteDto): Record<string, string> {
  return {
    submitterCallsign: route.submitter_callsign,
    submitterName: route.submitter_name,
    submitterEmail: route.submitter_email,
    club: route.club,
    publicNotes: route.public_notes,
    organizerNotes: route.organizer_notes,
  };
}

function stopSnapshot(stop: PendingStopDto): Record<string, unknown> {
  return {
    id: stop.id,
    parkReference: stop.park_reference,
    plannedDate: stop.planned_date,
    startTime: stop.start_time,
    endTime: stop.end_time,
    bands: stop.bands,
    modes: stop.modes,
    publicNotes: stop.public_notes,
    organizerNotes: stop.organizer_notes,
    status: stop.status,
  };
}

const routeSelectSql = `SELECT
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
       approved_by`;
