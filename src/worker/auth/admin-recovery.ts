import { generateEditToken, tokenHash } from "../edit-token";
import { sendAuthAccessEmail } from "../email";
import type { Env } from "../env";
import { trustedSiteUrl } from "../origin";
import { authAuditStatement } from "./audit";
import { getUserById } from "./db";
import { authSessionCookie, createAuthSession, privilegedSessionLifetimeSeconds } from "./session";

export type AdminAccountSummary = {
  userId: string | null;
  email: string;
  callsign: string | null;
  displayName: string;
  admin: boolean;
  claimed: boolean;
  disabled: boolean;
  passkeyCount: number;
  lastPasskeyUse: string | null;
  activeSessionCount: number;
};

type AccountRow = {
  user_id: string;
  email_normalized: string | null;
  display_name: string;
  disabled_at: string | null;
  admin_role: number;
  primary_callsign: string | null;
  passkey_count: number;
  last_passkey_use: string | null;
  session_count: number;
};

type RelatedUserRow = {
  user_id: string;
  email_normalized: string;
  primary_callsign: string | null;
  admin_role: number;
  activator_id: string | null;
};

type ResetTokenRow = {
  user_id: string;
  expires_at: string;
};

export async function listAdminAccounts(env: Env): Promise<AdminAccountSummary[]> {
  const claimed = await env.DB.prepare(
    `SELECT
       u.id AS user_id,
       pe.email_normalized,
       u.display_name,
       u.disabled_at,
       CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS admin_role,
       a.primary_callsign,
       (SELECT COUNT(*) FROM auth_passkey_credentials p WHERE p.user_id = u.id AND p.revoked_at IS NULL) AS passkey_count,
       (SELECT MAX(p.last_used_at) FROM auth_passkey_credentials p WHERE p.user_id = u.id AND p.revoked_at IS NULL) AS last_passkey_use,
       (SELECT COUNT(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > datetime('now')) AS session_count
     FROM auth_users u
     LEFT JOIN auth_user_emails pe ON pe.user_id = u.id AND pe.is_primary = 1 AND pe.verified_at IS NOT NULL
     LEFT JOIN auth_event_roles r ON r.user_id = u.id AND r.event_id = ? AND r.role = 'admin' AND r.revoked_at IS NULL
     LEFT JOIN auth_activator_memberships m ON m.user_id = u.id AND m.event_id = ? AND m.revoked_at IS NULL
     LEFT JOIN activate_ri_activators a ON a.id = m.activator_id AND a.event_id = m.event_id
     WHERE r.user_id IS NOT NULL OR m.user_id IS NOT NULL
     ORDER BY COALESCE(a.primary_callsign, pe.email_normalized)`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID).all<AccountRow>();
  const unclaimed = await env.DB.prepare(
    `SELECT a.email_normalized, a.name, a.primary_callsign
     FROM activate_ri_activators a
     WHERE a.event_id = ? AND NOT EXISTS (
       SELECT 1 FROM auth_activator_memberships m
       WHERE m.event_id = a.event_id AND m.activator_id = a.id AND m.revoked_at IS NULL
     )
     ORDER BY a.primary_callsign`,
  ).bind(env.ACTIVATE_RI_EVENT_ID).all<{
    email_normalized: string;
    name: string;
    primary_callsign: string;
  }>();
  return [
    ...(claimed.results ?? []).map((row) => ({
      userId: row.user_id,
      email: row.email_normalized ?? "",
      callsign: row.primary_callsign,
      displayName: row.display_name,
      admin: row.admin_role === 1,
      claimed: true,
      disabled: row.disabled_at !== null,
      passkeyCount: row.passkey_count,
      lastPasskeyUse: row.last_passkey_use,
      activeSessionCount: row.session_count,
    })),
    ...(unclaimed.results ?? []).map((row) => ({
      userId: null,
      email: row.email_normalized,
      callsign: row.primary_callsign,
      displayName: row.name,
      admin: false,
      claimed: false,
      disabled: false,
      passkeyCount: 0,
      lastPasskeyUse: null,
      activeSessionCount: 0,
    })),
  ];
}

export async function requestPasskeyReset(
  request: Request,
  env: Env,
  actorUserId: string,
  subjectUserId: string,
): Promise<"sent" | "failed" | "not-found"> {
  const related = await relatedUser(env, subjectUserId);
  if (!related) {
    return "not-found";
  }
  const rawToken = generateEditToken();
  const hash = await tokenHash(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE auth_email_tokens SET used_at = ?
       WHERE purpose = 'passkey-reset' AND user_id = ? AND used_at IS NULL`,
    ).bind(now.toISOString(), subjectUserId),
    env.DB.prepare(
      `INSERT INTO auth_email_tokens (
         token_hash, purpose, email_normalized, user_id, created_by_user_id, created_at, expires_at
       ) VALUES (?, 'passkey-reset', ?, ?, ?, ?, ?)`,
    ).bind(hash, related.email_normalized, subjectUserId, actorUserId, now.toISOString(), expiresAt),
  ]);
  const accessUrl = trustedSiteUrl(request, env, "/account/access/?purpose=passkey-reset");
  accessUrl.hash = rawToken;
  const delivery = await sendAuthAccessEmail(env, {
    to: related.email_normalized,
    accessUrl: accessUrl.href,
    purpose: "passkey-reset",
  });
  if (delivery.status !== "sent") {
    await env.DB.prepare(
      `UPDATE auth_email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`,
    ).bind(new Date().toISOString(), hash).run();
  }
  await authAuditStatement(env, {
    action: "passkey-reset-requested",
    summary: delivery.status === "sent" ? "Sent a non-destructive passkey reset link." : "Passkey reset delivery failed; existing access was unchanged.",
    actorUserId,
    subjectUserId,
    details: { deliveryStatus: delivery.status },
  }).run();
  return delivery.status === "sent" ? "sent" : "failed";
}

export async function consumePasskeyReset(
  env: Env,
  rawToken: string,
  now = new Date(),
): Promise<{ cookie: string; expiresAt: string } | null> {
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
    return null;
  }
  const hash = await tokenHash(rawToken);
  const row = await env.DB.prepare(
    `SELECT user_id, expires_at FROM auth_email_tokens
     WHERE token_hash = ? AND purpose = 'passkey-reset' AND used_at IS NULL AND expires_at > ?
     LIMIT 1`,
  ).bind(hash, now.toISOString()).first<ResetTokenRow>();
  if (!row) {
    return null;
  }
  const user = await getUserById(env, row.user_id);
  if (!user || user.disabledAt) {
    return null;
  }
  const consumed = await env.DB.prepare(
    `UPDATE auth_email_tokens SET used_at = ?
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
  ).bind(now.toISOString(), hash, now.toISOString()).run();
  if ((consumed.meta.changes ?? 0) !== 1) {
    return null;
  }
  const session = await createAuthSession(env, {
    userId: user.id,
    purpose: "recovery",
    authenticationMethod: "email",
  }, now);
  return {
    cookie: authSessionCookie(session.token, privilegedSessionLifetimeSeconds),
    expiresAt: session.expiresAt,
  };
}

export async function revokeAccountSessions(
  env: Env,
  actorUserId: string,
  subjectUserId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  if (!await relatedUser(env, subjectUserId)) return false;
  await env.DB.batch([
    env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, subjectUserId),
    env.DB.prepare(
      `UPDATE activate_ri_activator_sessions SET revoked_at = ?
       WHERE revoked_at IS NULL AND activator_id IN (
         SELECT activator_id FROM auth_activator_memberships
         WHERE user_id = ? AND event_id = ? AND revoked_at IS NULL
       )`,
    ).bind(now, subjectUserId, env.ACTIVATE_RI_EVENT_ID),
    authAuditStatement(env, {
      action: "session-revoked",
      summary: "An administrator revoked all account sessions.",
      actorUserId,
      subjectUserId,
      createdAt: now,
    }),
  ]);
  return true;
}

export async function disableAccount(
  env: Env,
  actorUserId: string,
  subjectUserId: string,
  confirmation: string,
  now = new Date().toISOString(),
): Promise<"disabled" | "confirmation" | "not-found"> {
  const related = await relatedUser(env, subjectUserId);
  if (!related) return "not-found";
  const expected = related.primary_callsign ?? related.email_normalized;
  if (confirmation.trim().toUpperCase() !== expected.trim().toUpperCase()) return "confirmation";
  await env.DB.batch([
    env.DB.prepare(`UPDATE auth_users SET disabled_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, subjectUserId),
    env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, subjectUserId),
    env.DB.prepare(`UPDATE auth_passkey_credentials SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, subjectUserId),
    env.DB.prepare(`UPDATE auth_email_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(now, subjectUserId),
    env.DB.prepare(
      `UPDATE activate_ri_activator_sessions SET revoked_at = ?
       WHERE revoked_at IS NULL AND activator_id IN (
         SELECT activator_id FROM auth_activator_memberships
         WHERE user_id = ? AND event_id = ? AND revoked_at IS NULL
       )`,
    ).bind(now, subjectUserId, env.ACTIVATE_RI_EVENT_ID),
    authAuditStatement(env, {
      action: "user-disabled",
      summary: "Emergency-disabled an event account and revoked its credentials and sessions.",
      actorUserId,
      subjectUserId,
      details: { alsoAdmin: related.admin_role === 1 },
      createdAt: now,
    }),
  ]);
  return "disabled";
}

export async function enableAccount(
  env: Env,
  actorUserId: string,
  subjectUserId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  if (!await relatedUser(env, subjectUserId)) return false;
  await env.DB.batch([
    env.DB.prepare(`UPDATE auth_users SET disabled_at = NULL, updated_at = ? WHERE id = ?`).bind(now, subjectUserId),
    authAuditStatement(env, {
      action: "user-enabled",
      summary: "Re-enabled an event account; passkey recovery is still required.",
      actorUserId,
      subjectUserId,
      createdAt: now,
    }),
  ]);
  return true;
}

async function relatedUser(env: Env, userId: string): Promise<RelatedUserRow | null> {
  return env.DB.prepare(
    `SELECT
       u.id AS user_id,
       pe.email_normalized,
       a.primary_callsign,
       CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS admin_role,
       a.id AS activator_id
     FROM auth_users u
     INNER JOIN auth_user_emails pe ON pe.user_id = u.id AND pe.is_primary = 1 AND pe.verified_at IS NOT NULL
     LEFT JOIN auth_event_roles r ON r.user_id = u.id AND r.event_id = ? AND r.role = 'admin' AND r.revoked_at IS NULL
     LEFT JOIN auth_activator_memberships m ON m.user_id = u.id AND m.event_id = ? AND m.revoked_at IS NULL
     LEFT JOIN activate_ri_activators a ON a.id = m.activator_id AND a.event_id = m.event_id
     WHERE u.id = ? AND (r.user_id IS NOT NULL OR m.user_id IS NOT NULL)
     LIMIT 1`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, env.ACTIVATE_RI_EVENT_ID, userId).first<RelatedUserRow>();
}
