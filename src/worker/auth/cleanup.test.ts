import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import { cleanupAuthData } from "./cleanup";
import { createUserWithVerifiedEmail } from "./db";
import { createAuthSession } from "./session";

let close: (() => void) | undefined;
afterEach(() => close?.());

describe("bounded auth cleanup", () => {
  it("removes expired transient data without deleting users or audit history", async () => {
    const database = createMigratedSqliteD1();
    close = database.close;
    const env: Env = {
      ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
      ASSETS: null as never,
      DB: database.DB,
    };
    const old = new Date("2026-06-01T00:00:00.000Z");
    const user = await createUserWithVerifiedEmail(env, "user@example.com", "User", old.toISOString());
    await createAuthSession(env, { userId: user.id, authenticationMethod: "email" }, old);
    await env.DB.prepare(
      `INSERT INTO auth_webauthn_challenges (id, challenge, ceremony, created_at, expires_at)
       VALUES ('old', 'old', 'authentication', ?, ?)`,
    ).bind(old.toISOString(), old.toISOString()).run();
    const result = await cleanupAuthData(env, new Date("2026-08-30T12:00:00.000Z"), 10);
    expect(result).toMatchObject({ challenges: 1, sessions: 1 });
    await expect(env.DB.prepare(`SELECT id FROM auth_users WHERE id = ?`).bind(user.id).first()).resolves.not.toBeNull();
    await expect(env.DB.prepare(`SELECT action FROM auth_audit_events WHERE subject_user_id = ?`).bind(user.id).first()).resolves.not.toBeNull();
  });
});
