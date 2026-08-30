import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import { consumeEmailLogin, genericEmailLoginMessage, requestEmailLogin } from "./email-login";
import { createUserWithVerifiedEmail } from "./db";
import { getAuthContext } from "./session";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  database = createMigratedSqliteD1();
  send = vi.fn(async () => ({ messageId: "sent" }));
  const limiter = { limit: vi.fn(async () => ({ success: true })) } as RateLimit;
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    AUTH_ACTIVATOR_MODE: "dual",
    AUTH_EMAIL_LOGIN_ENABLED: "true",
    AUTH_RATE_LIMIT_BURST: limiter,
    AUTH_EMAIL_RATE_LIMIT: limiter,
    TURNSTILE_REQUIRED: "false",
    ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
    EMAIL: { send } as SendEmail,
    ASSETS: null as never,
    DB: database.DB,
  };
  const now = "2026-08-30T12:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO activate_ri_activators (
       id, event_id, email_normalized, name, phone, club, primary_callsign,
       created_at, updated_at, public_notes, organizer_notes, status
     ) VALUES ('activator', 'activate-ri-2026', 'user@example.com', 'User', '', '', 'N1ABC', ?, ?, '', '', 'approved')`,
  ).bind(now, now).run();
});

afterEach(() => database.close());

describe("activator email login", () => {
  it("returns one public response for unknown and eligible addresses", async () => {
    const unknown = await requestEmailLogin(request(), env, { email: "missing@example.com", turnstileToken: "" });
    const eligible = await requestEmailLogin(request(), env, { email: "USER@example.com", turnstileToken: "" });
    expect(unknown).toEqual({ ok: true, message: genericEmailLoginMessage });
    expect(eligible).toEqual(unknown);
    expect(send).toHaveBeenCalledOnce();
  });

  it("stores a hash, consumes once, verifies email, and links the activator", async () => {
    await requestEmailLogin(request(), env, { email: "user@example.com", turnstileToken: "" });
    const sent = send.mock.calls[0][0] as { text: string };
    const accessUrl = sent.text.split("\n").find((line) => line.startsWith("https://ripota.org/account/access/#"));
    const rawToken = new URL(accessUrl!).hash.slice(1);
    const stored = await env.DB.prepare(
      `SELECT token_hash FROM auth_email_tokens WHERE purpose = 'login'`,
    ).first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(rawToken);

    const result = await consumeEmailLogin(env, rawToken, new Date("2026-08-30T12:05:00.000Z"));
    expect(result?.cookie).toMatch(/^__Host-ripota-session=/);
    await expect(consumeEmailLogin(env, rawToken)).resolves.toBeNull();

    const token = result!.cookie.match(/^__Host-ripota-session=([^;]+)/)?.[1];
    const context = await getAuthContext(new Request("https://ripota.org/", {
      headers: { cookie: `__Host-ripota-session=${token}` },
    }), env, new Date("2026-08-30T12:05:00.000Z"));
    expect(context).toMatchObject({
      user: { primaryEmail: "user@example.com" },
      session: { authenticationMethod: "email", passkeyVerifiedAt: null },
      activator: { activatorId: "activator", callsign: "N1ABC" },
    });
  });

  it("does not offer public email fallback to an admin-only account", async () => {
    await createUserWithVerifiedEmail(env, "admin@example.com", "Admin");
    const result = await requestEmailLogin(request(), env, {
      email: "admin@example.com",
      turnstileToken: "",
    });
    expect(result).toEqual({ ok: true, message: genericEmailLoginMessage });
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the generic response for malformed and disabled eligible accounts", async () => {
    const malformed = await requestEmailLogin(request(), env, {
      email: "not-an-email",
      turnstileToken: "",
    });
    const user = await createUserWithVerifiedEmail(env, "user@example.com", "User");
    await env.DB.prepare(
      `UPDATE auth_users SET disabled_at = '2026-08-30T12:00:00.000Z' WHERE id = ?`,
    ).bind(user.id).run();
    const disabled = await requestEmailLogin(request(), env, {
      email: "user@example.com",
      turnstileToken: "",
    });
    expect(malformed).toEqual({ ok: true, message: genericEmailLoginMessage });
    expect(disabled).toEqual(malformed);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed, expired, and concurrently replayed access tokens", async () => {
    await expect(consumeEmailLogin(env, "not-a-token")).resolves.toBeNull();
    await requestEmailLogin(request(), env, { email: "user@example.com", turnstileToken: "" });
    const sent = send.mock.calls[0][0] as { text: string };
    const accessUrl = sent.text.split("\n").find((line) => line.startsWith("https://ripota.org/account/access/#"));
    const rawToken = new URL(accessUrl!).hash.slice(1);
    const stored = await env.DB.prepare(
      `SELECT expires_at FROM auth_email_tokens WHERE purpose = 'login'`,
    ).first<{ expires_at: string }>();
    await expect(consumeEmailLogin(
      env,
      rawToken,
      new Date(new Date(stored!.expires_at).getTime() + 1),
    )).resolves.toBeNull();

    const attempts = await Promise.all([
      consumeEmailLogin(env, rawToken),
      consumeEmailLogin(env, rawToken),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });

  it("invalidates a token when delivery fails without changing existing access", async () => {
    send.mockRejectedValueOnce(new Error("synthetic delivery failure"));
    const result = await requestEmailLogin(request(), env, {
      email: "user@example.com",
      turnstileToken: "",
    });
    expect(result).toEqual({ ok: true, message: genericEmailLoginMessage });
    const stored = await env.DB.prepare(
      `SELECT used_at FROM auth_email_tokens WHERE purpose = 'login'`,
    ).first<{ used_at: string | null }>();
    expect(stored?.used_at).not.toBeNull();
    const memberships = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM auth_activator_memberships`,
    ).first<{ count: number }>();
    expect(memberships?.count).toBe(0);
  });
});

function request(): Request {
  return new Request("https://ripota.org/api/auth/email-login", {
    method: "POST",
    headers: { origin: "https://ripota.org", "CF-Connecting-IP": "192.0.2.1" },
  });
}
