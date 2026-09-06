import type { Env } from "./env";
import { json, readJson } from "./http";
import { hasTrustedOrigin } from "./origin";
import { tokenHash } from "./edit-token";
import { withPrivateHeaders } from "./private-response";

export async function opsEmailPreferencesResponse(
  request: Request,
  env: Env,
  identity: { email: string; adminUserId?: string; localAdmin?: boolean },
): Promise<Response> {
  const email = identity.email.trim().toLowerCase();
  const respond = (body: unknown, status = 200) => withPrivateHeaders(json(body, { status }));
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      `SELECT email_enabled, chat_messages FROM activate_ri_ops_email_preferences
       WHERE event_id = ? AND email_normalized = ?`,
    ).bind(env.ACTIVATE_RI_EVENT_ID, email)
      .first<{ email_enabled: number; chat_messages: number }>();
    return respond({ ok: true, emailEnabled: row?.email_enabled !== 0, chatMessages: row?.chat_messages === 1 });
  }
  if (request.method !== "PATCH") return respond({ ok: false, error: "Method not allowed" }, 405);
  if (!hasTrustedOrigin(request, env)) return respond({ ok: false, error: "Forbidden" }, 403);
  let payload: unknown;
  try { payload = await readJson(request); }
  catch { return respond({ ok: false, error: "Expected valid JSON." }, 400); }
  if (!payload || typeof payload !== "object" ||
      !("emailEnabled" in payload) || typeof payload.emailEnabled !== "boolean" ||
      !("chatMessages" in payload) || typeof payload.chatMessages !== "boolean") {
    return respond({ ok: false, error: "Choose your Ops Room email preferences." }, 400);
  }
  await env.DB.prepare(
    `INSERT INTO activate_ri_ops_email_preferences (
       event_id, email_normalized, email_enabled, chat_messages, author_key,
       admin_user_id, local_admin, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, email_normalized) DO UPDATE SET
       email_enabled = excluded.email_enabled, chat_messages = excluded.chat_messages,
       admin_user_id = COALESCE(excluded.admin_user_id, admin_user_id),
       local_admin = MAX(local_admin, excluded.local_admin), updated_at = excluded.updated_at`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, email, Number(payload.emailEnabled), Number(payload.chatMessages),
    `admin:${await tokenHash(email)}`, identity.adminUserId ?? null,
    Number(identity.localAdmin ?? false), new Date().toISOString()).run();
  return respond({ ok: true, emailEnabled: payload.emailEnabled, chatMessages: payload.chatMessages });
}

// Every audience lookup rechecks current membership, consent, and admin grants.
// Header-auth subscriptions are usable only in explicitly configured local tests.
export function opsEmailAudienceSql(env: Env): string {
  const localAdminAllowed = env.ALLOW_LOCAL_ADMIN_AUTH === "true" || env.ALLOW_ADMIN_HEADER_AUTH === "true";
  return `
    SELECT a.event_id, a.email_normalized, 0 AS is_admin,
           COALESCE(p.chat_messages, 0) AS chat_messages
    FROM activate_ri_activators a
    INNER JOIN activate_ri_ops_memberships m ON m.activator_id = a.id AND m.event_id = a.event_id
    LEFT JOIN activate_ri_ops_email_preferences p ON p.event_id = a.event_id AND p.email_normalized = a.email_normalized
    WHERE a.status = 'approved' AND m.status IN ('active', 'muted') AND COALESCE(p.email_enabled, 1) = 1
    UNION ALL
    SELECT p.event_id, p.email_normalized, 1 AS is_admin, p.chat_messages
    FROM activate_ri_ops_email_preferences p
    WHERE p.email_enabled = 1 AND (
      EXISTS (
        SELECT 1 FROM auth_event_roles r
        INNER JOIN auth_users u ON u.id = r.user_id AND u.disabled_at IS NULL
        INNER JOIN auth_user_emails e ON e.user_id = u.id AND e.verified_at IS NOT NULL
        WHERE r.user_id = p.admin_user_id AND r.event_id = p.event_id
          AND r.role = 'admin' AND r.revoked_at IS NULL AND e.email_normalized = p.email_normalized
      ) OR (p.local_admin = 1 AND ${localAdminAllowed ? "1" : "0"} = 1)
    )`;
}
