import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { createAuthSession } from "./session";
import {
  CallsignConflictError,
  CommunityProfileUserUnavailableError,
  getActivatorCallsignProposal,
  getCommunityProfile,
  getPublicCommunityProfileByCallsign,
  grantSiteRole,
  hasActiveSiteRole,
  markCommunityProfileReviewed,
  revokeSiteRole,
  saveCommunityProfile,
} from "./community-profile";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

const eventId = "activate-ri-2026";
const now = "2026-09-01T12:00:00.000Z";

beforeEach(async () => {
  database = createMigratedSqliteD1();
  env = {
    ACTIVATE_RI_EVENT_ID: eventId,
    ASSETS: null as never,
    DB: database.DB,
  };
  await seedUsers();
});

afterEach(() => database.close());

describe("community profile and site-role foundations", () => {
  it("creates and updates an explicitly confirmed byline without mutating event data", async () => {
    expect(await getActivatorCallsignProposal(env, "activator-user")).toBe("N0EVENT");

    const created = await saveCommunityProfile(env, {
      userId: "activator-user",
      callsign: " n0event ",
      publicName: "  Synthetic   Operator ",
    }, now);
    expect(created).toMatchObject({
      userId: "activator-user",
      callsign: "N0EVENT",
      callsignNormalized: "N0EVENT",
      publicName: "Synthetic Operator",
      claimStatus: "event-linked",
      claimActive: true,
    });

    const updated = await saveCommunityProfile(env, {
      userId: "activator-user",
      callsign: "W1NEW/P",
      publicName: "Operator",
    }, "2026-09-01T12:05:00.000Z");
    expect(updated).toMatchObject({
      callsign: "W1NEW/P",
      claimStatus: "self-asserted",
      publicName: "Operator",
    });
    const event = await env.DB.prepare(
      `SELECT primary_callsign, name FROM activate_ri_activators WHERE id = 'activator-record'`,
    ).first<{ primary_callsign: string; name: string }>();
    expect(event).toEqual({ primary_callsign: "N0EVENT", name: "Event Name" });
    const independentRoles = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM auth_community_profiles WHERE user_id = 'activator-user') AS profiles,
         (SELECT COUNT(*) FROM auth_event_roles WHERE user_id = 'activator-user' AND revoked_at IS NULL) AS event_roles,
         (SELECT COUNT(*) FROM auth_activator_memberships WHERE user_id = 'activator-user' AND revoked_at IS NULL) AS memberships`,
    ).first<{ profiles: number; event_roles: number; memberships: number }>();
    expect(independentRoles).toEqual({ profiles: 1, event_roles: 1, memberships: 1 });
  });

  it("enforces uniqueness only for active claims so a released callsign can be reclaimed", async () => {
    await saveCommunityProfile(env, { userId: "activator-user", callsign: "W1CLAIM" }, now);
    await expect(saveCommunityProfile(env, {
      userId: "admin-user",
      callsign: "W1CLAIM",
    }, now)).rejects.toBeInstanceOf(CallsignConflictError);
    await env.DB.prepare(
      `UPDATE auth_community_profiles
       SET callsign_claim_active = 0, callsign_released_at = ?, updated_at = ?
       WHERE user_id = 'activator-user'`,
    ).bind(now, now).run();
    await expect(saveCommunityProfile(env, {
      userId: "admin-user",
      callsign: "W1CLAIM",
    }, now)).resolves.toMatchObject({ callsign: "W1CLAIM", claimActive: true });
  });

  it("fails normalized callsign conflicts safely without overwriting either profile", async () => {
    await saveCommunityProfile(env, {
      userId: "activator-user",
      callsign: "W1ABC",
      publicName: "First",
    }, now);
    await saveCommunityProfile(env, {
      userId: "admin-user",
      callsign: "K1ADMIN",
      publicName: "Admin",
    }, now);

    await expect(saveCommunityProfile(env, {
      userId: "admin-user",
      callsign: "w1abc",
      publicName: "Overwritten",
    }, "2026-09-01T12:05:00.000Z")).rejects.toBeInstanceOf(CallsignConflictError);
    await expect(getCommunityProfile(env, "activator-user")).resolves.toMatchObject({
      callsign: "W1ABC",
      publicName: "First",
    });
    await expect(getCommunityProfile(env, "admin-user")).resolves.toMatchObject({
      callsign: "K1ADMIN",
      publicName: "Admin",
    });
  });

  it("grants, reviews with, revokes, and regrants a moderator role with history", async () => {
    await expect(grantSiteRole(env, {
      userId: "moderator-user",
      role: "moderator",
      grantedByUserId: "admin-user",
    }, now)).resolves.toBe("granted");
    await expect(hasActiveSiteRole(env, "moderator-user", "moderator")).resolves.toBe(true);

    await saveCommunityProfile(env, {
      userId: "activator-user",
      callsign: "N0EVENT",
    }, now);
    await expect(markCommunityProfileReviewed(env, {
      userId: "activator-user",
      moderatorUserId: "moderator-user",
    }, "2026-09-01T12:01:00.000Z")).resolves.toBe(true);
    await expect(getCommunityProfile(env, "activator-user")).resolves.toMatchObject({
      claimStatus: "moderator-reviewed",
    });

    await expect(revokeSiteRole(env, {
      userId: "moderator-user",
      role: "moderator",
      revokedByUserId: "admin-user",
    }, "2026-09-01T12:02:00.000Z")).resolves.toBe(true);
    await expect(hasActiveSiteRole(env, "moderator-user", "moderator")).resolves.toBe(false);
    await expect(markCommunityProfileReviewed(env, {
      userId: "admin-user",
      moderatorUserId: "moderator-user",
    })).resolves.toBe(false);
    await expect(grantSiteRole(env, {
      userId: "moderator-user",
      role: "moderator",
      grantedByUserId: "admin-user",
    }, "2026-09-01T12:03:00.000Z")).resolves.toBe("granted");

    const history = await env.DB.prepare(
      `SELECT granted_by_user_id, revoked_by_user_id, revoked_at
       FROM auth_site_roles WHERE user_id = 'moderator-user' ORDER BY granted_at`,
    ).all<{
      granted_by_user_id: string;
      revoked_by_user_id: string | null;
      revoked_at: string | null;
    }>();
    expect(history.results).toEqual([
      {
        granted_by_user_id: "admin-user",
        revoked_by_user_id: "admin-user",
        revoked_at: "2026-09-01T12:02:00.000Z",
      },
      {
        granted_by_user_id: "admin-user",
        revoked_by_user_id: null,
        revoked_at: null,
      },
    ]);
  });

  it("keeps verified emails and stable ownership out of the public projection and safe audit details", async () => {
    await saveCommunityProfile(env, {
      userId: "activator-user",
      callsign: "N0EVENT",
      publicName: "Public Name",
    }, now);
    const projection = await getPublicCommunityProfileByCallsign(env, "n0event");
    expect(projection).toEqual({
      callsign: "N0EVENT",
      publicName: "Public Name",
      claimStatus: "event-linked",
    });
    expect(JSON.stringify(projection)).not.toContain("example.invalid");
    expect(JSON.stringify(projection)).not.toContain("activator-user");

    const audit = await env.DB.prepare(
      `SELECT event_id, actor_user_id, subject_user_id, details_json
       FROM auth_audit_events WHERE action = 'community-profile-created'`,
    ).first<{
      event_id: string | null;
      actor_user_id: string;
      subject_user_id: string;
      details_json: string;
    }>();
    expect(audit).toMatchObject({
      event_id: null,
      actor_user_id: "activator-user",
      subject_user_id: "activator-user",
    });
    expect(audit!.details_json).toContain("N0EVENT");
    expect(audit!.details_json).not.toContain("example.invalid");
  });

  it("rejects disabled-user mutations and excludes disabled profiles and roles", async () => {
    await saveCommunityProfile(env, {
      userId: "moderator-user",
      callsign: "W1MOD",
    }, now);
    await grantSiteRole(env, {
      userId: "moderator-user",
      role: "moderator",
      grantedByUserId: "admin-user",
    }, now);
    await env.DB.prepare(
      `UPDATE auth_users SET disabled_at = ?, updated_at = ? WHERE id = 'moderator-user'`,
    ).bind(now, now).run();

    await expect(saveCommunityProfile(env, {
      userId: "moderator-user",
      callsign: "W1MOD2",
    })).rejects.toBeInstanceOf(CommunityProfileUserUnavailableError);
    await expect(grantSiteRole(env, {
      userId: "moderator-user",
      role: "moderator",
      grantedByUserId: "admin-user",
    })).rejects.toBeInstanceOf(CommunityProfileUserUnavailableError);
    await expect(hasActiveSiteRole(env, "moderator-user", "moderator")).resolves.toBe(false);
    await expect(getPublicCommunityProfileByCallsign(env, "W1MOD")).resolves.toBeNull();
  });

  it("applies additively to an existing database without invalidating sessions or event ownership", async () => {
    database.close();
    database = createMigratedSqliteD1({ through: "0015_analytics_feature_usage.sql" });
    env.DB = database.DB;
    await seedUsers();
    const session = await createAuthSession(env, {
      userId: "activator-user",
      authenticationMethod: "passkey",
      passkeyVerified: true,
    }, new Date(now));
    database.applyMigrationFile("0016_community_profiles.sql");

    const preserved = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM auth_sessions WHERE id = ?) AS sessions,
         (SELECT COUNT(*) FROM auth_event_roles WHERE user_id = 'admin-user' AND revoked_at IS NULL) AS event_roles,
         (SELECT COUNT(*) FROM auth_activator_memberships WHERE user_id = 'activator-user' AND revoked_at IS NULL) AS memberships`,
    ).bind(session.id).first<{
      sessions: number;
      event_roles: number;
      memberships: number;
    }>();
    expect(preserved).toEqual({ sessions: 1, event_roles: 1, memberships: 1 });
    const foreignKeys = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeys.results).toEqual([]);
    await expect(saveCommunityProfile(env, {
      userId: "activator-user",
      callsign: "N0EVENT",
    }, now)).resolves.toMatchObject({ claimStatus: "event-linked" });
  });
});

async function seedUsers(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_users (id, webauthn_user_id, display_name, created_at, updated_at)
       VALUES
         ('admin-user', 'webauthn-admin', 'Admin', ?, ?),
         ('activator-user', 'webauthn-activator', 'Activator', ?, ?),
         ('moderator-user', 'webauthn-moderator', 'Moderator', ?, ?)`,
    ).bind(now, now, now, now, now, now),
    env.DB.prepare(
      `INSERT INTO auth_user_emails (
         user_id, email_normalized, is_primary, verified_at, created_at, updated_at
       ) VALUES
         ('admin-user', 'admin@example.invalid', 1, ?, ?, ?),
         ('activator-user', 'activator@example.invalid', 1, ?, ?, ?),
         ('moderator-user', 'moderator@example.invalid', 1, ?, ?, ?)`,
    ).bind(now, now, now, now, now, now, now, now, now),
    env.DB.prepare(
      `INSERT INTO activate_ri_activators (
         id, event_id, email_normalized, name, phone, club, primary_callsign,
         created_at, updated_at, public_notes, organizer_notes, status
       ) VALUES (
         'activator-record', ?, 'activator@example.invalid', 'Event Name', '', '',
         'N0EVENT', ?, ?, '', '', 'approved'
       )`,
    ).bind(eventId, now, now),
    env.DB.prepare(
      `INSERT INTO auth_event_roles (user_id, event_id, role, granted_by_user_id, created_at)
       VALUES
         ('admin-user', ?, 'admin', NULL, ?),
         ('activator-user', ?, 'admin', 'admin-user', ?)`,
    ).bind(eventId, now, eventId, now),
    env.DB.prepare(
      `INSERT INTO auth_activator_memberships (
         id, user_id, event_id, activator_id, created_at
       ) VALUES ('activator-membership', 'activator-user', ?, 'activator-record', ?)`,
    ).bind(eventId, now),
  ]);
}
