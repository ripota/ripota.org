import { generateEditToken, tokenHash } from "../edit-token";
import type { Env } from "../env";
import { authAuditStatement } from "./audit";
import { lookupAuthContext } from "./db";
import type { AuthContext, AuthMethod, AuthSessionPurpose } from "./types";

export const authSessionCookieName = "__Host-ripota-session";
export const authSessionLifetimeSeconds = 14 * 24 * 60 * 60;
export const privilegedSessionLifetimeSeconds = 30 * 60;

type CreateAuthSessionInput = {
  userId: string;
  purpose?: AuthSessionPurpose;
  authenticationMethod: AuthMethod;
  passkeyVerified?: boolean;
  ceremonyChallengeId?: string | null;
  sourceEmailTokenHash?: string | null;
};

export type PreparedAuthSession = {
  id: string;
  token: string;
  expiresAt: string;
  statement: D1PreparedStatement;
};

export async function prepareAuthSession(
  env: Env,
  input: CreateAuthSessionInput,
  now = new Date(),
): Promise<PreparedAuthSession> {
  const id = crypto.randomUUID();
  const token = generateEditToken();
  const createdAt = now.toISOString();
  const purpose = input.purpose ?? "authenticated";
  const lifetimeSeconds = purpose === "authenticated"
    ? authSessionLifetimeSeconds
    : privilegedSessionLifetimeSeconds;
  const expiresAt = new Date(now.getTime() + lifetimeSeconds * 1000).toISOString();
  const statement = env.DB.prepare(
    `INSERT INTO auth_sessions (
       id, token_hash, user_id, purpose, authentication_method,
       authenticated_at, passkey_verified_at, created_at, expires_at, last_used_at,
       ceremony_challenge_id, source_email_token_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    await tokenHash(token),
    input.userId,
    purpose,
    input.authenticationMethod,
    createdAt,
    input.passkeyVerified ? createdAt : null,
    createdAt,
    expiresAt,
    createdAt,
    input.ceremonyChallengeId ?? null,
    input.sourceEmailTokenHash ?? null,
  );
  return { id, token, expiresAt, statement };
}

export async function createAuthSession(
  env: Env,
  input: CreateAuthSessionInput,
  now = new Date(),
): Promise<{ id: string; token: string; expiresAt: string }> {
  const session = await prepareAuthSession(env, input, now);
  await session.statement.run();
  return { id: session.id, token: session.token, expiresAt: session.expiresAt };
}

export async function getAuthContext(
  request: Request,
  env: Env,
  now = new Date(),
): Promise<AuthContext | null> {
  const token = cookieValue(request.headers.get("cookie"), authSessionCookieName);
  if (!token) {
    return null;
  }
  const context = await lookupAuthContext(env, await tokenHash(token), now);
  if (!context) {
    return null;
  }

  const lastUsed = context.session.lastUsedAt
    ? new Date(context.session.lastUsedAt).getTime()
    : 0;
  if (now.getTime() - lastUsed >= 15 * 60 * 1000) {
    await env.DB.prepare(
      `UPDATE auth_sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL`,
    ).bind(now.toISOString(), context.session.id).run();
  }
  return context;
}

export async function revokeCurrentAuthSession(
  request: Request,
  env: Env,
  now = new Date().toISOString(),
): Promise<void> {
  const token = cookieValue(request.headers.get("cookie"), authSessionCookieName);
  if (!token) {
    return;
  }
  const hash = await tokenHash(token);
  const session = await env.DB.prepare(
    `SELECT user_id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`,
  ).bind(hash).first<{ user_id: string }>();
  if (!session) return;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE auth_sessions SET revoked_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL`,
    ).bind(now, hash),
    authAuditStatement(env, {
      action: "session-revoked",
      summary: "Signed out the current account session.",
      actorUserId: session.user_id,
      subjectUserId: session.user_id,
      createdAt: now,
    }),
  ]);
}

export function authSessionCookie(
  token: string,
  maxAgeSeconds = authSessionLifetimeSeconds,
): string {
  return [
    `${authSessionCookieName}=${token}`,
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function clearAuthSessionCookie(): string {
  return [
    `${authSessionCookieName}=`,
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=0",
  ].join("; ");
}

export function cookieValue(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}
