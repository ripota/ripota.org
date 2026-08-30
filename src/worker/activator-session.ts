import { generateEditToken, tokenHash } from "./edit-token";
import type { Env } from "./env";
import { json } from "./http";
import { withPrivateHeaders } from "./private-response";

export const activatorSessionCookieName = "__Host-activate-ri-session";
export const activatorSessionLifetimeSeconds = 14 * 24 * 60 * 60;

export type ActivatorSessionIdentity = {
  activatorId: string;
  eventId: string;
  callsign: string;
  name: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  expiresAt: string;
};

type SessionLookupRow = {
  activator_id: string;
  event_id: string;
  primary_callsign: string;
  name: string;
  status: ActivatorSessionIdentity["status"];
  expires_at: string;
};

type EditTokenActivatorRow = {
  activator_id: string;
  event_id: string;
  primary_callsign: string;
  name: string;
  status: ActivatorSessionIdentity["status"];
};

export async function createActivatorSession(
  env: Env,
  editToken: string,
  now = new Date(),
): Promise<{ identity: ActivatorSessionIdentity; sessionToken: string } | null> {
  const editTokenHash = await tokenHash(editToken);
  const activator = await env.DB.prepare(
    `SELECT
       a.id AS activator_id,
       a.event_id,
       a.primary_callsign,
       a.name,
       a.status
     FROM activate_ri_edit_tokens t
     INNER JOIN activate_ri_activators a ON a.id = t.activator_id
     LEFT JOIN auth_activator_memberships m
       ON m.activator_id = a.id AND m.event_id = a.event_id AND m.revoked_at IS NULL
     LEFT JOIN auth_users u ON u.id = m.user_id
     WHERE t.event_id = ?
       AND a.event_id = t.event_id
       AND t.token_hash = ?
       AND t.revoked_at IS NULL
       AND (m.user_id IS NULL OR u.disabled_at IS NULL)
     LIMIT 1`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, editTokenHash)
    .first<EditTokenActivatorRow>();

  if (!activator) {
    return null;
  }

  const sessionToken = generateEditToken();
  const sessionTokenHash = await tokenHash(sessionToken);
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + activatorSessionLifetimeSeconds * 1000,
  ).toISOString();

  await env.DB.prepare(
    `INSERT INTO activate_ri_activator_sessions (
       token_hash, event_id, activator_id, created_at, expires_at
     ) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionTokenHash,
      env.ACTIVATE_RI_EVENT_ID,
      activator.activator_id,
      createdAt,
      expiresAt,
    )
    .run();

  return {
    sessionToken,
    identity: {
      activatorId: activator.activator_id,
      eventId: activator.event_id,
      callsign: activator.primary_callsign,
      name: activator.name,
      status: activator.status,
      expiresAt,
    },
  };
}

export async function getActivatorSession(
  request: Request,
  env: Env,
  now = new Date(),
): Promise<ActivatorSessionIdentity | null> {
  const rawToken = cookieValue(
    request.headers.get("cookie"),
    activatorSessionCookieName,
  );
  if (!rawToken) {
    return null;
  }

  const row = await env.DB.prepare(
    `SELECT
       s.activator_id,
       s.event_id,
       s.expires_at,
       a.primary_callsign,
       a.name,
       a.status
     FROM activate_ri_activator_sessions s
     INNER JOIN activate_ri_activators a ON a.id = s.activator_id
     WHERE s.event_id = ?
       AND a.event_id = s.event_id
       AND s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
     LIMIT 1`,
  )
    .bind(env.ACTIVATE_RI_EVENT_ID, await tokenHash(rawToken), now.toISOString())
    .first<SessionLookupRow>();

  if (!row) {
    return null;
  }

  return {
    activatorId: row.activator_id,
    eventId: row.event_id,
    callsign: row.primary_callsign,
    name: row.name,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

export async function requireActivatorSession(
  request: Request,
  env: Env,
): Promise<ActivatorSessionIdentity | Response> {
  const identity = await getActivatorSession(request, env);
  return identity ?? withPrivateHeaders(
    json({ ok: false, error: "Unauthorized" }, { status: 401 }),
  );
}

export async function revokeCurrentActivatorSession(
  request: Request,
  env: Env,
  now = new Date().toISOString(),
): Promise<void> {
  const rawToken = cookieValue(
    request.headers.get("cookie"),
    activatorSessionCookieName,
  );
  if (!rawToken) {
    return;
  }

  await env.DB.prepare(
    `UPDATE activate_ri_activator_sessions
     SET revoked_at = ?
     WHERE event_id = ? AND token_hash = ? AND revoked_at IS NULL`,
  )
    .bind(now, env.ACTIVATE_RI_EVENT_ID, await tokenHash(rawToken))
    .run();
}

export function activatorSessionCookie(sessionToken: string): string {
  return [
    `${activatorSessionCookieName}=${sessionToken}`,
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${activatorSessionLifetimeSeconds}`,
  ].join("; ");
}

export function clearActivatorSessionCookie(): string {
  return [
    `${activatorSessionCookieName}=`,
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=0",
  ].join("; ");
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }

    const value = part.slice(separator + 1).trim();
    return value || null;
  }

  return null;
}
