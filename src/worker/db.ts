import type {
  ActivationStopInput,
  NormalizedRouteSubmission,
  StopExportRow,
} from "../lib/activate-ri/types";
import {
  instantToPlannedDate,
  instantToTime,
  stopTimeToInstant,
} from "../lib/activate-ri/time";
import { generateEditToken, tokenHash } from "./edit-token";
import type { Env } from "./env";

export type ActivityActorType = "activator" | "admin" | "system";

export type ActivityEventInput = {
  planId?: string;
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
  plan_id: string | null;
  stop_id: string | null;
  actor_type: ActivityActorType;
  actor_email: string;
  action: string;
  summary: string;
  details: unknown;
  created_at: string;
};

export type InsertPendingPlanResult = {
  activatorId: string;
  planId: string;
  editToken: string;
};

export async function insertPendingPlan(
  env: Env,
  submission: NormalizedRouteSubmission,
  now = new Date().toISOString(),
): Promise<InsertPendingPlanResult> {
  const planId = crypto.randomUUID();
  const activatorId = activatorIdForEmail(env.ACTIVATE_RI_EVENT_ID, submission.submitterEmail);
  const editToken = generateEditToken();
  const magicTokenHash = await tokenHash(editToken);
  const statements = [
    env.DB.prepare(
      `INSERT INTO activate_ri_activators (
        id, event_id, email_normalized, name, phone, club, primary_callsign,
        magic_token_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, email_normalized) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        club = excluded.club,
        primary_callsign = excluded.primary_callsign,
        magic_token_hash = excluded.magic_token_hash,
        updated_at = excluded.updated_at`,
    ).bind(
      activatorId,
      env.ACTIVATE_RI_EVENT_ID,
      submission.submitterEmail,
      submission.submitterName,
      submission.submitterPhone,
      submission.club,
      submission.submitterCallsign,
      magicTokenHash,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO activate_ri_plans (
        id, activator_id, event_id, submitter_callsign, submitter_name, submitter_email,
        submitter_phone, club, public_notes, organizer_notes, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(
      planId,
      activatorId,
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
          id, plan_id, event_id, park_reference, start_at,
          end_at, bands_json, modes_json, public_notes, organizer_notes,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending-review', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        planId,
        env.ACTIVATE_RI_EVENT_ID,
        stop.parkReference,
        stopTimeToInstant(stop.plannedDate, stop.startTime),
        stopTimeToInstant(stop.plannedDate, stop.endTime),
        JSON.stringify(stop.bands),
        JSON.stringify(stop.modes),
        stop.publicNotes,
        stop.organizerNotes,
        now,
        now,
      ),
    ),
    activityInsert(env, {
      planId,
      actorType: "activator",
      actorEmail: submission.submitterEmail,
      action: "plan-created",
      summary: `${submission.submitterCallsign} submitted ${submission.stops.length} activation stop${submission.stops.length === 1 ? "" : "s"}.`,
      details: {
        submitterCallsign: submission.submitterCallsign,
        submitterEmail: submission.submitterEmail,
        stopCount: submission.stops.length,
      },
    }, now),
  ];

  await env.DB.batch(statements);

  return { activatorId, planId, editToken };
}

export type ApprovePlanResult =
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

type PlanStatusRow = {
  status: string;
};

type PlanRow = {
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
  plan_id: string;
  event_id: string;
  park_reference: string;
  start_at: string;
  end_at: string;
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
  plan_id: string;
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

export type PendingPlanDto = PlanRow & {
  stops: PendingStopDto[];
};

export type EditablePlanDto = PendingPlanDto;

export type EditablePlanSubmission = Omit<NormalizedRouteSubmission, "stops"> & {
  stops: Array<Required<ActivationStopInput> & { id?: string }>;
};

export type ActivatorDto = {
  id: string;
  event_id: string;
  email_normalized: string;
  name: string;
  phone: string;
  club: string;
  primary_callsign: string;
};

export type ActivatorPlansDto = {
  activator: ActivatorDto;
  plans: EditablePlanDto[];
};

export async function listPublicStopRows(env: Env): Promise<StopExportRow[]> {
  const result = await env.DB.prepare(
     `SELECT
       s.id,
       s.park_reference,
       s.start_at,
       s.end_at,
       r.submitter_callsign,
       s.bands_json,
       s.modes_json,
       s.public_notes,
       s.status
     FROM activate_ri_stops s
     INNER JOIN activate_ri_plans r ON r.id = s.plan_id
     WHERE s.event_id = ?
       AND r.event_id = ?
       AND r.status = 'approved'
       AND s.status IN ('scheduled', 'delayed', 'cancelled', 'completed')
     ORDER BY s.start_at ASC, s.park_reference ASC, s.id ASC`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID)
    .all<StopExportRow>();

  return result.results ?? [];
}

export async function listSeenClubs(env: Env): Promise<string[]> {
  const result = await env.DB.prepare(
    `SELECT DISTINCT TRIM(club) AS club
     FROM activate_ri_activators
     WHERE event_id = ? AND TRIM(club) <> ''
     ORDER BY LOWER(TRIM(club)) ASC
     LIMIT 100`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID)
    .all<{ club: string }>();

  return (result.results ?? [])
    .map((row) => row.club)
    .filter(Boolean);
}

export async function listPendingPlans(env: Env): Promise<PendingPlanDto[]> {
  const planResult = await env.DB.prepare(
    `${planSelectSql}
     FROM activate_ri_plans
     WHERE event_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID)
    .all<PlanRow>();

  return withStops(env, planResult.results ?? []);
}

export async function listActivityEvents(
  env: Env,
  limit = 100,
): Promise<ActivityEventDto[]> {
  const result = await env.DB.prepare(
    `SELECT
       id,
       event_id,
       plan_id,
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

export async function getPlansByTokenHash(
  env: Env,
  magicTokenHash: string,
): Promise<ActivatorPlansDto | null> {
  const activator = await env.DB.prepare(
    `SELECT id, event_id, email_normalized, name, phone, club, primary_callsign
     FROM activate_ri_activators
     WHERE event_id = ? AND magic_token_hash = ?`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, magicTokenHash)
    .first<ActivatorDto>();

  if (!activator) {
    return null;
  }

  const planResult = await env.DB.prepare(
    `${planSelectSql}
     FROM activate_ri_plans
     WHERE event_id = ? AND activator_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, activator.id)
    .all<PlanRow>();

  return {
    activator,
    plans: await withStops(env, planResult.results ?? []),
  };
}

export async function getPlanByTokenHash(
  env: Env,
  magicTokenHash: string,
  planId: string,
): Promise<EditablePlanDto | null> {
  const plan = await env.DB.prepare(
    `${planSelectSql}
     FROM activate_ri_plans
     WHERE event_id = ?
       AND id = ?
       AND EXISTS (
         SELECT 1
         FROM activate_ri_activators
         WHERE id = activate_ri_plans.activator_id
           AND event_id = ?
           AND magic_token_hash = ?
       )`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, planId, env.ACTIVATE_RI_EVENT_ID, magicTokenHash)
    .first<PlanRow>();

  if (!plan) {
    return null;
  }

  return (await withStops(env, [plan]))[0] ?? null;
}

export async function findActivatorForEditLinkResend(
  env: Env,
  callsign: string,
  email: string,
): Promise<{ activator: ActivatorDto; plan: EditablePlanDto | null; editToken: string } | null> {
  const activator = await env.DB.prepare(
    `SELECT id, event_id, email_normalized, name, phone, club, primary_callsign
     FROM activate_ri_activators
     WHERE event_id = ? AND email_normalized = ? AND primary_callsign = ?`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, email, callsign)
    .first<ActivatorDto>();

  if (!activator) {
    return null;
  }

  const editToken = generateEditToken();
  const magicTokenHash = await tokenHash(editToken);
  await env.DB.prepare(
    `UPDATE activate_ri_activators
     SET magic_token_hash = ?, updated_at = ?
     WHERE id = ? AND event_id = ?`,
  )
    .bind(magicTokenHash, new Date().toISOString(), activator.id, env.ACTIVATE_RI_EVENT_ID)
    .run();

  const plans = await env.DB.prepare(
    `${planSelectSql}
     FROM activate_ri_plans
     WHERE event_id = ? AND activator_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, activator.id)
    .all<PlanRow>();

  return {
    activator,
    plan: (await withStops(env, plans.results ?? []))[0] ?? null,
    editToken,
  };
}

async function withStops(
  env: Env,
  plans: PlanRow[],
): Promise<PendingPlanDto[]> {
  if (plans.length === 0) {
    return [];
  }

  const planIds = plans.map((plan) => plan.id);
  const stopResult = await env.DB.prepare(
    `SELECT
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
       updated_at
     FROM activate_ri_stops
     WHERE event_id = ? AND plan_id IN (${planIds.map(() => "?").join(", ")})
     ORDER BY start_at ASC, created_at ASC`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, ...planIds)
    .all<StopRow>();

  const stopsByPlan = new Map<string, PendingStopDto[]>();
  for (const stop of stopResult.results ?? []) {
    const stops = stopsByPlan.get(stop.plan_id) ?? [];
    stops.push(toPendingStopDto(stop));
    stopsByPlan.set(stop.plan_id, stops);
  }

  return plans.map((plan) => ({
    ...plan,
    stops: stopsByPlan.get(plan.id) ?? [],
  }));
}

function toPendingStopDto(stop: StopRow): PendingStopDto {
  return {
    id: stop.id,
    plan_id: stop.plan_id,
    event_id: stop.event_id,
    park_reference: stop.park_reference,
    planned_date: instantToPlannedDate(stop.start_at),
    start_time: instantToTime(stop.start_at),
    end_time: instantToTime(stop.end_at),
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

export async function approvePlan(
  env: Env,
  planId: string,
  actorEmail: string,
  now = new Date().toISOString(),
): Promise<ApprovePlanResult> {
  const approvalOperationId = crypto.randomUUID();
  const plan = await env.DB.prepare(
    `SELECT status
     FROM activate_ri_plans
     WHERE id = ? AND event_id = ?`,
  )
    .bind(planId, env.ACTIVATE_RI_EVENT_ID)
    .first<PlanStatusRow>();

  if (!plan) {
    return { ok: false, status: 404, error: "Plan not found" };
  }

  if (plan.status !== "pending") {
    return { ok: false, status: 409, error: "Plan is not pending" };
  }

  const [updateResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_plans
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
      planId,
      env.ACTIVATE_RI_EVENT_ID,
    ),
    env.DB.prepare(
      `UPDATE activate_ri_stops
       SET status = 'scheduled', updated_at = ?
       WHERE plan_id = ? AND event_id = ? AND status = 'pending-review'
         AND EXISTS (
           SELECT 1
           FROM activate_ri_plans
           WHERE id = ?
             AND event_id = ?
             AND status = 'approved'
             AND approval_operation_id = ?
         )`,
    ).bind(
      now,
      planId,
      env.ACTIVATE_RI_EVENT_ID,
      planId,
      env.ACTIVATE_RI_EVENT_ID,
      approvalOperationId,
    ),
    activityInsert(env, {
      planId,
      actorType: "admin",
      actorEmail,
      action: "plan-approved",
      summary: "Plan approved and published.",
      details: { approvalOperationId },
    }, now),
  ]);

  if (updateResult.meta.changes < 1) {
    return { ok: false, status: 409, error: "Plan is not pending" };
  }

  return { ok: true };
}

type UpdatePlanResult =
  | { ok: true; highImpactEvents: ActivityEventInput[] }
  | { ok: false; status: 404; error: string };

export async function updatePlanByTokenHash(
  env: Env,
  magicTokenHash: string,
  planId: string,
  submission: EditablePlanSubmission,
  now = new Date().toISOString(),
): Promise<UpdatePlanResult> {
  const existing = await getPlanByTokenHash(env, magicTokenHash, planId);
  if (!existing) {
    return { ok: false, status: 404, error: "Plan not found" };
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
      `UPDATE activate_ri_plans
       SET submitter_callsign = ?,
           submitter_name = ?,
           submitter_email = ?,
           submitter_phone = ?,
           club = ?,
           public_notes = ?,
           organizer_notes = ?,
           updated_at = ?
       WHERE id = ? AND event_id = ?
         AND EXISTS (
           SELECT 1
           FROM activate_ri_activators
           WHERE id = activate_ri_plans.activator_id
             AND event_id = ?
             AND magic_token_hash = ?
         )`,
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
      env.ACTIVATE_RI_EVENT_ID,
      magicTokenHash,
    ),
    activityInsert(env, {
      planId: existing.id,
      actorType: "activator",
      actorEmail: submission.submitterEmail,
      action: "plan-updated",
      summary: `${submission.submitterCallsign} updated plan details.`,
      details: {
        previous: planSnapshot(existing),
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
    env.DB.prepare(
      `UPDATE activate_ri_activators
       SET name = ?,
           phone = ?,
           club = ?,
           primary_callsign = ?,
           updated_at = ?
       WHERE event_id = ?
         AND magic_token_hash = ?`,
    ).bind(
      submission.submitterName,
      submission.submitterPhone,
      submission.club,
      submission.submitterCallsign,
      now,
      env.ACTIVATE_RI_EVENT_ID,
      magicTokenHash,
    ),
  ];

  for (const stop of submission.stops) {
    const existingStop = stop.id ? existingStops.get(stop.id) : undefined;
    if (existingStop) {
      statements.push(
        env.DB.prepare(
          `UPDATE activate_ri_stops
           SET park_reference = ?,
               start_at = ?,
               end_at = ?,
               bands_json = ?,
               modes_json = ?,
               public_notes = ?,
               organizer_notes = ?,
               status = CASE WHEN status = 'completed' THEN status ELSE ? END,
               updated_at = ?,
               cancelled_at = CASE WHEN status = 'cancelled' THEN NULL ELSE cancelled_at END,
               cancel_reason = CASE WHEN status = 'cancelled' THEN '' ELSE cancel_reason END
           WHERE id = ? AND plan_id = ? AND event_id = ?`,
        ).bind(
          stop.parkReference,
          stopTimeToInstant(stop.plannedDate, stop.startTime),
          stopTimeToInstant(stop.plannedDate, stop.endTime),
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
        planId: existing.id,
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
          planId: existing.id,
          stopId: existingStop.id,
          actorType: "activator",
          actorEmail: submission.submitterEmail,
          action: "admin-notification-needed",
          summary: `${submission.submitterCallsign} changed ${existingStop.park_reference} to ${stop.parkReference} on an approved plan.`,
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
            id, plan_id, event_id, park_reference, start_at,
            end_at, bands_json, modes_json, public_notes, organizer_notes,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          stopId,
          existing.id,
          env.ACTIVATE_RI_EVENT_ID,
          stop.parkReference,
          stopTimeToInstant(stop.plannedDate, stop.startTime),
          stopTimeToInstant(stop.plannedDate, stop.endTime),
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
        planId: existing.id,
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
         WHERE id = ? AND plan_id = ? AND event_id = ?`,
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
      planId: existing.id,
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

export async function cancelPlanByTokenHash(
  env: Env,
  magicTokenHash: string,
  planId: string,
  cancelReason: string,
  now = new Date().toISOString(),
): Promise<
  | { ok: true; plan: EditablePlanDto; highImpactEvents: ActivityEventInput[] }
  | { ok: false; status: 404; error: string }
> {
  const existing = await getPlanByTokenHash(env, magicTokenHash, planId);
  if (!existing) {
    return { ok: false, status: 404, error: "Plan not found" };
  }

  const approved = existing.status === "approved";
  const highImpactEvent: ActivityEventInput = {
    planId: existing.id,
    actorType: "activator",
    actorEmail: existing.submitter_email,
    action: "plan-cancelled",
    summary: `${existing.submitter_callsign} cancelled the plan.`,
    details: {
      cancelReason,
      previous: {
        plan: planSnapshot(existing),
        stops: existing.stops.map(stopSnapshot),
      },
    },
  };

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_plans
       SET status = CASE WHEN status = 'approved' THEN status ELSE 'withdrawn' END,
           updated_at = ?
       WHERE id = ? AND event_id = ?
         AND EXISTS (
           SELECT 1
           FROM activate_ri_activators
           WHERE id = activate_ri_plans.activator_id
             AND event_id = ?
             AND magic_token_hash = ?
         )`,
    ).bind(
      now,
      existing.id,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
      magicTokenHash,
    ),
    env.DB.prepare(
      `UPDATE activate_ri_stops
       SET status = 'cancelled',
           cancelled_at = ?,
           cancel_reason = ?,
           updated_at = ?
       WHERE plan_id = ?
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
    plan: existing,
    highImpactEvents: approved ? [highImpactEvent] : [],
  };
}

type EditStopPlanRow = {
  status: string;
  start_at: string;
};

async function findEditStopPlan(
  env: Env,
  magicTokenHash: string,
  stopId: string,
): Promise<EditStopPlanRow | null> {
  return env.DB.prepare(
    `SELECT r.status, s.start_at
     FROM activate_ri_stops s
     INNER JOIN activate_ri_plans r ON r.id = s.plan_id
     INNER JOIN activate_ri_activators a ON a.id = r.activator_id
     WHERE s.id = ?
       AND s.event_id = ?
       AND r.event_id = ?
       AND a.event_id = ?
       AND a.magic_token_hash = ?`,
  )
    .bind(
      stopId,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
      magicTokenHash,
    )
    .first<EditStopPlanRow>();
}

export async function updateStopByToken(
  env: Env,
  magicTokenHash: string,
  stopId: string,
  fields: EditStopFields,
  now = new Date().toISOString(),
): Promise<EditStopResult> {
  const plan = await findEditStopPlan(env, magicTokenHash, stopId);
  if (!plan) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  if (plan.status !== "approved") {
    return { ok: false, status: 409, error: "Plan is not approved" };
  }

  const result = await env.DB.prepare(
    `UPDATE activate_ri_stops
     SET start_at = ?,
         end_at = ?,
         bands_json = ?,
         modes_json = ?,
         public_notes = ?,
         updated_at = ?
     WHERE id = ?
       AND event_id = ?
       AND plan_id IN (
         SELECT id
         FROM activate_ri_plans
         WHERE event_id = ?
           AND EXISTS (
             SELECT 1
             FROM activate_ri_activators
             WHERE id = activate_ri_plans.activator_id
               AND event_id = ?
               AND magic_token_hash = ?
           )
           AND status = 'approved'
       )`,
  )
    .bind(
      stopTimeToInstant(instantToPlannedDate(plan.start_at), fields.startTime),
      stopTimeToInstant(instantToPlannedDate(plan.start_at), fields.endTime),
      JSON.stringify(fields.bands),
      JSON.stringify(fields.modes),
      fields.publicNotes,
      now,
      stopId,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
      magicTokenHash,
    )
    .run();

  if ((result.meta?.changes ?? 0) < 1) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  return { ok: true };
}

export async function cancelStopByToken(
  env: Env,
  magicTokenHash: string,
  stopId: string,
  cancelReason: string,
  now = new Date().toISOString(),
): Promise<EditStopResult> {
  const plan = await findEditStopPlan(env, magicTokenHash, stopId);
  if (!plan) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  if (plan.status !== "approved") {
    return { ok: false, status: 409, error: "Plan is not approved" };
  }

  const result = await env.DB.prepare(
    `UPDATE activate_ri_stops
     SET status = 'cancelled',
         cancelled_at = ?,
         cancel_reason = ?,
         updated_at = ?
     WHERE id = ?
       AND event_id = ?
       AND plan_id IN (
         SELECT id
         FROM activate_ri_plans
         WHERE event_id = ?
           AND EXISTS (
             SELECT 1
             FROM activate_ri_activators
             WHERE id = activate_ri_plans.activator_id
               AND event_id = ?
               AND magic_token_hash = ?
           )
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
      env.ACTIVATE_RI_EVENT_ID,
      magicTokenHash,
    )
    .run();

  if ((result.meta?.changes ?? 0) < 1) {
    return { ok: false, status: 404, error: "Stop not found" };
  }

  return { ok: true };
}

export async function markEditLinkEmailEvent(
  env: Env,
  planId: string | undefined,
  activatorId: string,
  actorEmail: string,
  action: "edit-link-sent" | "edit-link-send-failed" | "edit-link-resent",
  summary: string,
  details: unknown = {},
  now = new Date().toISOString(),
): Promise<void> {
  const statements = [
    activityInsert(env, {
      planId,
      actorType: "system",
      actorEmail,
      action,
      summary,
      details,
    }, now),
  ];

  if (action === "edit-link-sent" && planId) {
    statements.push(
      env.DB.prepare(
        `UPDATE activate_ri_plans
         SET edit_link_sent_at = COALESCE(edit_link_sent_at, ?),
             last_edit_link_sent_at = ?,
             updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(now, now, now, planId, env.ACTIVATE_RI_EVENT_ID),
    );
    statements.push(
      env.DB.prepare(
        `UPDATE activate_ri_activators
         SET magic_link_sent_at = COALESCE(magic_link_sent_at, ?),
             last_magic_link_sent_at = ?,
             updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(now, now, now, activatorId, env.ACTIVATE_RI_EVENT_ID),
    );
  } else if (action === "edit-link-resent") {
    if (planId) {
    statements.push(
      env.DB.prepare(
        `UPDATE activate_ri_plans
         SET last_edit_link_sent_at = ?,
             updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(now, now, planId, env.ACTIVATE_RI_EVENT_ID),
    );
    }
    statements.push(
      env.DB.prepare(
        `UPDATE activate_ri_activators
         SET last_magic_link_sent_at = ?,
             updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(now, now, activatorId, env.ACTIVATE_RI_EVENT_ID),
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
     (id, event_id, plan_id, stop_id, actor_type, actor_email, action, summary, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    env.ACTIVATE_RI_EVENT_ID,
    event.planId ?? null,
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
  plan_id: string | null;
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
    plan_id: row.plan_id,
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

function activatorIdForEmail(eventId: string, email: string): string {
  return `${eventId}:${email}`;
}

function planSnapshot(plan: EditablePlanDto): Record<string, string> {
  return {
    submitterCallsign: plan.submitter_callsign,
    submitterName: plan.submitter_name,
    submitterEmail: plan.submitter_email,
    club: plan.club,
    publicNotes: plan.public_notes,
    organizerNotes: plan.organizer_notes,
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

const planSelectSql = `SELECT
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
