import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./env";
import { createUserWithVerifiedEmail, linkActivatorMembership } from "./auth/db";
import { createAuthSession } from "./auth/session";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

beforeEach(() => {
  database = createMigratedSqliteD1();
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    AUTH_ACTIVATOR_MODE: "dual",
    TURNSTILE_REQUIRED: "false",
    ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
    EMAIL: { send: vi.fn(async () => ({ messageId: "sent" })) } as SendEmail,
    ASSETS: null as never,
    DB: database.DB,
  };
});

afterEach(() => database.close());

describe("signed-in volunteer association", () => {
  it("links a verified matching signed-in user", async () => {
    const { userId, cookie } = await signedIn("match@example.com");
    const response = await submit("N1MAT", "match@example.com", cookie);
    expect(response.status).toBe(202);
    await expect(membershipUser("N1MAT")).resolves.toBe(userId);
  });

  it("does not link a signed-in user whose verified email differs", async () => {
    const { cookie } = await signedIn("other@example.com");
    const response = await submit("N1MIS", "submitted@example.com", cookie);
    expect(response.status).toBe(202);
    await expect(membershipUser("N1MIS")).resolves.toBeNull();
  });

  it("links an existing unclaimed activator after a matching submission", async () => {
    await seedActivator("activate-ri-2026:unclaimed@example.com", "N1UNC", "unclaimed@example.com");
    const { userId, cookie } = await signedIn("unclaimed@example.com");
    const response = await submit("N1UNC", "unclaimed@example.com", cookie);
    expect(response.status).toBe(202);
    await expect(membershipUser("N1UNC")).resolves.toBe(userId);
  });

  it("keeps an existing claimed activator linked to its owner", async () => {
    const activatorId = "activate-ri-2026:claimed@example.com";
    await seedActivator(activatorId, "N1CLM", "claimed@example.com");
    const { userId, cookie } = await signedIn("claimed@example.com");
    await linkActivatorMembership(env, userId, activatorId);
    const response = await submit("N1CLM", "claimed@example.com", cookie);
    expect(response.status).toBe(202);
    await expect(membershipUser("N1CLM")).resolves.toBe(userId);
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM auth_activator_memberships WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(userId).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("preserves anonymous submission without creating an account association", async () => {
    const response = await submit("N1ANO", "anonymous@example.com");
    expect(response.status).toBe(202);
    await expect(membershipUser("N1ANO")).resolves.toBeNull();
  });
});

async function signedIn(email: string): Promise<{ userId: string; cookie: string }> {
  const user = await createUserWithVerifiedEmail(env, email, "Volunteer");
  const session = await createAuthSession(env, {
    userId: user.id,
    authenticationMethod: "passkey",
    passkeyVerified: true,
  });
  return { userId: user.id, cookie: `__Host-ripota-session=${session.token}` };
}

async function submit(callsign: string, email: string, cookie?: string): Promise<Response> {
  return worker.fetch(new Request("https://ripota.org/api/activate-ri-2026/plans", {
    method: "POST",
    headers: {
      origin: "https://ripota.org",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      submitterCallsign: callsign,
      submitterName: "Volunteer",
      submitterEmail: email,
      club: "RI POTA",
      organizerNotes: "Authentication association test.",
      turnstileToken: "test",
      stops: [{
        parkReference: "US-2868",
        plannedDate: "2026-09-12",
        timeBlock: "09:00-12:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "",
      }],
    }),
  }), env);
}

async function seedActivator(id: string, callsign: string, email: string): Promise<void> {
  const now = "2026-08-30T12:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO activate_ri_activators (
       id, event_id, email_normalized, name, phone, club, primary_callsign,
       created_at, updated_at, public_notes, organizer_notes, status
     ) VALUES (?, ?, ?, 'Volunteer', '', '', ?, ?, ?, '', '', 'pending')`,
  ).bind(id, env.ACTIVATE_RI_EVENT_ID, email, callsign, now, now).run();
}

async function membershipUser(callsign: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT m.user_id
     FROM activate_ri_activators a
     LEFT JOIN auth_activator_memberships m
       ON m.activator_id = a.id AND m.event_id = a.event_id AND m.revoked_at IS NULL
     WHERE a.event_id = ? AND a.primary_callsign = ?
     LIMIT 1`,
  ).bind(env.ACTIVATE_RI_EVENT_ID, callsign).first<{ user_id: string | null }>();
  return row?.user_id ?? null;
}
