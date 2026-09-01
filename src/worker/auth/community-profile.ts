import type { Env } from "../env";
import { authAuditStatement } from "./audit";

export type CallsignClaimStatus =
  | "self-asserted"
  | "event-linked"
  | "moderator-reviewed";

export type CommunityProfile = {
  userId: string;
  callsign: string;
  callsignNormalized: string;
  publicName: string;
  claimStatus: CallsignClaimStatus;
  claimActive: boolean;
  claimedAt: string;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicCommunityProfile = Pick<
  CommunityProfile,
  "callsign" | "publicName" | "claimStatus"
>;

type ProfileRow = {
  user_id: string;
  callsign_normalized: string;
  callsign_display: string;
  public_name: string;
  callsign_claim_status: CallsignClaimStatus;
  callsign_claim_active: number;
  callsign_claimed_at: string;
  callsign_released_at: string | null;
  created_at: string;
  updated_at: string;
};

export class CommunityProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunityProfileValidationError";
  }
}

export class CallsignConflictError extends Error {
  constructor() {
    super("That callsign already has an active community byline.");
    this.name = "CallsignConflictError";
  }
}

export class CommunityProfileUserUnavailableError extends Error {
  constructor() {
    super("The account is unavailable for community profile changes.");
    this.name = "CommunityProfileUserUnavailableError";
  }
}

export function normalizeCallsign(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

export function validateCallsign(value: string): string {
  const callsign = normalizeCallsign(value);
  if (
    callsign.length < 3 ||
    callsign.length > 24 ||
    !/^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(callsign) ||
    !/[A-Z]/.test(callsign) ||
    !/[0-9]/.test(callsign)
  ) {
    throw new CommunityProfileValidationError(
      "Enter a callsign using 3–24 letters, numbers, or portable slashes.",
    );
  }
  return callsign;
}

export function validatePublicName(value: string): string {
  const publicName = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (publicName.length > 80 || /[\u0000-\u001f\u007f]/.test(publicName)) {
    throw new CommunityProfileValidationError(
      "Public name must be 80 characters or fewer and contain no control characters.",
    );
  }
  return publicName;
}

export async function getCommunityProfile(
  env: Env,
  userId: string,
): Promise<CommunityProfile | null> {
  const row = await env.DB.prepare(
    `${profileSelect} WHERE profile.user_id = ? LIMIT 1`,
  ).bind(userId).first<ProfileRow>();
  return row ? profileFromRow(row) : null;
}

export async function getPublicCommunityProfileByCallsign(
  env: Env,
  callsign: string,
): Promise<PublicCommunityProfile | null> {
  let normalized: string;
  try {
    normalized = validateCallsign(callsign);
  } catch {
    return null;
  }
  const row = await env.DB.prepare(
    `${profileSelect}
     INNER JOIN auth_users user ON user.id = profile.user_id
     WHERE profile.callsign_normalized = ?
       AND profile.callsign_claim_active = 1
       AND user.disabled_at IS NULL
     LIMIT 1`,
  ).bind(normalized).first<ProfileRow>();
  return row ? publicProfile(profileFromRow(row)) : null;
}

export async function getActivatorCallsignProposal(
  env: Env,
  userId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT activator.primary_callsign
     FROM auth_activator_memberships membership
     INNER JOIN activate_ri_activators activator
       ON activator.id = membership.activator_id
       AND activator.event_id = membership.event_id
     INNER JOIN auth_users user ON user.id = membership.user_id
     WHERE membership.user_id = ?
       AND membership.event_id = ?
       AND membership.revoked_at IS NULL
       AND user.disabled_at IS NULL
     LIMIT 1`,
  ).bind(userId, env.ACTIVATE_RI_EVENT_ID).first<{ primary_callsign: string }>();
  if (!row) return null;
  try {
    return validateCallsign(row.primary_callsign);
  } catch {
    return null;
  }
}

export async function saveCommunityProfile(
  env: Env,
  input: {
    userId: string;
    callsign: string;
    publicName?: string;
    actorUserId?: string;
  },
  now = new Date().toISOString(),
): Promise<CommunityProfile> {
  const callsign = validateCallsign(input.callsign);
  const publicName = validatePublicName(input.publicName ?? "");
  const [user, existing, proposal] = await Promise.all([
    env.DB.prepare(
      `SELECT id, disabled_at FROM auth_users WHERE id = ? LIMIT 1`,
    ).bind(input.userId).first<{ id: string; disabled_at: string | null }>(),
    getCommunityProfile(env, input.userId),
    getActivatorCallsignProposal(env, input.userId),
  ]);
  if (!user || user.disabled_at) {
    throw new CommunityProfileUserUnavailableError();
  }

  const claimStatus: CallsignClaimStatus =
    existing?.claimStatus === "moderator-reviewed" &&
      existing.callsignNormalized === callsign
      ? "moderator-reviewed"
      : proposal === callsign
        ? "event-linked"
        : "self-asserted";
  const actorUserId = input.actorUserId ?? input.userId;
  const details = {
    previousCallsign: existing?.callsign ?? null,
    callsign,
    publicName,
    claimStatus,
  };
  const statement = existing
    ? env.DB.prepare(
        `UPDATE auth_community_profiles
         SET callsign_normalized = ?, callsign_display = ?, public_name = ?,
             callsign_claim_status = ?, callsign_claim_active = 1,
             callsign_claimed_at = CASE
               WHEN callsign_normalized = ? THEN callsign_claimed_at ELSE ?
             END,
             callsign_released_at = NULL, updated_at = ?
         WHERE user_id = ?`,
      ).bind(
        callsign,
        callsign,
        publicName,
        claimStatus,
        callsign,
        now,
        now,
        input.userId,
      )
    : env.DB.prepare(
        `INSERT INTO auth_community_profiles (
           user_id, callsign_normalized, callsign_display, public_name,
           callsign_claim_status, callsign_claim_active, callsign_claimed_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(
        input.userId,
        callsign,
        callsign,
        publicName,
        claimStatus,
        now,
        now,
        now,
      );

  try {
    await env.DB.batch([
      statement,
      authAuditStatement(env, {
        action: existing ? "community-profile-updated" : "community-profile-created",
        summary: existing
          ? "Updated a community byline."
          : "Created a community byline.",
        actorUserId,
        subjectUserId: input.userId,
        eventId: null,
        details,
        createdAt: now,
      }),
    ]);
  } catch (error) {
    if (isCallsignConflict(error)) throw new CallsignConflictError();
    throw error;
  }
  return (await getCommunityProfile(env, input.userId))!;
}

export async function markCommunityProfileReviewed(
  env: Env,
  input: { userId: string; moderatorUserId: string },
  now = new Date().toISOString(),
): Promise<boolean> {
  if (!await hasActiveSiteRole(env, input.moderatorUserId, "moderator")) {
    return false;
  }
  const result = await env.DB.prepare(
    `UPDATE auth_community_profiles
     SET callsign_claim_status = 'moderator-reviewed', updated_at = ?
     WHERE user_id = ? AND callsign_claim_active = 1`,
  ).bind(now, input.userId).run();
  if ((result.meta.changes ?? 0) !== 1) return false;
  await authAuditStatement(env, {
    action: "community-profile-reviewed",
    summary: "Recorded a moderator review of a community callsign claim.",
    actorUserId: input.moderatorUserId,
    subjectUserId: input.userId,
    eventId: null,
    createdAt: now,
  }).run();
  return true;
}

export type SiteRole = "moderator";

export async function hasActiveSiteRole(
  env: Env,
  userId: string,
  role: SiteRole,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS allowed
     FROM auth_site_roles site_role
     INNER JOIN auth_users user ON user.id = site_role.user_id
     WHERE site_role.user_id = ? AND site_role.role = ?
       AND site_role.revoked_at IS NULL AND user.disabled_at IS NULL
     LIMIT 1`,
  ).bind(userId, role).first<{ allowed: number }>();
  return row?.allowed === 1;
}

export async function grantSiteRole(
  env: Env,
  input: {
    userId: string;
    role: SiteRole;
    grantedByUserId: string | null;
  },
  now = new Date().toISOString(),
): Promise<"granted" | "existing"> {
  const [user, active] = await Promise.all([
    env.DB.prepare(
      `SELECT disabled_at FROM auth_users WHERE id = ? LIMIT 1`,
    ).bind(input.userId).first<{ disabled_at: string | null }>(),
    env.DB.prepare(
      `SELECT id FROM auth_site_roles
       WHERE user_id = ? AND role = ? AND revoked_at IS NULL LIMIT 1`,
    ).bind(input.userId, input.role).first<{ id: string }>(),
  ]);
  if (!user || user.disabled_at) throw new CommunityProfileUserUnavailableError();
  if (active) return "existing";

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO auth_site_roles (
           id, user_id, role, granted_by_user_id, granted_at
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.userId,
        input.role,
        input.grantedByUserId,
        now,
      ),
      authAuditStatement(env, {
        action: "site-role-granted",
        summary: "Granted a site-wide role.",
        actorUserId: input.grantedByUserId,
        subjectUserId: input.userId,
        eventId: null,
        details: { role: input.role },
        createdAt: now,
      }),
    ]);
  } catch (error) {
    if (isActiveSiteRoleConflict(error)) return "existing";
    throw error;
  }
  return "granted";
}

export async function revokeSiteRole(
  env: Env,
  input: { userId: string; role: SiteRole; revokedByUserId: string },
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE auth_site_roles SET revoked_by_user_id = ?, revoked_at = ?
     WHERE user_id = ? AND role = ? AND revoked_at IS NULL`,
  ).bind(input.revokedByUserId, now, input.userId, input.role).run();
  if ((result.meta.changes ?? 0) !== 1) return false;
  await authAuditStatement(env, {
    action: "site-role-revoked",
    summary: "Revoked a site-wide role.",
    actorUserId: input.revokedByUserId,
    subjectUserId: input.userId,
    eventId: null,
    details: { role: input.role },
    createdAt: now,
  }).run();
  return true;
}

function profileFromRow(row: ProfileRow): CommunityProfile {
  return {
    userId: row.user_id,
    callsign: row.callsign_display,
    callsignNormalized: row.callsign_normalized,
    publicName: row.public_name,
    claimStatus: row.callsign_claim_status,
    claimActive: row.callsign_claim_active === 1,
    claimedAt: row.callsign_claimed_at,
    releasedAt: row.callsign_released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicProfile(profile: CommunityProfile): PublicCommunityProfile {
  return {
    callsign: profile.callsign,
    publicName: profile.publicName,
    claimStatus: profile.claimStatus,
  };
}

function isCallsignConflict(error: unknown): boolean {
  return error instanceof Error &&
    /unique/i.test(error.message) &&
    error.message.includes("auth_community_profiles");
}

function isActiveSiteRoleConflict(error: unknown): boolean {
  return error instanceof Error &&
    /unique/i.test(error.message) &&
    error.message.includes("auth_site_roles");
}

const profileSelect = `SELECT
  profile.user_id,
  profile.callsign_normalized,
  profile.callsign_display,
  profile.public_name,
  profile.callsign_claim_status,
  profile.callsign_claim_active,
  profile.callsign_claimed_at,
  profile.callsign_released_at,
  profile.created_at,
  profile.updated_at
 FROM auth_community_profiles profile`;
