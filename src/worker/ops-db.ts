import type {
  CreateOpsMessageInput,
  EditOpsMessageInput,
  OpsActor,
  OpsBootstrapDto,
  OpsEvent,
  OpsMembershipStatus,
  OpsMessageDto,
  OpsMessageKind,
  OpsRoomMode,
} from "../lib/activate-ri/ops-types";
import { isOpsMessageWithinEditWindow, OPS_MESSAGE_EDIT_WINDOW_MS } from "../lib/activate-ri/ops-editing";
import type { Env } from "./env";
import { queueOpsMessageEmails } from "./ops-notifications";

type MembershipRow = {
  status: OpsMembershipStatus;
  accepted_rules_version: string | null;
  accepted_rules_at: string | null;
  chat_display_name: string | null;
};

type SettingsRow = {
  room_mode: OpsRoomMode;
  pinned_message_id: string | null;
  rules_version: string;
  updated_at: string;
  updated_by: string;
};

type MessageRow = {
  id: string;
  author_type: "activator" | "admin" | "system";
  author_activator_id: string | null;
  author_label: string;
  kind: OpsMessageKind;
  body: string;
  park_reference: string | null;
  stop_id: string | null;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  removed_at: string | null;
  removed_by: string;
};

type EventRow = {
  sequence: number;
  event_type: OpsEvent["type"];
  message_id: string | null;
  metadata_json: string;
  created_at: string;
  id: string | null;
  author_type: MessageRow["author_type"] | null;
  author_activator_id: string | null;
  author_label: string | null;
  kind: OpsMessageKind | null;
  body: string | null;
  park_reference: string | null;
  stop_id: string | null;
  message_created_at: string | null;
  edited_at: string | null;
  resolved_at: string | null;
  removed_at: string | null;
  removed_by: string | null;
};

export type OpsAccess = {
  membership: MembershipRow;
  settings: SettingsRow;
  effectiveRoomMode: OpsRoomMode;
  hardDisabled: boolean;
};

export async function getOpsAccess(
  env: Env,
  activatorId: string,
): Promise<OpsAccess | null> {
  const [membershipResult, settingsResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT status, accepted_rules_version, accepted_rules_at, chat_display_name
       FROM activate_ri_ops_memberships
       WHERE event_id = ? AND activator_id = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, activatorId),
    env.DB.prepare(
      `SELECT room_mode, pinned_message_id, rules_version, updated_at, updated_by
       FROM activate_ri_ops_settings
       WHERE event_id = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID),
  ]);
  const membership = (membershipResult.results?.[0] ?? null) as MembershipRow | null;
  const settings = (settingsResult.results?.[0] ?? null) as SettingsRow | null;
  if (!membership || !settings) {
    return null;
  }

  const hardDisabled = env.ACTIVATE_RI_OPS_HARD_DISABLED === "true";
  return {
    membership,
    settings,
    effectiveRoomMode: hardDisabled ? "off" : settings.room_mode,
    hardDisabled,
  };
}

export async function getOpsMessage(env: Env, messageId: string): Promise<OpsMessageDto | null> {
  const row = await env.DB.prepare(`${messageSelectSql}
    WHERE event_id = ? AND id = ? AND removed_at IS NULL`)
    .bind(env.ACTIVATE_RI_EVENT_ID, messageId).first<MessageRow>();
  return row ? toMessageDto(row) : null;
}

export async function getOpsBootstrap(
  env: Env,
  activatorId: string,
): Promise<OpsBootstrapDto | null> {
  const [accessResult, settingsResult, messagesResult, pinResult, stopsResult, cursorResult] =
    await env.DB.batch([
      env.DB.prepare(
        `SELECT status, accepted_rules_version, accepted_rules_at, chat_display_name
         FROM activate_ri_ops_memberships
         WHERE event_id = ? AND activator_id = ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID, activatorId),
      env.DB.prepare(
        `SELECT room_mode, pinned_message_id, rules_version, updated_at, updated_by
         FROM activate_ri_ops_settings WHERE event_id = ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID),
      env.DB.prepare(
        `${messageSelectSql}
         WHERE event_id = ? AND removed_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 50`,
      ).bind(env.ACTIVATE_RI_EVENT_ID),
      env.DB.prepare(
        `${messageSelectSql}
         WHERE id = (
           SELECT pinned_message_id FROM activate_ri_ops_settings WHERE event_id = ?
         ) AND event_id = ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID),
      env.DB.prepare(
        `SELECT id, park_reference, start_at, end_at
         FROM activate_ri_stops
         WHERE event_id = ? AND activator_id = ?
           AND status IN ('scheduled', 'delayed')
         ORDER BY start_at ASC`,
      ).bind(env.ACTIVATE_RI_EVENT_ID, activatorId),
      env.DB.prepare(
        `SELECT COALESCE(MAX(sequence), 0) AS cursor
         FROM activate_ri_ops_events WHERE event_id = ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID),
    ]);

  const membership = (accessResult.results?.[0] ?? null) as MembershipRow | null;
  const settings = (settingsResult.results?.[0] ?? null) as SettingsRow | null;
  if (!membership || !settings || membership.status === "banned") {
    return null;
  }

  const messages = (messagesResult.results ?? []) as MessageRow[];
  const pinned = (pinResult.results?.[0] ?? null) as MessageRow | null;
  const stops = (stopsResult.results ?? []) as Array<{
    id: string;
    park_reference: string;
    start_at: string;
    end_at: string;
  }>;
  const cursor = (cursorResult.results?.[0] as { cursor?: number } | undefined)?.cursor ?? 0;

  return {
    membership: {
      status: membership.status,
      ...(membership.accepted_rules_version
        ? { acceptedRulesVersion: membership.accepted_rules_version }
        : {}),
      ...(membership.accepted_rules_at
        ? { acceptedRulesAt: membership.accepted_rules_at }
        : {}),
    },
    rulesVersion: settings.rules_version,
    roomMode: env.ACTIVATE_RI_OPS_HARD_DISABLED === "true" ? "off" : settings.room_mode,
    pinnedMessage: pinned ? toMessageDto(pinned) : null,
    messages: messages.reverse().map(toMessageDto),
    upcomingStops: stops.map((stop) => ({
      id: stop.id,
      parkReference: stop.park_reference,
      startAt: stop.start_at,
      endAt: stop.end_at,
    })),
    cursor,
  };
}

export async function acceptOpsRules(
  env: Env,
  activatorId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE activate_ri_ops_memberships
     SET accepted_rules_version = (
           SELECT rules_version FROM activate_ri_ops_settings WHERE event_id = ?
         ),
         accepted_rules_at = ?,
         updated_at = ?
     WHERE event_id = ? AND activator_id = ? AND status IN ('active', 'muted')`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, now, now, env.ACTIVATE_RI_EVENT_ID, activatorId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function createOpsMessage(
  env: Env,
  actor: Extract<OpsActor, { type: "activator" }>,
  input: CreateOpsMessageInput,
  now = new Date().toISOString(),
): Promise<OpsEvent | null> {
  const messageId = crypto.randomUUID();
  const authorKey = `activator:${actor.activatorId}`;
  const context = await resolveMessageContext(env, actor.activatorId, input);
  if (!context.ok) {
    return null;
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO activate_ri_ops_messages (
         id, event_id, author_type, author_key, author_activator_id,
         author_label, kind, body, park_reference, stop_id, client_nonce, created_at
       )
       SELECT ?, ?, 'activator', ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM activate_ri_ops_memberships
         WHERE event_id = ? AND activator_id = ?
           AND status = 'active'
           AND accepted_rules_version = (
             SELECT rules_version FROM activate_ri_ops_settings WHERE event_id = ?
           )
       )
       AND EXISTS (
         SELECT 1 FROM activate_ri_ops_settings
         WHERE event_id = ? AND room_mode = 'full'
       )`,
    ).bind(
      messageId,
      env.ACTIVATE_RI_EVENT_ID,
      authorKey,
      actor.activatorId,
      actor.label,
      input.kind,
      input.body,
      context.parkReference,
      context.stopId,
      input.clientNonce,
      now,
      env.ACTIVATE_RI_EVENT_ID,
      actor.activatorId,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO activate_ri_ops_events (
         event_id, event_type, message_id, metadata_json, created_at
       )
       SELECT event_id, 'message-created', id, '{}', created_at
       FROM activate_ri_ops_messages
       WHERE event_id = ? AND author_key = ? AND client_nonce = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, authorKey, input.clientNonce),
    queueOpsMessageEmails(env, messageId),
  ]);

  return getMessageCreatedEvent(env, authorKey, input.clientNonce);
}

export async function createAdminOpsMessage(
  env: Env,
  actorKey: string,
  actorLabel: string,
  input: CreateOpsMessageInput,
  now = new Date().toISOString(),
): Promise<OpsEvent | null> {
  if (input.kind !== "chat" && input.kind !== "access-note") {
    return null;
  }
  const parkReference = input.context?.type === "park"
    ? input.context.parkReference
    : null;
  if (input.context?.type === "stop") {
    return null;
  }
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO activate_ri_ops_messages (
         id, event_id, author_type, author_key, author_label, kind, body,
         park_reference, client_nonce, created_at
       )
       SELECT ?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM activate_ri_ops_settings
         WHERE event_id = ? AND room_mode = 'full'
       )`,
    ).bind(
      messageId,
      env.ACTIVATE_RI_EVENT_ID,
      actorKey,
      actorLabel,
      input.kind,
      input.body,
      parkReference,
      input.clientNonce,
      now,
      env.ACTIVATE_RI_EVENT_ID,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO activate_ri_ops_events (
         event_id, event_type, message_id, metadata_json, created_at
       )
       SELECT event_id, 'message-created', id, '{}', created_at
       FROM activate_ri_ops_messages
       WHERE event_id = ? AND author_key = ? AND client_nonce = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, actorKey, input.clientNonce),
    queueOpsMessageEmails(env, messageId),
  ]);
  return getMessageCreatedEvent(env, actorKey, input.clientNonce);
}

export async function createAdminOpsAnnouncement(
  env: Env,
  actorKey: string,
  actorEmail: string,
  input: {
    clientNonce: string;
    body: string;
    context: { type: "park"; parkReference: string } | null;
    pin: boolean;
    emailEligibleActivators?: boolean;
  },
  now = new Date().toISOString(),
): Promise<OpsEvent[] | null> {
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO activate_ri_ops_messages (
         id, event_id, author_type, author_key, author_label, kind, body,
         park_reference, client_nonce, created_at, email_broadcast_requested
       ) VALUES (?, ?, 'admin', ?, 'Organizer', 'announcement', ?, ?, ?, ?, ?)`,
    ).bind(
      messageId,
      env.ACTIVATE_RI_EVENT_ID,
      actorKey,
      input.body,
      input.context?.parkReference ?? null,
      input.clientNonce,
      now,
      Number(input.emailEligibleActivators ?? false),
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO activate_ri_ops_events (
         event_id, event_type, message_id, metadata_json, created_at
       )
       SELECT event_id, 'message-created', id, '{}', created_at
       FROM activate_ri_ops_messages
       WHERE event_id = ? AND author_key = ? AND client_nonce = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, actorKey, input.clientNonce),
    ...(input.pin
      ? [
          env.DB.prepare(
            `UPDATE activate_ri_ops_settings
             SET pinned_message_id = (
               SELECT id FROM activate_ri_ops_messages
               WHERE event_id = ? AND author_key = ? AND client_nonce = ?
             ), updated_at = ?, updated_by = ?
             WHERE event_id = ?`,
          ).bind(
            env.ACTIVATE_RI_EVENT_ID,
            actorKey,
            input.clientNonce,
            now,
            actorEmail,
            env.ACTIVATE_RI_EVENT_ID,
          ),
          env.DB.prepare(
            `INSERT INTO activate_ri_ops_events (
               event_id, event_type, message_id, metadata_json, created_at
             )
             SELECT event_id, 'pin-changed', id, '{}', ?
             FROM activate_ri_ops_messages m
             WHERE event_id = ? AND author_key = ? AND client_nonce = ?
               AND NOT EXISTS (
                 SELECT 1 FROM activate_ri_ops_events e
                 WHERE e.event_id = m.event_id AND e.event_type = 'pin-changed'
                   AND e.message_id = m.id
               )`,
          ).bind(now, env.ACTIVATE_RI_EVENT_ID, actorKey, input.clientNonce),
        ]
      : []),
    env.DB.prepare(
      `INSERT INTO activate_ri_activity_events (
         id, event_id, actor_type, actor_email, action, summary, details_json, created_at
       )
       SELECT ?, ?, 'admin', ?, 'ops-announcement-created',
         'Organizer posted an Ops Room announcement.', ?, ?
       FROM activate_ri_ops_messages
       WHERE event_id = ? AND author_key = ? AND client_nonce = ? AND created_at = ?`,
    ).bind(
      crypto.randomUUID(),
      env.ACTIVATE_RI_EVENT_ID,
      actorEmail,
      JSON.stringify({ clientNonce: input.clientNonce, pinned: input.pin }),
      now,
      env.ACTIVATE_RI_EVENT_ID,
      actorKey,
      input.clientNonce,
      now,
    ),
    queueOpsMessageEmails(env, messageId),
  ]);
  const created = await getMessageCreatedEvent(env, actorKey, input.clientNonce);
  if (!created || created.type !== "message-created") return null;
  if (!input.pin) return [created];
  const pinRow = await env.DB.prepare(
    `${eventSelectSql}
     WHERE e.event_id = ? AND e.event_type = 'pin-changed'
       AND e.message_id = ? ORDER BY e.sequence DESC LIMIT 1`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, created.message.id).first<EventRow>();
  const pinEvent = pinRow ? toOpsEvent(pinRow) : null;
  return pinEvent ? [created, pinEvent] : [created];
}

export async function clearPinnedOpsAnnouncement(
  env: Env,
  actorEmail: string,
  expectedMessageId?: string,
  now = new Date().toISOString(),
): Promise<OpsEvent | null> {
  const settings = await env.DB.prepare(
    `SELECT pinned_message_id FROM activate_ri_ops_settings WHERE event_id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID).first<{ pinned_message_id: string | null }>();
  const pinnedMessageId = settings?.pinned_message_id;
  if (!pinnedMessageId || (expectedMessageId && pinnedMessageId !== expectedMessageId)) {
    return null;
  }

  const operationId = crypto.randomUUID();
  const metadata = JSON.stringify({ operationId });
  const [, , update] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO activate_ri_ops_events (
         event_id, event_type, message_id, metadata_json, created_at
       )
       SELECT ?, 'pin-changed', NULL, ?, ?
       FROM activate_ri_ops_settings
       WHERE event_id = ? AND pinned_message_id = ?`,
    ).bind(
      env.ACTIVATE_RI_EVENT_ID,
      metadata,
      now,
      env.ACTIVATE_RI_EVENT_ID,
      pinnedMessageId,
    ),
    env.DB.prepare(
      `INSERT INTO activate_ri_activity_events (
         id, event_id, actor_type, actor_email, action, summary, details_json, created_at
       )
       SELECT ?, ?, 'admin', ?, 'ops-announcement-unpinned',
         'Organizer cleared the pinned Ops Room announcement.', ?, ?
       FROM activate_ri_ops_settings
       WHERE event_id = ? AND pinned_message_id = ?`,
    ).bind(
      crypto.randomUUID(),
      env.ACTIVATE_RI_EVENT_ID,
      actorEmail,
      JSON.stringify({ messageId: pinnedMessageId }),
      now,
      env.ACTIVATE_RI_EVENT_ID,
      pinnedMessageId,
    ),
    env.DB.prepare(
      `UPDATE activate_ri_ops_settings
       SET pinned_message_id = NULL, updated_at = ?, updated_by = ?
       WHERE event_id = ? AND pinned_message_id = ?`,
    ).bind(now, actorEmail, env.ACTIVATE_RI_EVENT_ID, pinnedMessageId),
  ]);
  if ((update.meta?.changes ?? 0) === 0) return null;

  const row = await env.DB.prepare(
    `${eventSelectSql}
     WHERE e.event_id = ? AND e.event_type = 'pin-changed'
       AND e.message_id IS NULL AND e.metadata_json = ?
     ORDER BY e.sequence DESC LIMIT 1`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, metadata).first<EventRow>();
  return row ? toOpsEvent(row) : null;
}

export async function moderateOpsMessage(
  env: Env,
  messageId: string,
  action: "remove" | "resolve" | "reopen",
  actorEmail: string,
  reason: string,
  now = new Date().toISOString(),
): Promise<OpsEvent | null> {
  const message = await env.DB.prepare(
    `SELECT id, kind, removed_at, resolved_at FROM activate_ri_ops_messages
     WHERE event_id = ? AND id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, messageId).first<{
    id: string;
    kind: OpsMessageKind;
    removed_at: string | null;
    resolved_at: string | null;
  }>();
  if (!message || (action !== "remove" && !["need-backup", "access-note"].includes(message.kind))) {
    return null;
  }

  const eventType = action === "remove"
    ? "message-removed"
    : action === "resolve"
    ? "message-resolved"
    : "message-reopened";
  if ((action === "remove" && message.removed_at) ||
    (action === "resolve" && message.resolved_at) ||
    (action === "reopen" && !message.resolved_at)) {
    return latestMessageEvent(env, messageId, eventType);
  }
  const metadata = action === "remove"
    ? { removedAt: now, removedBy: "organizer" }
    : action === "resolve"
    ? { resolvedAt: now }
    : {};
  const update = action === "remove"
    ? env.DB.prepare(
        `UPDATE activate_ri_ops_messages
         SET body = '', removed_at = ?, removed_by = 'organizer', removal_reason = ?
         WHERE event_id = ? AND id = ? AND removed_at IS NULL`,
      ).bind(now, reason, env.ACTIVATE_RI_EVENT_ID, messageId)
    : action === "resolve"
    ? env.DB.prepare(
        `UPDATE activate_ri_ops_messages
         SET resolved_at = ?, resolved_by = ?, resolution_note = ?
         WHERE event_id = ? AND id = ? AND resolved_at IS NULL AND removed_at IS NULL`,
      ).bind(now, `admin:${actorEmail}`, reason, env.ACTIVATE_RI_EVENT_ID, messageId)
    : env.DB.prepare(
        `UPDATE activate_ri_ops_messages
         SET resolved_at = NULL, resolved_by = '', resolution_note = ?
         WHERE event_id = ? AND id = ? AND resolved_at IS NOT NULL AND removed_at IS NULL`,
      ).bind(reason, env.ACTIVATE_RI_EVENT_ID, messageId);
  await env.DB.batch([
    update,
    env.DB.prepare(
      `INSERT INTO activate_ri_ops_events (
         event_id, event_type, message_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, eventType, messageId, JSON.stringify(metadata), now),
    env.DB.prepare(
      `INSERT INTO activate_ri_activity_events (
         id, event_id, actor_type, actor_email, action, summary, details_json, created_at
       ) VALUES (?, ?, 'admin', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      env.ACTIVATE_RI_EVENT_ID,
      actorEmail,
      `ops-message-${action === "remove" ? "removed" : action === "resolve" ? "resolved" : "reopened"}`,
      `Organizer ${action === "remove" ? "removed" : action === "resolve" ? "resolved" : "reopened"} an Ops Room message.`,
      JSON.stringify({ messageId, reason }),
      now,
    ),
  ]);
  return latestMessageEvent(env, messageId, eventType);
}

export async function updateOpsMembership(
  env: Env,
  activatorId: string,
  status: OpsMembershipStatus,
  reason: string,
  actorEmail: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const existing = await env.DB.prepare(
    `SELECT status FROM activate_ri_ops_memberships
     WHERE event_id = ? AND activator_id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, activatorId).first<{ status: OpsMembershipStatus }>();
  if (!existing) return false;
  const action = status === "muted"
    ? "ops-member-muted"
    : status === "banned"
    ? "ops-member-banned"
    : existing.status === "muted"
    ? "ops-member-unmuted"
    : "ops-member-unbanned";
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_ops_memberships
       SET status = ?, moderation_reason = ?, moderated_at = ?, moderated_by = ?, updated_at = ?
       WHERE event_id = ? AND activator_id = ?`,
    ).bind(status, reason, now, actorEmail, now, env.ACTIVATE_RI_EVENT_ID, activatorId),
    env.DB.prepare(
      `INSERT INTO activate_ri_activity_events (
         id, event_id, plan_id, actor_type, actor_email, action, summary, details_json, created_at
       ) VALUES (?, ?, ?, 'admin', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      env.ACTIVATE_RI_EVENT_ID,
      activatorId,
      actorEmail,
      action,
      `Ops Room membership changed from ${existing.status} to ${status}.`,
      JSON.stringify({ activatorId, priorStatus: existing.status, status, reason }),
      now,
    ),
  ]);
  return true;
}

export async function listOpsEvents(
  env: Env,
  after: number,
  through: number,
  limit: number,
): Promise<{
  events: OpsEvent[];
  nextCursor: number;
  hasMore: boolean;
  resetRequired?: boolean;
}> {
  const bounds = await env.DB.prepare(
    `SELECT COALESCE(MIN(sequence), 0) AS minimum,
            COALESCE(MAX(sequence), 0) AS maximum
     FROM activate_ri_ops_events WHERE event_id = ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID).first<{ minimum: number; maximum: number }>();
  const minimum = bounds?.minimum ?? 0;
  const maximum = bounds?.maximum ?? 0;
  if (after > maximum || (minimum > 1 && after < minimum - 1)) {
    return { events: [], nextCursor: maximum, hasMore: false, resetRequired: true };
  }

  const cappedThrough = Math.min(through, maximum);
  const result = await env.DB.prepare(
    `${eventSelectSql}
     WHERE e.event_id = ? AND e.sequence > ? AND e.sequence <= ?
     ORDER BY e.sequence ASC
     LIMIT ?`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, after, cappedThrough, limit + 1).all<EventRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const events = page.map(toOpsEvent).filter((event): event is OpsEvent => event !== null);
  return {
    events,
    nextCursor: page.at(-1)?.sequence ?? after,
    hasMore,
  };
}

export async function removeOwnOpsMessage(
  env: Env,
  activatorId: string,
  messageId: string,
  now = new Date().toISOString(),
): Promise<OpsEvent | null> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_ops_messages
       SET body = '', removed_at = ?, removed_by = 'author', removal_reason = ''
       WHERE event_id = ? AND id = ? AND author_activator_id = ?
         AND removed_at IS NULL`,
    ).bind(now, env.ACTIVATE_RI_EVENT_ID, messageId, activatorId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO activate_ri_ops_events (
         event_id, event_type, message_id, metadata_json, created_at
       )
       SELECT event_id, 'message-removed', id, ?, ?
       FROM activate_ri_ops_messages
       WHERE event_id = ? AND id = ? AND author_activator_id = ?
         AND removed_at = ? AND removed_by = 'author'`,
    ).bind(
      JSON.stringify({ removedAt: now, removedBy: "author" }),
      now,
      env.ACTIVATE_RI_EVENT_ID,
      messageId,
      activatorId,
      now,
    ),
  ]);
  return latestMessageEvent(env, messageId, "message-removed");
}

export async function editOwnOpsMessage(
  env: Env,
  activatorId: string,
  messageId: string,
  input: EditOpsMessageInput,
  now = new Date().toISOString(),
): Promise<
  | { ok: true; event: Extract<OpsEvent, { type: "message-edited" }> }
  | { ok: false; reason: "not-found" | "expired" | "unavailable" }
> {
  const message = await env.DB.prepare(
    `SELECT created_at, removed_at FROM activate_ri_ops_messages
     WHERE event_id = ? AND id = ? AND author_type = 'activator'
       AND author_activator_id = ?
       AND kind IN ('chat', 'access-note', 'running-late', 'need-backup')`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, messageId, activatorId)
    .first<{ created_at: string; removed_at: string | null }>();
  if (!message) return { ok: false, reason: "not-found" };
  if (message.removed_at || env.ACTIVATE_RI_OPS_HARD_DISABLED === "true") {
    return { ok: false, reason: "unavailable" };
  }
  const nowMs = Date.parse(now);
  if (!isOpsMessageWithinEditWindow(message.created_at, nowMs)) {
    return { ok: false, reason: "expired" };
  }

  const metadata = JSON.stringify({ operationId: crypto.randomUUID() });
  const [, , eventResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_ops_messages
       SET body = ?, edited_at = ?
       WHERE event_id = ? AND id = ? AND author_type = 'activator'
         AND author_activator_id = ? AND removed_at IS NULL
         AND kind IN ('chat', 'access-note', 'running-late', 'need-backup')
         AND julianday(created_at) > julianday(?)
         AND julianday(created_at) <= julianday(?)
         AND EXISTS (
           SELECT 1 FROM activate_ri_ops_memberships
           WHERE event_id = ? AND activator_id = ? AND status = 'active'
             AND accepted_rules_version = (
               SELECT rules_version FROM activate_ri_ops_settings WHERE event_id = ?
             )
         )
         AND EXISTS (
           SELECT 1 FROM activate_ri_ops_settings WHERE event_id = ? AND room_mode = 'full'
         )`,
    ).bind(
      input.body,
      now,
      env.ACTIVATE_RI_EVENT_ID,
      messageId,
      activatorId,
      new Date(nowMs - OPS_MESSAGE_EDIT_WINDOW_MS).toISOString(),
      now,
      env.ACTIVATE_RI_EVENT_ID,
      activatorId,
      env.ACTIVATE_RI_EVENT_ID,
      env.ACTIVATE_RI_EVENT_ID,
    ),
    env.DB.prepare(
      `INSERT INTO activate_ri_ops_events (
         event_id, event_type, message_id, metadata_json, created_at
       )
       SELECT ?, 'message-edited', ?, ?, ? WHERE changes() > 0`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, messageId, metadata, now),
    env.DB.prepare(
      `${eventSelectSql}
       WHERE e.event_id = ? AND e.message_id = ?
         AND e.event_type = 'message-edited' AND e.metadata_json = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, messageId, metadata),
  ]);
  const row = eventResult.results?.[0] as EventRow | undefined;
  const event = row ? toOpsEvent(row) : null;
  return event?.type === "message-edited"
    ? { ok: true, event }
    : { ok: false, reason: "unavailable" };
}

export async function setOwnOpsMessageResolved(
  env: Env,
  activatorId: string,
  messageId: string,
  resolved: boolean,
  now = new Date().toISOString(),
): Promise<OpsEvent | null> {
  const eventType = resolved ? "message-resolved" : "message-reopened";
  if (resolved) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE activate_ri_ops_messages
         SET resolved_at = ?, resolved_by = ?, resolution_note = ''
         WHERE event_id = ? AND id = ? AND author_activator_id = ?
           AND kind IN ('need-backup', 'access-note')
           AND removed_at IS NULL AND resolved_at IS NULL`,
      ).bind(now, `activator:${activatorId}`, env.ACTIVATE_RI_EVENT_ID, messageId, activatorId),
      env.DB.prepare(
        `INSERT INTO activate_ri_ops_events (
           event_id, event_type, message_id, metadata_json, created_at
         )
         SELECT event_id, 'message-resolved', id, ?, ?
         FROM activate_ri_ops_messages
         WHERE event_id = ? AND id = ? AND author_activator_id = ?
           AND resolved_at = ?
           AND NOT EXISTS (
             SELECT 1 FROM activate_ri_ops_events
             WHERE event_id = ? AND message_id = ?
               AND event_type = 'message-resolved' AND created_at = ?
           )`,
      ).bind(
        JSON.stringify({ resolvedAt: now }),
        now,
        env.ACTIVATE_RI_EVENT_ID,
        messageId,
        activatorId,
        now,
        env.ACTIVATE_RI_EVENT_ID,
        messageId,
        now,
      ),
    ]);
  } else {
    const prior = await env.DB.prepare(
      `SELECT resolved_at FROM activate_ri_ops_messages
       WHERE event_id = ? AND id = ? AND author_activator_id = ?
         AND kind IN ('need-backup', 'access-note')
         AND removed_at IS NULL AND resolved_at IS NOT NULL`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, messageId, activatorId)
      .first<{ resolved_at: string }>();
    if (!prior) {
      return null;
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE activate_ri_ops_messages
         SET resolved_at = NULL, resolved_by = '', resolution_note = ''
         WHERE event_id = ? AND id = ? AND author_activator_id = ?
           AND resolved_at = ?`,
      ).bind(env.ACTIVATE_RI_EVENT_ID, messageId, activatorId, prior.resolved_at),
      env.DB.prepare(
        `INSERT INTO activate_ri_ops_events (
           event_id, event_type, message_id, metadata_json, created_at
         )
         SELECT event_id, 'message-reopened', id, '{}', ?
         FROM activate_ri_ops_messages
         WHERE event_id = ? AND id = ? AND author_activator_id = ?
           AND resolved_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM activate_ri_ops_events
             WHERE event_id = ? AND message_id = ?
               AND event_type = 'message-reopened' AND created_at = ?
           )`,
      ).bind(
        now,
        env.ACTIVATE_RI_EVENT_ID,
        messageId,
        activatorId,
        env.ACTIVATE_RI_EVENT_ID,
        messageId,
        now,
      ),
    ]);
  }
  return latestMessageEvent(env, messageId, eventType);
}

export async function getOpsAdminState(env: Env) {
  const [settings, messages, pinned, broadcasts, members, notifications, cursor] = await env.DB.batch([
    env.DB.prepare(
      `SELECT room_mode, pinned_message_id, rules_version, updated_at, updated_by
       FROM activate_ri_ops_settings WHERE event_id = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID),
    env.DB.prepare(
      `${messageSelectSql}
       WHERE event_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
    ).bind(env.ACTIVATE_RI_EVENT_ID),
    env.DB.prepare(
      `${messageSelectSql}
       WHERE id = (
         SELECT pinned_message_id FROM activate_ri_ops_settings WHERE event_id = ?
       ) AND event_id = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID),
    env.DB.prepare(
      `SELECT id, message_id, status, recipient_count, sent_count, failed_count, skipped_count,
              created_at, completed_at, last_error
       FROM activate_ri_ops_email_broadcasts
       WHERE event_id = ?
       UNION ALL
       SELECT m.id, m.id,
         CASE WHEN SUM(d.status IN ('pending', 'sending')) > 0 THEN 'sending'
           WHEN SUM(d.status = 'failed') > 0 THEN 'partial' ELSE 'sent' END,
         COUNT(d.message_id), COALESCE(SUM(d.status = 'sent'), 0),
         COALESCE(SUM(d.status = 'failed'), 0), COALESCE(SUM(d.status = 'skipped'), 0),
         m.created_at, MAX(d.sent_at), COALESCE(MAX(d.last_error), '')
       FROM activate_ri_ops_messages m
       LEFT JOIN activate_ri_ops_email_deliveries d ON d.message_id = m.id
       WHERE m.event_id = ? AND m.email_broadcast_requested = 1
       GROUP BY m.id ORDER BY created_at DESC LIMIT 25`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID),
    env.DB.prepare(
      `SELECT m.activator_id, m.status, m.accepted_rules_version,
              m.accepted_rules_at, m.moderation_reason,
              COALESCE(p.email_enabled, 1) AS email_enabled, a.primary_callsign, a.name
       FROM activate_ri_ops_memberships m
       INNER JOIN activate_ri_activators a ON a.id = m.activator_id
       LEFT JOIN activate_ri_ops_email_preferences p ON p.event_id = m.event_id AND p.email_normalized = a.email_normalized
       WHERE m.event_id = ? ORDER BY a.primary_callsign`,
    ).bind(env.ACTIVATE_RI_EVENT_ID),
    env.DB.prepare(
      `SELECT COALESCE(SUM(status IN ('pending', 'sending')), 0) AS pending,
              COALESCE(SUM(status = 'failed'), 0) AS failed,
              COALESCE(SUM(status = 'sent'), 0) AS sent
       FROM activate_ri_ops_email_deliveries WHERE event_id = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID),
    env.DB.prepare(
      `SELECT COALESCE(MAX(sequence), 0) AS cursor
       FROM activate_ri_ops_events WHERE event_id = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID),
  ]);
  const settingsRow = (settings.results?.[0] ?? null) as SettingsRow | null;
  const pinnedRow = (pinned.results?.[0] ?? null) as MessageRow | null;
  return {
    settings: settingsRow,
    pinnedMessage: pinnedRow ? toMessageDto(pinnedRow) : null,
    hardDisabled: env.ACTIVATE_RI_OPS_HARD_DISABLED === "true",
    members: members.results ?? [],
    messages: ((messages.results ?? []) as MessageRow[]).map(toMessageDto),
    broadcasts: broadcasts.results ?? [],
    notifications: notifications.results?.[0] ?? { pending: 0, failed: 0, sent: 0 },
    cursor: (cursor.results?.[0] as { cursor?: number } | undefined)?.cursor ?? 0,
  };
}

export async function updateOpsRoomMode(
  env: Env,
  roomMode: OpsRoomMode,
  actorEmail: string,
  now = new Date().toISOString(),
): Promise<OpsEvent> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_ops_settings
       SET room_mode = ?, updated_at = ?, updated_by = ?
       WHERE event_id = ?`,
    ).bind(roomMode, now, actorEmail, env.ACTIVATE_RI_EVENT_ID),
    env.DB.prepare(
      `INSERT INTO activate_ri_ops_events (
         event_id, event_type, metadata_json, created_at
       ) VALUES (?, 'room-mode-changed', ?, ?)`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, JSON.stringify({ mode: roomMode }), now),
    env.DB.prepare(
      `INSERT INTO activate_ri_activity_events (
         id, event_id, actor_type, actor_email, action, summary, details_json, created_at
       ) VALUES (?, ?, 'admin', ?, 'ops-room-mode-changed', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      env.ACTIVATE_RI_EVENT_ID,
      actorEmail,
      `Ops Room mode changed to ${roomMode}.`,
      JSON.stringify({ roomMode }),
      now,
    ),
  ]);
  const row = await env.DB.prepare(
    `SELECT sequence FROM activate_ri_ops_events
     WHERE event_id = ? AND event_type = 'room-mode-changed'
     ORDER BY sequence DESC LIMIT 1`,
  ).bind(env.ACTIVATE_RI_EVENT_ID).first<{ sequence: number }>();
  return { sequence: row?.sequence ?? 0, type: "room-mode-changed", mode: roomMode };
}

async function resolveMessageContext(
  env: Env,
  activatorId: string,
  input: CreateOpsMessageInput,
): Promise<{ ok: true; parkReference: string | null; stopId: string | null } | { ok: false }> {
  if (!input.context) {
    return { ok: true, parkReference: null, stopId: null };
  }
  if (input.context.type === "park") {
    return { ok: true, parkReference: input.context.parkReference, stopId: null };
  }
  const stop = await env.DB.prepare(
    `SELECT park_reference FROM activate_ri_stops
     WHERE event_id = ? AND activator_id = ? AND id = ?
       AND status IN ('scheduled', 'delayed')`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, activatorId, input.context.stopId)
    .first<{ park_reference: string }>();
  return stop
    ? { ok: true, parkReference: stop.park_reference, stopId: input.context.stopId }
    : { ok: false };
}

async function getMessageCreatedEvent(
  env: Env,
  authorKey: string,
  clientNonce: string,
): Promise<OpsEvent | null> {
  const row = await env.DB.prepare(
    `${eventSelectSql}
     WHERE e.event_id = ? AND e.event_type = 'message-created'
       AND m.author_key = ? AND m.client_nonce = ?
     LIMIT 1`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, authorKey, clientNonce).first<EventRow>();
  return row ? toOpsEvent(row) : null;
}

async function latestMessageEvent(
  env: Env,
  messageId: string,
  eventType: "message-removed" | "message-resolved" | "message-reopened",
): Promise<OpsEvent | null> {
  const row = await env.DB.prepare(
    `${eventSelectSql}
     WHERE e.event_id = ? AND e.message_id = ? AND e.event_type = ?
     ORDER BY e.sequence DESC LIMIT 1`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, messageId, eventType).first<EventRow>();
  return row ? toOpsEvent(row) : null;
}

const messageSelectSql = `SELECT
  id, author_type, author_activator_id, author_label, kind, body,
  park_reference, stop_id, created_at, edited_at, resolved_at, removed_at, removed_by
FROM activate_ri_ops_messages`;

const eventSelectSql = `SELECT
  e.sequence, e.event_type, e.message_id, e.metadata_json, e.created_at,
  m.id, m.author_type, m.author_activator_id, m.author_label, m.kind, m.body,
  m.park_reference, m.stop_id, m.created_at AS message_created_at,
  m.edited_at, m.resolved_at, m.removed_at, m.removed_by
FROM activate_ri_ops_events e
LEFT JOIN activate_ri_ops_messages m ON m.id = e.message_id`;

function toMessageDto(row: MessageRow): OpsMessageDto {
  const removedBy = row.removed_by === "author" || row.removed_by === "organizer"
    ? row.removed_by
    : undefined;
  return {
    id: row.id,
    kind: row.kind,
    authorType: row.author_type,
    authorLabel: row.author_label,
    ...(row.author_activator_id ? { authorActivatorId: row.author_activator_id } : {}),
    body: row.removed_at ? "" : row.body,
    ...(row.park_reference ? { parkReference: row.park_reference } : {}),
    ...(row.stop_id ? { stopId: row.stop_id } : {}),
    createdAt: row.created_at,
    ...(row.edited_at ? { editedAt: row.edited_at } : {}),
    resolved: row.resolved_at !== null,
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    removed: row.removed_at !== null,
    ...(row.removed_at ? { removedAt: row.removed_at } : {}),
    ...(removedBy ? { removedBy } : {}),
  };
}

function toOpsEvent(row: EventRow): OpsEvent | null {
  if (row.event_type === "message-created" && row.id && row.author_type &&
    row.author_label && row.kind && row.message_created_at !== null) {
    return {
      sequence: row.sequence,
      type: "message-created",
      message: toMessageDto({
        id: row.id,
        author_type: row.author_type,
        author_activator_id: row.author_activator_id,
        author_label: row.author_label,
        kind: row.kind,
        body: row.body ?? "",
        park_reference: row.park_reference,
        stop_id: row.stop_id,
        created_at: row.message_created_at,
        edited_at: row.edited_at,
        resolved_at: row.resolved_at,
        removed_at: row.removed_at,
        removed_by: row.removed_by ?? "",
      }),
    };
  }
  const metadata = safeMetadata(row.metadata_json);
  if (row.event_type === "message-edited" && row.id && row.message_id && row.edited_at) {
    // Replay uses the current text, just like message-created. Removed messages
    // stay redacted, and old versions are never retained in event metadata.
    return {
      sequence: row.sequence,
      type: row.event_type,
      messageId: row.message_id,
      body: row.removed_at ? "" : row.body ?? "",
      editedAt: row.edited_at,
    };
  }
  if (row.event_type === "room-mode-changed" && isRoomMode(metadata.mode)) {
    return { sequence: row.sequence, type: row.event_type, mode: metadata.mode };
  }
  if (row.event_type === "message-removed" && row.message_id &&
    typeof metadata.removedAt === "string" &&
    (metadata.removedBy === "author" || metadata.removedBy === "organizer")) {
    return {
      sequence: row.sequence,
      type: row.event_type,
      messageId: row.message_id,
      removedAt: metadata.removedAt,
      removedBy: metadata.removedBy,
    };
  }
  if ((row.event_type === "message-resolved" || row.event_type === "message-reopened") && row.message_id) {
    return {
      sequence: row.sequence,
      type: row.event_type,
      messageId: row.message_id,
      ...(typeof metadata.resolvedAt === "string" ? { resolvedAt: metadata.resolvedAt } : {}),
    };
  }
  if (row.event_type === "pin-changed") {
    const pinnedMessage = row.id && row.author_type && row.author_label && row.kind &&
        row.message_created_at
      ? toMessageDto({
          id: row.id,
          author_type: row.author_type,
          author_activator_id: row.author_activator_id,
          author_label: row.author_label,
          kind: row.kind,
          body: row.body ?? "",
          park_reference: row.park_reference,
          stop_id: row.stop_id,
          created_at: row.message_created_at,
          edited_at: row.edited_at,
          resolved_at: row.resolved_at,
          removed_at: row.removed_at,
          removed_by: row.removed_by ?? "",
        })
      : null;
    return { sequence: row.sequence, type: "pin-changed", pinnedMessage };
  }
  return null;
}

function safeMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function isRoomMode(value: unknown): value is OpsRoomMode {
  return value === "full" || value === "announcements" || value === "off";
}
