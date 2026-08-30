import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { tokenHash } from "../edit-token";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import { consumeLegacyEditToken, upgradeLegacySession } from "./legacy";
import { getAuthContext } from "./session";

const editToken = "existing-private-edit-token";
let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

beforeEach(async () => {
  database = createMigratedSqliteD1();
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
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
  await env.DB.prepare(
    `INSERT INTO activate_ri_edit_tokens (token_hash, activator_id, event_id, created_at)
     VALUES (?, 'activator', 'activate-ri-2026', ?)`,
  ).bind(await tokenHash(editToken), now).run();
});

afterEach(() => database.close());

describe("legacy compatibility", () => {
  it("claims an existing private link without consuming or rotating it", async () => {
    const first = await consumeLegacyEditToken(env, editToken);
    const second = await consumeLegacyEditToken(env, editToken);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const link = await env.DB.prepare(
      `SELECT revoked_at FROM activate_ri_edit_tokens WHERE token_hash = ?`,
    ).bind(await tokenHash(editToken)).first<{ revoked_at: string | null }>();
    expect(link?.revoked_at).toBeNull();

    const token = first!.unified.cookie.match(/^__Host-ripota-session=([^;]+)/)?.[1];
    const context = await getAuthContext(new Request("https://ripota.org/", {
      headers: { cookie: `__Host-ripota-session=${token}` },
    }), env);
    expect(context).toMatchObject({
      session: { authenticationMethod: "legacy-link" },
      activator: { activatorId: "activator" },
    });
  });

  it("upgrades a valid legacy browser session before clearing it", async () => {
    const consumed = await consumeLegacyEditToken(env, editToken);
    const legacyToken = consumed!.legacy.sessionToken;
    const result = await upgradeLegacySession(new Request("https://ripota.org/", {
      headers: { cookie: `__Host-activate-ri-session=${legacyToken}` },
    }), env);
    expect(result?.unified.cookie).toMatch(/^__Host-ripota-session=/);
    expect(result?.clearLegacyCookie).toContain("Max-Age=0");
  });
});
