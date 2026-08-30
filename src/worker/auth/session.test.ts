import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import { createUserWithVerifiedEmail } from "./db";
import {
  authSessionCookie,
  authSessionLifetimeSeconds,
  createAuthSession,
  getAuthContext,
  revokeCurrentAuthSession,
} from "./session";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

beforeEach(() => {
  database = createMigratedSqliteD1();
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    ASSETS: null as never,
    DB: database.DB,
  };
});

afterEach(() => database.close());

describe("unified auth sessions", () => {
  it("stores only a hash and issues the strict host cookie", async () => {
    const now = new Date("2026-08-30T12:00:00.000Z");
    const user = await createUserWithVerifiedEmail(env, "USER@Example.com", "User", now.toISOString());
    const session = await createAuthSession(env, {
      userId: user.id,
      authenticationMethod: "passkey",
      passkeyVerified: true,
    }, now);
    const stored = await env.DB.prepare(
      `SELECT token_hash FROM auth_sessions WHERE id = ?`,
    ).bind(session.id).first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(session.token);
    expect(stored?.token_hash).not.toContain(session.token);
    expect(authSessionCookie(session.token)).toBe(
      `__Host-ripota-session=${session.token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${authSessionLifetimeSeconds}`,
    );

    const request = new Request("https://ripota.org/account/security/", {
      headers: { cookie: `__Host-ripota-session=${session.token}` },
    });
    await expect(getAuthContext(request, env, now)).resolves.toMatchObject({
      user: { id: user.id, primaryEmail: "user@example.com" },
      session: { authenticationMethod: "passkey", passkeyVerifiedAt: now.toISOString() },
    });
    await revokeCurrentAuthSession(request, env, now.toISOString());
    await expect(getAuthContext(request, env, now)).resolves.toBeNull();
  });
});
