import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedRouteSubmission } from "../lib/activate-ri/types";
import {
  ActivatorMembershipConflictError,
  createUserWithVerifiedEmail,
  linkActivatorMembership,
} from "./auth/db";
import { consumeEmailLogin, issueActivatorEmailLogin } from "./auth/email-login";
import { createAuthSession } from "./auth/session";
import { insertPendingPlan } from "./db";
import type { Env } from "./env";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

const origin = "https://ripota.org";
const now = "2026-08-30T12:00:00.000Z";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;
let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  database = createMigratedSqliteD1();
  send = vi.fn(async () => ({ messageId: "sent" }));
  const limiter = { limit: vi.fn(async () => ({ success: true })) } as RateLimit;
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: origin,
    AUTH_ACTIVATOR_MODE: "unified",
    AUTH_EMAIL_LOGIN_ENABLED: "true",
    AUTH_LEGACY_LINK_ISSUANCE_ENABLED: "false",
    AUTH_RATE_LIMIT_BURST: limiter,
    AUTH_EMAIL_RATE_LIMIT: limiter,
    TURNSTILE_REQUIRED: "false",
    ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
    EMAIL: { send } as SendEmail,
    ASSETS: null as never,
    DB: database.DB,
  };
});

afterEach(() => database.close());

describe("unified activator ownership", () => {
  it("rejects claimed email mutation without changes and preserves ordinary edits", async () => {
    const registration = await insertPendingPlan(env, submission(), now, { issueEditToken: false });
    const owner = await createUserWithVerifiedEmail(env, "owner@example.com", "Owner", now);
    await linkActivatorMembership(env, owner.id, registration.activatorId, now);
    await expect(env.DB.prepare(
      `UPDATE activate_ri_activators SET email_normalized = 'different@example.com' WHERE id = ?`,
    ).bind(registration.activatorId).run()).rejects.toThrow(
      "claimed activator email must match verified primary email",
    );
    const session = await createAuthSession(env, {
      userId: owner.id,
      authenticationMethod: "passkey",
      passkeyVerified: true,
    }, new Date(now));
    const stop = await env.DB.prepare(
      `SELECT id FROM activate_ri_stops WHERE activator_id = ?`,
    ).bind(registration.activatorId).first<{ id: string }>();
    const before = await registrationState(registration.activatorId);

    const rejected = await handleActivateRiApi(planPatch(
      registration.activatorId,
      session.token,
      editPayload(stop!.id, { submitterEmail: "different@example.com", submitterName: "Changed" }),
    ), env);

    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toEqual({
      ok: false,
      error: "This registration's email is tied to its verified account. Contact an organizer to change it.",
    });
    await expect(registrationState(registration.activatorId)).resolves.toEqual(before);

    const accepted = await handleActivateRiApi(planPatch(
      registration.activatorId,
      session.token,
      editPayload(stop!.id, {
        submitterEmail: " OWNER@EXAMPLE.COM ",
        submitterName: "Updated Owner",
        club: "Updated Club",
      }),
    ), env);

    expect(accepted.status).toBe(200);
    const updated = await env.DB.prepare(
      `SELECT email_normalized, name, club FROM activate_ri_activators WHERE id = ?`,
    ).bind(registration.activatorId).first<{
      email_normalized: string;
      name: string;
      club: string;
    }>();
    expect(updated).toEqual({
      email_normalized: "owner@example.com",
      name: "Updated Owner",
      club: "Updated Club",
    });
  });

  it("distinguishes same-owner idempotency from conflicting ownership without false audit", async () => {
    const registration = await insertPendingPlan(env, submission(), now, { issueEditToken: false });
    const owner = await createUserWithVerifiedEmail(env, "owner@example.com", "Owner", now);
    const other = await createUserWithVerifiedEmail(env, "other@example.com", "Other", now);
    await expect(linkActivatorMembership(env, owner.id, registration.activatorId, now)).resolves.toBe("linked");
    const auditCount = await linkedAuditCount();

    await expect(linkActivatorMembership(env, owner.id, registration.activatorId, now)).resolves.toBe("existing");
    await expect(linkActivatorMembership(env, other.id, registration.activatorId, now))
      .rejects.toBeInstanceOf(ActivatorMembershipConflictError);

    await expect(linkedAuditCount()).resolves.toBe(auditCount);
    const membership = await env.DB.prepare(
      `SELECT user_id FROM auth_activator_memberships
       WHERE activator_id = ? AND revoked_at IS NULL`,
    ).bind(registration.activatorId).first<{ user_id: string }>();
    expect(membership?.user_id).toBe(owner.id);
  });

  it("keeps anonymous submission claims usable and initializes the registration name", async () => {
    const unclaimed = await insertPendingPlan(
      env,
      submission({ submitterEmail: "original@example.com", submitterName: "Original" }),
      now,
      { issueEditToken: false },
    );
    await env.DB.prepare(
      `UPDATE activate_ri_activators SET email_normalized = 'owner@example.com' WHERE id = ?`,
    ).bind(unclaimed.activatorId).run();
    const response = await handleActivateRiApi(jsonRequest(
      "/api/activate-ri-2026/plans",
      submission({ submitterName: "Claimed Volunteer" }),
    ), env);
    expect(response.status).toBe(202);

    const rawToken = sentToken();
    const tokenRow = await env.DB.prepare(
      `SELECT created_at, expires_at FROM auth_email_tokens WHERE used_at IS NULL`,
    ).first<{ created_at: string; expires_at: string }>();
    expect(new Date(tokenRow!.expires_at).getTime() - new Date(tokenRow!.created_at).getTime())
      .toBe(15 * 60 * 1000);

    const claimed = await consumeEmailLogin(env, rawToken, new Date("2026-08-30T12:05:00.000Z"));
    expect(claimed?.nextPath).toBe("/activate-ri-2026/activator/plan/");
    const account = await env.DB.prepare(
      `SELECT u.display_name, e.email_normalized
       FROM auth_users u
       INNER JOIN auth_user_emails e ON e.user_id = u.id AND e.is_primary = 1`,
    ).first<{ display_name: string; email_normalized: string }>();
    expect(account).toEqual({
      display_name: "Claimed Volunteer",
      email_normalized: "owner@example.com",
    });
    const registration = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM activate_ri_activators) AS activators,
         (SELECT COUNT(*) FROM activate_ri_stops) AS stops,
         membership.activator_id
       FROM auth_activator_memberships membership
       WHERE membership.revoked_at IS NULL`,
    ).first<{ activators: number; stops: number; activator_id: string }>();
    expect(registration).toEqual({
      activators: 1,
      stops: 2,
      activator_id: unclaimed.activatorId,
    });
    const counts = await ownershipCounts();
    expect(counts).toMatchObject({ users: 1, emails: 1, memberships: 1, sessions: 1 });
  });

  it("fails a different user's claim closed without consuming the token or auditing a link", async () => {
    const registration = await insertPendingPlan(
      env,
      submission({ submitterEmail: "claimant@example.com" }),
      now,
      { issueEditToken: false },
    );
    const owner = await createUserWithVerifiedEmail(env, "owner@example.com", "Owner", now);
    const claimant = await createUserWithVerifiedEmail(env, "claimant@example.com", "Claimant", now);
    await env.DB.prepare(
      `INSERT INTO auth_activator_memberships (id, user_id, event_id, activator_id, created_at)
       VALUES ('existing-owner', ?, ?, ?, ?)`,
    ).bind(owner.id, env.ACTIVATE_RI_EVENT_ID, registration.activatorId, now).run();

    await issueActivatorEmailLogin(request("/api/auth/email-login"), env, {
      email: "claimant@example.com",
      activatorId: registration.activatorId,
    });
    const before = await ownershipCounts();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(consumeEmailLogin(env, sentToken())).resolves.toBeNull();
    expect(error).toHaveBeenCalledWith(JSON.stringify({ event: "email-login-membership-conflict" }));
    error.mockRestore();

    await expect(ownershipCounts()).resolves.toEqual(before);
    const token = await env.DB.prepare(
      `SELECT used_at FROM auth_email_tokens`,
    ).first<{ used_at: string | null }>();
    expect(token?.used_at).toBeNull();
    expect(claimant.id).not.toBe(owner.id);
    await expect(linkedAuditCount()).resolves.toBe(0);
  });

  it("rolls back a raced claim batch without orphaning account or session rows", async () => {
    const registration = await insertPendingPlan(
      env,
      submission({ submitterEmail: "race@example.com" }),
      now,
      { issueEditToken: false },
    );
    await issueActivatorEmailLogin(request("/api/auth/email-login"), env, {
      email: "race@example.com",
      activatorId: registration.activatorId,
    });
    const rawToken = sentToken();
    const competingOwner = await createUserWithVerifiedEmail(env, "owner@example.com", "Owner", now);
    const baseDb = database.DB;
    let raced = false;
    env.DB = new Proxy(baseDb, {
      get(target, property, receiver) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!raced) {
              raced = true;
              await baseDb.prepare(
                `INSERT INTO auth_activator_memberships (
                   id, user_id, event_id, activator_id, created_at
                 ) VALUES ('raced-owner', ?, ?, ?, ?)`,
              ).bind(competingOwner.id, env.ACTIVATE_RI_EVENT_ID, registration.activatorId, now).run();
            }
            return baseDb.batch(statements);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(consumeEmailLogin(env, rawToken)).resolves.toBeNull();
    expect(error).toHaveBeenCalledWith(JSON.stringify({ event: "email-login-membership-conflict" }));
    error.mockRestore();

    const rows = await baseDb.prepare(
      `SELECT
         (SELECT COUNT(*) FROM auth_users) AS users,
         (SELECT COUNT(*) FROM auth_user_emails WHERE email_normalized = 'race@example.com') AS race_emails,
         (SELECT COUNT(*) FROM auth_sessions) AS sessions,
         (SELECT COUNT(*) FROM auth_activator_memberships) AS memberships,
         (SELECT COUNT(*) FROM auth_audit_events WHERE action = 'activator-membership-linked') AS linked_audits,
         (SELECT COUNT(*) FROM auth_email_tokens WHERE used_at IS NULL) AS unused_tokens`,
    ).first<{
      users: number;
      race_emails: number;
      sessions: number;
      memberships: number;
      linked_audits: number;
      unused_tokens: number;
    }>();
    expect(rows).toEqual({
      users: 1,
      race_emails: 0,
      sessions: 0,
      memberships: 1,
      linked_audits: 0,
      unused_tokens: 1,
    });
  });
});

function submission(
  overrides: Partial<NormalizedRouteSubmission> = {},
): NormalizedRouteSubmission {
  return {
    submitterCallsign: "N1OWN",
    submitterName: "Owner",
    submitterEmail: "owner@example.com",
    submitterPhone: "",
    club: "RI POTA",
    publicNotes: "",
    organizerNotes: "",
    stops: [{
      parkReference: "US-2868",
      plannedDate: "2026-09-12",
      timeBlock: "09:00-12:00",
      startTime: "09:00",
      endTime: "12:00",
      bands: ["40m"],
      modes: ["SSB"],
      publicNotes: "",
      organizerNotes: "",
    }],
    ...overrides,
  };
}

function editPayload(stopId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...submission(),
    stops: [{ ...submission().stops[0], id: stopId }],
    turnstileToken: "test",
    ...overrides,
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${origin}${path}`, init);
}

function jsonRequest(path: string, body: unknown): Request {
  return request(path, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function planPatch(planId: string, sessionToken: string, body: unknown): Request {
  return request(`/api/activate-ri-2026/activator/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    headers: {
      origin,
      cookie: `__Host-ripota-session=${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function sentToken(): string {
  const message = send.mock.calls.at(-1)?.[0] as { text: string } | undefined;
  const link = message?.text.split("\n").find((line) => line.startsWith(`${origin}/account/access/#`));
  if (!link) throw new Error("Access email missing");
  return new URL(link).hash.slice(1);
}

async function linkedAuditCount(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM auth_audit_events WHERE action = 'activator-membership-linked'`,
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

async function ownershipCounts(): Promise<Record<string, number>> {
  return (await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM auth_users) AS users,
       (SELECT COUNT(*) FROM auth_user_emails) AS emails,
       (SELECT COUNT(*) FROM auth_activator_memberships) AS memberships,
       (SELECT COUNT(*) FROM auth_sessions) AS sessions,
       (SELECT COUNT(*) FROM auth_audit_events WHERE action = 'activator-membership-linked') AS linked_audits`,
  ).first<Record<string, number>>())!;
}

async function registrationState(activatorId: string): Promise<unknown> {
  return env.DB.prepare(
    `SELECT
       (SELECT json_object(
          'email', email_normalized,
          'name', name,
          'club', club,
          'updated', updated_at
        ) FROM activate_ri_activators WHERE id = ?) AS activator,
       (SELECT json_group_array(json_object(
          'id', id,
          'park', park_reference,
          'start', start_at,
          'end', end_at,
          'updated', updated_at
        )) FROM activate_ri_stops WHERE activator_id = ?) AS stops,
       (SELECT COUNT(*) FROM activate_ri_activity_events WHERE plan_id = ?) AS activity_count`,
  ).bind(activatorId, activatorId, activatorId).first();
}
