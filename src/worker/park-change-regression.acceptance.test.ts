import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireActivator, requireAdmin } from "./auth/authorization";
import { createAuthSession } from "./auth/session";
import type { Env } from "./env";
import {
  createMigratedSqliteD1,
  discoverMigrationFiles,
} from "./test-utils/sqlite-d1";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

const eventId = "activate-ri-2026";
const now = new Date("2026-08-31T12:00:00.000Z");

beforeEach(() => {
  database = createMigratedSqliteD1();
  const limiter = { limit: async () => ({ success: true }) } as RateLimit;
  env = {
    ACTIVATE_RI_EVENT_ID: eventId,
    ASSETS: null as never,
    DB: database.DB,
    SITE_ORIGIN: "https://ripota.org",
    AUTH_ADMIN_MODE: "passkey",
    AUTH_ACTIVATOR_MODE: "unified",
    AUTH_RATE_LIMIT_BURST: limiter,
    AUTH_EMAIL_RATE_LIMIT: limiter,
  };
});

afterEach(() => database.close());

describe("park-change migration and authorization gate", () => {
  it("discovers every ordered migration instead of maintaining a partial test list", () => {
    const migrations = discoverMigrationFiles();

    expect(migrations).toEqual([...migrations].sort());
    expect(new Set(migrations).size).toBe(migrations.length);
    expect(migrations).toEqual(expect.arrayContaining([
      "0001_activate_ri_2026.sql",
      "0002_approval_operation_id.sql",
      "0003_magic_links_and_audit.sql",
      "0004_activators_and_plans.sql",
      "0005_stop_utc_instants.sql",
      "0006_activator_owned_stops.sql",
      "0007_activate_ri_edit_tokens.sql",
      "0008_pota_spots_cache.sql",
      "0009_activator_sessions.sql",
      "0010_activator_ops_room.sql",
      "0011_activate_ri_pota_evidence.sql",
      "0012_unified_auth.sql",
      "0013_auth_ceremony_sessions.sql",
      "0014_preserve_unified_activator_ownership.sql",
      "0015_analytics_feature_usage.sql",
    ]));
  });

  it("keeps event sessions, roles, and rows intact across an additive future park-role migration", async () => {
    await seedEventAccountsAndData();
    const sessions = {
      admin: await createAuthSession(env, {
        userId: "event-admin",
        authenticationMethod: "passkey",
        passkeyVerified: true,
      }, now),
      activator: await createAuthSession(env, {
        userId: "event-activator",
        authenticationMethod: "passkey",
        passkeyVerified: true,
      }, now),
      parkModerator: await createAuthSession(env, {
        userId: "park-moderator",
        authenticationMethod: "passkey",
        passkeyVerified: true,
      }, now),
    };

    // This is deliberately synthetic test-only SQL. It represents the additive
    // boundary future park work must satisfy without choosing #19's schema.
    await database.DB.prepare(
      `CREATE TABLE future_park_role_assignments (
         user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
         role TEXT NOT NULL CHECK (role IN ('moderator')),
         created_at TEXT NOT NULL,
         PRIMARY KEY (user_id, role)
       )`,
    ).run();
    await database.DB.prepare(
      `INSERT INTO future_park_role_assignments (user_id, role, created_at)
       VALUES ('park-moderator', 'moderator', ?)`,
    ).bind(now.toISOString()).run();

    const admin = await requireAdmin(requestFor(sessions.admin.token), env, { now });
    expect(admin).not.toBeInstanceOf(Response);
    expect(admin).toMatchObject({ userId: "event-admin", authentication: "passkey" });

    const activator = await requireActivator(requestFor(sessions.activator.token), env);
    expect(activator).not.toBeInstanceOf(Response);
    expect(activator).toMatchObject({
      userId: "event-activator",
      activatorId: "event-activator-record",
      eventId,
      authentication: "unified",
    });

    const moderatorAdmin = await requireAdmin(
      requestFor(sessions.parkModerator.token),
      env,
      { now },
    );
    expect(moderatorAdmin).toBeInstanceOf(Response);
    expect((moderatorAdmin as Response).status).toBe(403);

    const moderatorActivator = await requireActivator(
      requestFor(sessions.parkModerator.token),
      env,
    );
    expect(moderatorActivator).toBeInstanceOf(Response);
    expect((moderatorActivator as Response).status).toBe(401);

    const stop = await database.DB.prepare(
      `SELECT park_reference, status, bands_json, modes_json
       FROM activate_ri_stops WHERE id = 'event-stop'`,
    ).first<{
      park_reference: string;
      status: string;
      bands_json: string;
      modes_json: string;
    }>();
    expect(stop).toEqual({
      park_reference: "US-2871",
      status: "scheduled",
      bands_json: '["40m"]',
      modes_json: '["SSB"]',
    });

    const eventRole = await database.DB.prepare(
      `SELECT event_id, role, revoked_at FROM auth_event_roles
       WHERE user_id = 'event-admin'`,
    ).first<{ event_id: string; role: string; revoked_at: string | null }>();
    expect(eventRole).toEqual({ event_id: eventId, role: "admin", revoked_at: null });
  });
});

function requestFor(token: string): Request {
  return new Request("https://ripota.org/activate-ri-2026/activator/", {
    headers: { cookie: `__Host-ripota-session=${token}` },
  });
}

async function seedEventAccountsAndData(): Promise<void> {
  const timestamp = now.toISOString();
  await database.DB.batch([
    database.DB.prepare(
      `INSERT INTO auth_users (id, webauthn_user_id, display_name, created_at, updated_at)
       VALUES
         ('event-admin', 'webauthn-event-admin', 'Synthetic admin', ?, ?),
         ('event-activator', 'webauthn-event-activator', 'Synthetic activator', ?, ?),
         ('park-moderator', 'webauthn-park-moderator', 'Synthetic moderator', ?, ?)`,
    ).bind(timestamp, timestamp, timestamp, timestamp, timestamp, timestamp),
    database.DB.prepare(
      `INSERT INTO activate_ri_activators (
         id, event_id, email_normalized, name, phone, club, primary_callsign,
         created_at, updated_at, public_notes, organizer_notes, status
       ) VALUES (
         'event-activator-record', ?, 'activator@example.invalid',
         'Synthetic activator', '', '', 'N0TEST', ?, ?, '', '', 'approved'
       )`,
    ).bind(eventId, timestamp, timestamp),
    database.DB.prepare(
      `INSERT INTO auth_event_roles (
         user_id, event_id, role, created_at, revoked_at
       ) VALUES
         ('event-admin', ?, 'admin', ?, NULL),
         ('park-moderator', 'park-field-guides', 'admin', ?, NULL)`,
    ).bind(eventId, timestamp, timestamp),
    database.DB.prepare(
      `INSERT INTO auth_activator_memberships (
         id, user_id, event_id, activator_id, created_at
       ) VALUES (
         'event-membership', 'event-activator', ?, 'event-activator-record', ?
       )`,
    ).bind(eventId, timestamp),
    database.DB.prepare(
      `INSERT INTO activate_ri_stops (
         id, activator_id, event_id, park_reference, start_at, end_at,
         bands_json, modes_json, public_notes, organizer_notes, status,
         created_at, updated_at
       ) VALUES (
         'event-stop', 'event-activator-record', ?, 'US-2871',
         '2026-09-12T12:00:00.000Z', '2026-09-12T15:00:00.000Z',
         '["40m"]', '["SSB"]', '', '', 'scheduled', ?, ?
       )`,
    ).bind(eventId, timestamp, timestamp),
  ]);
}
