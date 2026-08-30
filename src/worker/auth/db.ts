import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { Env } from "../env";
import { authAuditStatement } from "./audit";
import type {
  AuthContext,
  AuthMethod,
  AuthSessionPurpose,
  AuthUser,
} from "./types";

type UserRow = {
  id: string;
  webauthn_user_id: string;
  display_name: string;
  primary_email: string | null;
  disabled_at: string | null;
};

type ContextRow = UserRow & {
  session_id: string;
  purpose: AuthSessionPurpose;
  authentication_method: AuthMethod;
  authenticated_at: string;
  passkey_verified_at: string | null;
  session_created_at: string;
  expires_at: string;
  last_used_at: string | null;
  admin_role: "admin" | null;
  activator_id: string | null;
  event_id: string | null;
  primary_callsign: string | null;
  activator_name: string | null;
  activator_status: AuthContext["activator"] extends infer _T
    ? "pending" | "approved" | "rejected" | "withdrawn" | null
    : never;
};

export type StoredPasskey = WebAuthnCredential & {
  managementId: string;
  userId: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PasskeyInput = {
  userId: string;
  credential: WebAuthnCredential;
  deviceType: StoredPasskey["deviceType"];
  backedUp: boolean;
  label?: string;
};

export type PreparedPasskeyChange = {
  id: string;
  statements: D1PreparedStatement[];
};

type PasskeyRow = {
  id: string;
  credential_id: string;
  user_id: string;
  public_key: ArrayBuffer | Uint8Array;
  counter: number;
  device_type: StoredPasskey["deviceType"];
  backed_up: number;
  transports_json: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
};

export type StoredChallenge = {
  id: string;
  challenge: string;
  ceremony: "authentication" | "registration";
  userId: string | null;
  sessionId: string | null;
  expiresAt: string;
};

type ChallengeRow = {
  id: string;
  challenge: string;
  ceremony: StoredChallenge["ceremony"];
  user_id: string | null;
  session_id: string | null;
  expires_at: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type PreparedUser = {
  user: AuthUser;
  statements: D1PreparedStatement[];
};

export type PreparedActivatorMembershipLink = {
  status: "existing" | "pending";
  statements: D1PreparedStatement[];
};

export class ActivatorMembershipConflictError extends Error {
  constructor() {
    super("Activator ownership conflicts with an existing active membership.");
    this.name = "ActivatorMembershipConflictError";
  }
}

export function isActivatorMembershipConflict(error: unknown): boolean {
  return error instanceof ActivatorMembershipConflictError || (
    error instanceof Error &&
    /unique/i.test(error.message) &&
    error.message.includes("auth_activator_memberships")
  );
}

export function prepareUserWithVerifiedEmail(
  env: Env,
  email: string,
  displayName: string,
  now = new Date().toISOString(),
): PreparedUser {
  const normalized = normalizeEmail(email);
  const id = crypto.randomUUID();
  const webauthnUserId = randomBase64Url(32);
  const user = {
    id,
    webauthnUserId,
    displayName: displayName.trim(),
    primaryEmail: normalized,
    disabledAt: null,
  };
  return {
    user,
    statements: [
      env.DB.prepare(
        `INSERT INTO auth_users (
           id, webauthn_user_id, display_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, webauthnUserId, user.displayName, now, now),
      env.DB.prepare(
        `INSERT INTO auth_user_emails (
           user_id, email_normalized, is_primary, verified_at, created_at, updated_at
         ) VALUES (?, ?, 1, ?, ?, ?)`,
      ).bind(id, normalized, now, now, now),
      authAuditStatement(env, {
        action: "user-created",
        summary: "Created an authentication user from a verified credential.",
        subjectUserId: id,
        createdAt: now,
      }),
      authAuditStatement(env, {
        action: "email-verified",
        summary: "Verified the user's primary email address.",
        subjectUserId: id,
        createdAt: now,
      }),
    ],
  };
}

export async function createUserWithVerifiedEmail(
  env: Env,
  email: string,
  displayName: string,
  now = new Date().toISOString(),
): Promise<AuthUser> {
  const normalized = normalizeEmail(email);
  const existing = await findUserByVerifiedEmail(env, normalized);
  if (existing) {
    return existing;
  }

  const prepared = prepareUserWithVerifiedEmail(env, normalized, displayName, now);
  await env.DB.batch(prepared.statements);
  return prepared.user;
}

export async function findUserByVerifiedEmail(env: Env, email: string): Promise<AuthUser | null> {
  const row = await env.DB.prepare(
    `${userSelect}
     INNER JOIN auth_user_emails lookup_email ON lookup_email.user_id = u.id
     WHERE lookup_email.email_normalized = ?
       AND lookup_email.verified_at IS NOT NULL
     LIMIT 1`,
  ).bind(normalizeEmail(email)).first<UserRow>();
  return row ? userFromRow(row) : null;
}

export async function getUserById(env: Env, userId: string): Promise<AuthUser | null> {
  const row = await env.DB.prepare(
    `${userSelect} WHERE u.id = ? LIMIT 1`,
  ).bind(userId).first<UserRow>();
  return row ? userFromRow(row) : null;
}

export async function linkActivatorMembership(
  env: Env,
  userId: string,
  activatorId: string,
  now = new Date().toISOString(),
): Promise<"existing" | "linked"> {
  const prepared = await prepareActivatorMembershipLink(env, userId, activatorId, now);
  if (prepared.status === "existing") {
    return "existing";
  }

  try {
    await env.DB.batch(prepared.statements);
  } catch (error) {
    if (isActivatorMembershipConflict(error)) {
      throw new ActivatorMembershipConflictError();
    }
    throw error;
  }
  return "linked";
}

export async function prepareActivatorMembershipLink(
  env: Env,
  userId: string,
  activatorId: string,
  now = new Date().toISOString(),
  options: {
    activatorWillBeInserted?: boolean;
    activatorEmail?: string;
    userWillBeInserted?: boolean;
    userPrimaryEmail?: string;
  } = {},
): Promise<PreparedActivatorMembershipLink> {
  const relationships = await env.DB.prepare(
    `SELECT user_id, activator_id
     FROM auth_activator_memberships
     WHERE event_id = ?
       AND revoked_at IS NULL
       AND (user_id = ? OR activator_id = ?)`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, userId, activatorId).all<{
    user_id: string;
    activator_id: string;
  }>();
  const active = relationships.results ?? [];
  if (active.some((row) => row.user_id === userId && row.activator_id === activatorId)) {
    return { status: "existing", statements: [] };
  }
  if (active.length > 0) {
    throw new ActivatorMembershipConflictError();
  }

  if (options.activatorWillBeInserted) {
    const userEmail = options.userWillBeInserted
      ? options.userPrimaryEmail
      : (await env.DB.prepare(
          `SELECT email_normalized
           FROM auth_user_emails
           WHERE user_id = ? AND is_primary = 1 AND verified_at IS NOT NULL
           LIMIT 1`,
        ).bind(userId).first<{ email_normalized: string }>())?.email_normalized;
    if (
      !userEmail ||
      !options.activatorEmail ||
      normalizeEmail(userEmail) !== normalizeEmail(options.activatorEmail)
    ) {
      throw new ActivatorMembershipConflictError();
    }
  } else if (options.userWillBeInserted) {
    const activator = await env.DB.prepare(
      `SELECT email_normalized
       FROM activate_ri_activators
       WHERE id = ? AND event_id = ?
       LIMIT 1`,
    ).bind(activatorId, env.ACTIVATE_RI_EVENT_ID).first<{ email_normalized: string }>();
    if (
      !activator ||
      !options.userPrimaryEmail ||
      activator.email_normalized !== normalizeEmail(options.userPrimaryEmail)
    ) {
      throw new ActivatorMembershipConflictError();
    }
  } else {
    const identity = await env.DB.prepare(
      `SELECT
         activator.email_normalized AS activator_email,
         primary_email.email_normalized AS primary_email
       FROM activate_ri_activators activator
       LEFT JOIN auth_user_emails primary_email
         ON primary_email.user_id = ?
         AND primary_email.is_primary = 1
         AND primary_email.verified_at IS NOT NULL
       WHERE activator.id = ? AND activator.event_id = ?
       LIMIT 1`,
    ).bind(userId, activatorId, env.ACTIVATE_RI_EVENT_ID).first<{
      activator_email: string;
      primary_email: string | null;
    }>();
    if (!identity) {
      throw new Error("Activator not found.");
    }
    if (!identity.primary_email || identity.primary_email !== identity.activator_email) {
      throw new ActivatorMembershipConflictError();
    }
  }

  return { status: "pending", statements: [
    env.DB.prepare(
      `INSERT INTO auth_activator_memberships (
         id, user_id, event_id, activator_id, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), userId, env.ACTIVATE_RI_EVENT_ID, activatorId, now),
    authAuditStatement(env, {
      action: "activator-membership-linked",
      summary: "Linked a verified user to an event activator.",
      subjectUserId: userId,
      createdAt: now,
    }),
  ] };
}

export async function grantAdminRole(
  env: Env,
  userId: string,
  grantedByUserId: string | null,
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_event_roles (
         user_id, event_id, role, granted_by_user_id, created_at, revoked_at
       ) VALUES (?, ?, 'admin', ?, ?, NULL)
       ON CONFLICT(user_id, event_id, role) DO UPDATE SET
         granted_by_user_id = excluded.granted_by_user_id,
         revoked_at = NULL`,
    ).bind(userId, env.ACTIVATE_RI_EVENT_ID, grantedByUserId, now),
    authAuditStatement(env, {
      action: "admin-role-granted",
      summary: "Granted the Activate RI administrator role.",
      actorUserId: grantedByUserId,
      subjectUserId: userId,
      createdAt: now,
    }),
  ]);
}

export async function revokeAdminRole(
  env: Env,
  userId: string,
  revokedByUserId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE auth_event_roles SET revoked_at = ?
     WHERE user_id = ? AND event_id = ? AND role = 'admin' AND revoked_at IS NULL`,
  ).bind(now, userId, env.ACTIVATE_RI_EVENT_ID).run();
  if ((result.meta.changes ?? 0) !== 1) return false;
  await authAuditStatement(env, {
    action: "admin-role-revoked",
    summary: "Revoked the Activate RI administrator role.",
    actorUserId: revokedByUserId,
    subjectUserId: userId,
    createdAt: now,
  }).run();
  return true;
}

export async function revokeActivatorMembership(
  env: Env,
  userId: string,
  revokedByUserId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE auth_activator_memberships SET revoked_at = ?
     WHERE user_id = ? AND event_id = ? AND revoked_at IS NULL`,
  ).bind(now, userId, env.ACTIVATE_RI_EVENT_ID).run();
  if ((result.meta.changes ?? 0) !== 1) return false;
  await authAuditStatement(env, {
    action: "activator-membership-revoked",
    summary: "Revoked the Activate RI activator membership.",
    actorUserId: revokedByUserId,
    subjectUserId: userId,
    createdAt: now,
  }).run();
  return true;
}

export async function lookupAuthContext(
  env: Env,
  tokenHash: string,
  now = new Date(),
): Promise<AuthContext | null> {
  const row = await env.DB.prepare(
    `SELECT
       u.id,
       u.webauthn_user_id,
       u.display_name,
       u.disabled_at,
       pe.email_normalized AS primary_email,
       s.id AS session_id,
       s.purpose,
       s.authentication_method,
       s.authenticated_at,
       s.passkey_verified_at,
       s.created_at AS session_created_at,
       s.expires_at,
       s.last_used_at,
       r.role AS admin_role,
       a.id AS activator_id,
       a.event_id,
       a.primary_callsign,
       a.name AS activator_name,
       a.status AS activator_status
     FROM auth_sessions s
     INNER JOIN auth_users u ON u.id = s.user_id
     LEFT JOIN auth_user_emails pe
       ON pe.user_id = u.id AND pe.is_primary = 1 AND pe.verified_at IS NOT NULL
     LEFT JOIN auth_event_roles r
       ON r.user_id = u.id AND r.event_id = ? AND r.role = 'admin' AND r.revoked_at IS NULL
     LEFT JOIN auth_activator_memberships m
       ON m.user_id = u.id AND m.event_id = ? AND m.revoked_at IS NULL
     LEFT JOIN activate_ri_activators a
       ON a.id = m.activator_id AND a.event_id = m.event_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.disabled_at IS NULL
     LIMIT 1`,
  ).bind(
    env.ACTIVATE_RI_EVENT_ID,
    env.ACTIVATE_RI_EVENT_ID,
    tokenHash,
    now.toISOString(),
  ).first<ContextRow>();

  if (!row) {
    return null;
  }
  return {
    user: userFromRow(row),
    session: {
      id: row.session_id,
      userId: row.id,
      purpose: row.purpose,
      authenticationMethod: row.authentication_method,
      authenticatedAt: row.authenticated_at,
      passkeyVerifiedAt: row.passkey_verified_at,
      createdAt: row.session_created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    },
    admin: row.admin_role === "admin",
    activator: row.activator_id && row.event_id && row.primary_callsign && row.activator_name && row.activator_status
      ? {
          activatorId: row.activator_id,
          eventId: row.event_id,
          callsign: row.primary_callsign,
          name: row.activator_name,
          status: row.activator_status,
        }
      : null,
  };
}

export async function listPasskeys(env: Env, userId: string): Promise<StoredPasskey[]> {
  const result = await env.DB.prepare(
    `${passkeySelect} WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC`,
  ).bind(userId).all<PasskeyRow>();
  return (result.results ?? []).map(passkeyFromRow);
}

export async function getPasskeyByCredentialId(
  env: Env,
  credentialId: string,
): Promise<StoredPasskey | null> {
  const row = await env.DB.prepare(
    `${passkeySelect} WHERE credential_id = ? AND revoked_at IS NULL LIMIT 1`,
  ).bind(credentialId).first<PasskeyRow>();
  return row ? passkeyFromRow(row) : null;
}

export async function insertPasskey(
  env: Env,
  input: PasskeyInput,
  now = new Date().toISOString(),
): Promise<string> {
  const prepared = preparePasskeyInsert(env, input, now);
  await env.DB.batch(prepared.statements);
  return prepared.id;
}

export function preparePasskeyInsert(
  env: Env,
  input: PasskeyInput,
  now = new Date().toISOString(),
): PreparedPasskeyChange {
  const id = crypto.randomUUID();
  return {
    id,
    statements: [
      passkeyInsertStatement(env, id, input, (input.label ?? "").trim(), now),
      authAuditStatement(env, {
        action: "passkey-registered",
        summary: "Registered a passkey.",
        subjectUserId: input.userId,
        createdAt: now,
      }),
    ],
  };
}

export async function replacePasskeysForRecovery(
  env: Env,
  input: PasskeyInput,
  now = new Date().toISOString(),
): Promise<string> {
  const prepared = preparePasskeyRecovery(env, input, now);
  await env.DB.batch(prepared.statements);
  return prepared.id;
}

export function preparePasskeyRecovery(
  env: Env,
  input: PasskeyInput,
  now = new Date().toISOString(),
): PreparedPasskeyChange {
  const id = crypto.randomUUID();
  return {
    id,
    statements: [
      passkeyInsertStatement(
        env,
        id,
        input,
        (input.label ?? "Replacement passkey").trim(),
        now,
      ),
      env.DB.prepare(
        `UPDATE auth_passkey_credentials SET revoked_at = ?
         WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
      ).bind(now, input.userId, id),
      env.DB.prepare(
        `UPDATE auth_sessions SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`,
      ).bind(now, input.userId),
      env.DB.prepare(
        `UPDATE activate_ri_activator_sessions SET revoked_at = ?
         WHERE revoked_at IS NULL AND activator_id IN (
           SELECT activator_id FROM auth_activator_memberships
           WHERE user_id = ? AND event_id = ? AND revoked_at IS NULL
         )`,
      ).bind(now, input.userId, env.ACTIVATE_RI_EVENT_ID),
      authAuditStatement(env, {
        action: "passkey-reset-completed",
        summary: "Installed a replacement passkey and revoked prior credentials and sessions.",
        actorUserId: input.userId,
        subjectUserId: input.userId,
        createdAt: now,
      }),
    ],
  };
}

export async function updatePasskeyUse(
  env: Env,
  managementId: string,
  counter: number,
  now = new Date().toISOString(),
): Promise<void> {
  await updatePasskeyUseStatement(env, managementId, counter, now).run();
}

export function updatePasskeyUseStatement(
  env: Env,
  managementId: string,
  counter: number,
  now = new Date().toISOString(),
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE auth_passkey_credentials
     SET counter = ?, last_used_at = ?
     WHERE id = ? AND revoked_at IS NULL`,
  ).bind(counter, now, managementId);
}

function passkeyInsertStatement(
  env: Env,
  id: string,
  input: PasskeyInput,
  label: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO auth_passkey_credentials (
       id, credential_id, user_id, public_key, counter, device_type,
       backed_up, transports_json, label, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.credential.id,
    input.userId,
    input.credential.publicKey,
    input.credential.counter,
    input.deviceType,
    input.backedUp ? 1 : 0,
    JSON.stringify(input.credential.transports ?? []),
    label,
    now,
  );
}

export async function renamePasskey(
  env: Env,
  userId: string,
  managementId: string,
  label: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE auth_passkey_credentials
     SET label = ?
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  ).bind(label.trim().slice(0, 80), managementId, userId).run();
  if ((result.meta.changes ?? 0) !== 1) {
    return false;
  }
  await authAuditStatement(env, {
    action: "passkey-renamed",
    summary: "Renamed a passkey.",
    actorUserId: userId,
    subjectUserId: userId,
    createdAt: now,
  }).run();
  return true;
}

export async function revokePasskey(
  env: Env,
  userId: string,
  managementId: string,
  now = new Date().toISOString(),
): Promise<"revoked" | "last-passkey" | "not-found"> {
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM auth_passkey_credentials
     WHERE user_id = ? AND revoked_at IS NULL`,
  ).bind(userId).first<{ count: number }>();
  if (!count || count.count <= 1) {
    return "last-passkey";
  }
  const result = await env.DB.prepare(
    `UPDATE auth_passkey_credentials SET revoked_at = ?
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  ).bind(now, managementId, userId).run();
  if ((result.meta.changes ?? 0) !== 1) {
    return "not-found";
  }
  await authAuditStatement(env, {
    action: "passkey-revoked",
    summary: "Revoked a passkey.",
    actorUserId: userId,
    subjectUserId: userId,
    createdAt: now,
  }).run();
  return "revoked";
}

export type SafeSession = {
  id: string;
  authenticationMethod: AuthMethod;
  authenticatedAt: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

export async function listUserSessions(env: Env, userId: string, now = new Date()): Promise<SafeSession[]> {
  const result = await env.DB.prepare(
    `SELECT id, authentication_method, authenticated_at, created_at, expires_at, last_used_at
     FROM auth_sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_used_at DESC, created_at DESC`,
  ).bind(userId, now.toISOString()).all<{
    id: string;
    authentication_method: AuthMethod;
    authenticated_at: string;
    created_at: string;
    expires_at: string;
    last_used_at: string | null;
  }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    authenticationMethod: row.authentication_method,
    authenticatedAt: row.authenticated_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
  }));
}

export async function revokeUserSession(
  env: Env,
  userId: string,
  sessionId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE auth_sessions SET revoked_at = ?
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  ).bind(now, sessionId, userId).run();
  const revoked = (result.meta.changes ?? 0) === 1;
  if (revoked) {
    await authAuditStatement(env, {
      action: "session-revoked",
      summary: "Revoked an account session.",
      actorUserId: userId,
      subjectUserId: userId,
      createdAt: now,
    }).run();
  }
  return revoked;
}

export async function revokeOtherUserSessions(
  env: Env,
  userId: string,
  currentSessionId: string,
  now = new Date().toISOString(),
): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE auth_sessions SET revoked_at = ?
     WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
  ).bind(now, userId, currentSessionId).run();
  const revoked = result.meta.changes ?? 0;
  if (revoked > 0) {
    await authAuditStatement(env, {
      action: "all-other-sessions-revoked",
      summary: "Revoked all other account sessions.",
      actorUserId: userId,
      subjectUserId: userId,
      createdAt: now,
      details: { revoked },
    }).run();
  }
  return revoked;
}

export async function createChallenge(
  env: Env,
  input: {
    challenge: string;
    ceremony: StoredChallenge["ceremony"];
    userId?: string | null;
    sessionId?: string | null;
  },
  now = new Date(),
): Promise<StoredChallenge> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO auth_webauthn_challenges (
       id, challenge, ceremony, user_id, session_id, created_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.challenge,
    input.ceremony,
    input.userId ?? null,
    input.sessionId ?? null,
    now.toISOString(),
    expiresAt,
  ).run();
  return { id, challenge: input.challenge, ceremony: input.ceremony, userId: input.userId ?? null, sessionId: input.sessionId ?? null, expiresAt };
}

export async function getActiveChallenge(
  env: Env,
  challenge: string,
  ceremony: StoredChallenge["ceremony"],
  now = new Date(),
): Promise<StoredChallenge | null> {
  const row = await env.DB.prepare(
    `SELECT id, challenge, ceremony, user_id, session_id, expires_at
     FROM auth_webauthn_challenges
     WHERE challenge = ? AND ceremony = ? AND used_at IS NULL AND expires_at > ?
     LIMIT 1`,
  ).bind(challenge, ceremony, now.toISOString()).first<ChallengeRow>();
  return row ? {
    id: row.id,
    challenge: row.challenge,
    ceremony: row.ceremony,
    userId: row.user_id,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
  } : null;
}

export async function getActiveChallengeById(
  env: Env,
  id: string,
  ceremony: StoredChallenge["ceremony"],
  now = new Date(),
): Promise<StoredChallenge | null> {
  const row = await env.DB.prepare(
    `SELECT id, challenge, ceremony, user_id, session_id, expires_at
     FROM auth_webauthn_challenges
     WHERE id = ? AND ceremony = ? AND used_at IS NULL AND expires_at > ?
     LIMIT 1`,
  ).bind(id, ceremony, now.toISOString()).first<ChallengeRow>();
  return row ? {
    id: row.id,
    challenge: row.challenge,
    ceremony: row.ceremony,
    userId: row.user_id,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
  } : null;
}

export async function consumeChallenge(
  env: Env,
  id: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await consumeChallengeStatement(env, id, now).run();
  return (result.meta.changes ?? 0) === 1;
}

export function consumeChallengeStatement(
  env: Env,
  id: string,
  now = new Date().toISOString(),
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE auth_webauthn_challenges
     SET used_at = ?
     WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
  ).bind(now, id, now);
}

function userFromRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    webauthnUserId: row.webauthn_user_id,
    displayName: row.display_name,
    primaryEmail: row.primary_email,
    disabledAt: row.disabled_at,
  };
}

function passkeyFromRow(row: PasskeyRow): StoredPasskey {
  const publicKey = Uint8Array.from(
    row.public_key instanceof Uint8Array
      ? row.public_key
      : new Uint8Array(row.public_key),
  );
  const parsed = JSON.parse(row.transports_json) as unknown;
  const transports = Array.isArray(parsed)
    ? parsed.filter((value): value is AuthenticatorTransport => typeof value === "string")
    : [];
  return {
    id: row.credential_id,
    managementId: row.id,
    userId: row.user_id,
    publicKey,
    counter: row.counter,
    transports,
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function randomBase64Url(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const userSelect = `SELECT
  u.id,
  u.webauthn_user_id,
  u.display_name,
  u.disabled_at,
  pe.email_normalized AS primary_email
 FROM auth_users u
 LEFT JOIN auth_user_emails pe
   ON pe.user_id = u.id AND pe.is_primary = 1 AND pe.verified_at IS NOT NULL`;

const passkeySelect = `SELECT
  id, credential_id, user_id, public_key, counter, device_type, backed_up,
  transports_json, label, created_at, last_used_at
 FROM auth_passkey_credentials`;
