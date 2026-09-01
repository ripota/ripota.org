import type { Env } from "../env";

export type AuthAuditInput = {
  action: string;
  summary: string;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  eventId?: string | null;
  details?: Record<string, string | number | boolean | null>;
  createdAt?: string;
};

export function authAuditStatement(env: Env, input: AuthAuditInput): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO auth_audit_events (
       id, event_id, actor_user_id, subject_user_id, action, summary,
       details_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.eventId === undefined ? env.ACTIVATE_RI_EVENT_ID : input.eventId,
    input.actorUserId ?? null,
    input.subjectUserId ?? null,
    input.action,
    input.summary,
    JSON.stringify(input.details ?? {}),
    input.createdAt ?? new Date().toISOString(),
  );
}

export async function writeAuthAudit(env: Env, input: AuthAuditInput): Promise<void> {
  await authAuditStatement(env, input).run();
}
