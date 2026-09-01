import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./env";
import { createAuthSession } from "./auth/session";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

const origin = "https://ripota.org";
const eventId = "activate-ri-2026";
const timestamp = "2026-09-01T12:00:00.000Z";

beforeEach(async () => {
  database = createMigratedSqliteD1();
  const limiter = { limit: vi.fn(async () => ({ success: true })) } as RateLimit;
  env = {
    ACTIVATE_RI_EVENT_ID: eventId,
    SITE_ORIGIN: origin,
    AUTH_ADMIN_MODE: "passkey",
    AUTH_ACTIVATOR_MODE: "unified",
    AUTH_EMAIL_LOGIN_ENABLED: "true",
    AUTH_LEGACY_LINK_ISSUANCE_ENABLED: "false",
    AUTH_RATE_LIMIT_BURST: limiter,
    AUTH_EMAIL_RATE_LIMIT: limiter,
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) } as unknown as Fetcher,
    DB: database.DB,
  };
  await seedAccounts();
});

afterEach(() => database.close());

describe("community byline account API", () => {
  it("supports account-only, admin, activator, and dual-role navigation without changing event destinations", async () => {
    const sessions = await createRoleSessions();
    const expectations = [
      ["account-user", sessions.account, ["Account security"]],
      ["admin-user", sessions.admin, ["Account security", "Admin workspace"]],
      ["activator-user", sessions.activator, ["Account security", "Activator portal"]],
      ["dual-user", sessions.dual, ["Account security", "Activator portal", "Admin workspace"]],
    ] as const;

    for (const [userId, token, routes] of expectations) {
      const current = await worker.fetch(apiRequest("/api/auth/session", token), env);
      const body = await current.json() as { nextRoutes: Array<{ label: string }> };
      expect(body.nextRoutes.map(({ label }) => label), userId).toEqual(routes);
      const profile = await worker.fetch(apiRequest("/api/auth/community-profile", token), env);
      expect(profile.status, userId).toBe(200);
    }
  });

  it("lets each existing account deliberately create a profile while event registration remains unchanged", async () => {
    const sessions = await createRoleSessions();
    const inputs = [
      [sessions.account, "W1ONLY", "Account", "self-asserted"],
      [sessions.admin, "W1ADMIN", "Admin", "self-asserted"],
      [sessions.activator, "N1ACT", "Activator", "event-linked"],
      [sessions.dual, "N1DUAL", "Dual", "event-linked"],
    ] as const;
    for (const [token, callsign, publicName, claimStatus] of inputs) {
      const response = await worker.fetch(profileRequest(token, { callsign, publicName }), env);
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(JSON.parse(text)).toMatchObject({
        profile: { callsign, publicName, claimStatus },
      });
    }

    const eventRows = await env.DB.prepare(
      `SELECT id, primary_callsign, name FROM activate_ri_activators ORDER BY id`,
    ).all<{ id: string; primary_callsign: string; name: string }>();
    expect(eventRows.results).toEqual([
      { id: "activator-record", primary_callsign: "N1ACT", name: "Event Activator" },
      { id: "dual-record", primary_callsign: "N1DUAL", name: "Event Dual" },
    ]);
    const dualAdmin = await worker.fetch(apiRequest(
      "/api/activate-ri-2026/admin/accounts",
      sessions.dual,
    ), env);
    expect(dualAdmin.status).toBe(200);
    const dualActivator = await worker.fetch(apiRequest(
      "/api/activate-ri-2026/activator/plans",
      sessions.dual,
    ), env);
    expect(dualActivator.status).toBe(200);
  });

  it("requires a fresh passkey or single-use email session only for established callsign changes", async () => {
    const stale = await createAuthSession(env, {
      userId: "activator-user",
      authenticationMethod: "passkey",
      passkeyVerified: true,
    }, new Date(Date.now() - 13 * 60 * 60 * 1000));
    expect((await worker.fetch(profileRequest(stale.token, {
      callsign: "N1ACT",
      publicName: "First name",
    }), env)).status).toBe(200);
    expect((await worker.fetch(profileRequest(stale.token, {
      callsign: "N1ACT",
      publicName: "Updated name",
    }), env)).status).toBe(200);

    const denied = await worker.fetch(profileRequest(stale.token, {
      callsign: "W1CHANGED",
      publicName: "Updated name",
    }), env);
    expect(denied.status).toBe(401);
    await expect(denied.json()).resolves.toMatchObject({ reauthenticationRequired: true });

    const freshEmail = await createAuthSession(env, {
      userId: "activator-user",
      authenticationMethod: "email",
    });
    const changed = await worker.fetch(profileRequest(freshEmail.token, {
      callsign: "W1CHANGED",
      publicName: "Updated name",
    }), env);
    expect(changed.status, await changed.text()).toBe(200);
  });

  it("handles validation and conflicts without exposing verified emails", async () => {
    const sessions = await createRoleSessions();
    expect((await worker.fetch(profileRequest(sessions.admin, {
      callsign: "W1SAME",
      publicName: "Admin",
    }), env)).status).toBe(200);
    const conflict = await worker.fetch(profileRequest(sessions.account, {
      callsign: "w1same",
      publicName: "Account",
    }), env);
    expect(conflict.status).toBe(409);
    const invalid = await worker.fetch(profileRequest(sessions.account, {
      callsign: "not a callsign",
      publicName: "Account",
    }), env);
    expect(invalid.status).toBe(400);

    const profile = await worker.fetch(apiRequest("/api/auth/community-profile", sessions.admin), env);
    const text = await profile.text();
    expect(text).toContain("W1SAME");
    expect(text).not.toContain("example.invalid");
    expect(text).not.toContain("admin-user");

    const crossOrigin = await worker.fetch(new Request(`${origin}/api/auth/community-profile`, {
      method: "PUT",
      headers: {
        cookie: `__Host-ripota-session=${sessions.admin}`,
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ callsign: "W1OTHER", publicName: "" }),
    }), env);
    expect(crossOrigin.status).toBe(403);
  });

  it("keeps a dual-role email session on the activator surface without granting admin actions", async () => {
    const session = await createAuthSession(env, {
      userId: "dual-user",
      authenticationMethod: "email",
    });
    expect((await worker.fetch(profileRequest(session.token, {
      callsign: "N1DUAL",
      publicName: "Dual",
    }), env)).status).toBe(200);
    const changed = await worker.fetch(profileRequest(session.token, {
      callsign: "W1DUAL",
      publicName: "Dual",
    }), env);
    expect(changed.status).toBe(200);
    const admin = await worker.fetch(apiRequest(
      "/api/activate-ri-2026/admin/accounts",
      session.token,
    ), env);
    expect(admin.status).toBe(401);
    const activator = await worker.fetch(apiRequest(
      "/api/activate-ri-2026/activator/plan",
      session.token,
    ), env);
    expect(activator.status).not.toBe(401);
  });
});

async function createRoleSessions(): Promise<{
  account: string;
  admin: string;
  activator: string;
  dual: string;
}> {
  const entries = await Promise.all([
    createAuthSession(env, { userId: "account-user", authenticationMethod: "passkey", passkeyVerified: true }),
    createAuthSession(env, { userId: "admin-user", authenticationMethod: "passkey", passkeyVerified: true }),
    createAuthSession(env, { userId: "activator-user", authenticationMethod: "passkey", passkeyVerified: true }),
    createAuthSession(env, { userId: "dual-user", authenticationMethod: "passkey", passkeyVerified: true }),
  ]);
  return {
    account: entries[0].token,
    admin: entries[1].token,
    activator: entries[2].token,
    dual: entries[3].token,
  };
}

function apiRequest(path: string, token: string): Request {
  return new Request(`${origin}${path}`, {
    headers: { cookie: `__Host-ripota-session=${token}` },
  });
}

function profileRequest(token: string, body: { callsign: string; publicName: string }): Request {
  return new Request(`${origin}/api/auth/community-profile`, {
    method: "PUT",
    headers: {
      cookie: `__Host-ripota-session=${token}`,
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function seedAccounts(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_users (id, webauthn_user_id, display_name, created_at, updated_at)
       VALUES
         ('account-user', 'webauthn-account', 'Account', ?, ?),
         ('admin-user', 'webauthn-admin', 'Admin', ?, ?),
         ('activator-user', 'webauthn-activator', 'Activator', ?, ?),
         ('dual-user', 'webauthn-dual', 'Dual', ?, ?)`,
    ).bind(timestamp, timestamp, timestamp, timestamp, timestamp, timestamp, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO auth_user_emails (
         user_id, email_normalized, is_primary, verified_at, created_at, updated_at
       ) VALUES
         ('account-user', 'account@example.invalid', 1, ?, ?, ?),
         ('admin-user', 'admin@example.invalid', 1, ?, ?, ?),
         ('activator-user', 'activator@example.invalid', 1, ?, ?, ?),
         ('dual-user', 'dual@example.invalid', 1, ?, ?, ?)`,
    ).bind(
      timestamp, timestamp, timestamp,
      timestamp, timestamp, timestamp,
      timestamp, timestamp, timestamp,
      timestamp, timestamp, timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO activate_ri_activators (
         id, event_id, email_normalized, name, phone, club, primary_callsign,
         created_at, updated_at, public_notes, organizer_notes, status
       ) VALUES
         ('activator-record', ?, 'activator@example.invalid', 'Event Activator', '', '', 'N1ACT', ?, ?, '', '', 'approved'),
         ('dual-record', ?, 'dual@example.invalid', 'Event Dual', '', '', 'N1DUAL', ?, ?, '', '', 'approved')`,
    ).bind(eventId, timestamp, timestamp, eventId, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO auth_event_roles (user_id, event_id, role, granted_by_user_id, created_at)
       VALUES
         ('admin-user', ?, 'admin', NULL, ?),
         ('dual-user', ?, 'admin', 'admin-user', ?)`,
    ).bind(eventId, timestamp, eventId, timestamp),
    env.DB.prepare(
      `INSERT INTO auth_activator_memberships (id, user_id, event_id, activator_id, created_at)
       VALUES
         ('activator-membership', 'activator-user', ?, 'activator-record', ?),
         ('dual-membership', 'dual-user', ?, 'dual-record', ?)`,
    ).bind(eventId, timestamp, eventId, timestamp),
  ]);
}
