import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activatorSessionCookie,
  activatorSessionLifetimeSeconds,
  createActivatorSession,
  getActivatorSession,
  revokeCurrentActivatorSession,
} from "./activator-session";
import { tokenHash } from "./edit-token";
import type { Env } from "./env";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

const editToken = "private-edit-token";
const activatorId = "activate-ri-2026:rob@example.com";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

beforeEach(async () => {
  database = createMigratedSqliteD1();
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    ASSETS: { fetch: async () => new Response("unused") } as unknown as Fetcher,
    DB: database.DB,
  };

  await env.DB.prepare(
    `INSERT INTO activate_ri_activators (
       id, event_id, email_normalized, name, phone, club, primary_callsign,
       created_at, updated_at, public_notes, organizer_notes, status
     ) VALUES (?, ?, ?, ?, '', '', ?, ?, ?, '', '', 'approved')`,
  )
    .bind(
      activatorId,
      "activate-ri-2026",
      "rob@example.com",
      "Rob Jackson",
      "N1RWJ",
      "2026-08-29T12:00:00.000Z",
      "2026-08-29T12:00:00.000Z",
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO activate_ri_edit_tokens (
       token_hash, activator_id, event_id, created_at
     ) VALUES (?, ?, ?, ?)`,
  )
    .bind(
      await tokenHash(editToken),
      activatorId,
      "activate-ri-2026",
      "2026-08-29T12:00:00.000Z",
    )
    .run();
});

afterEach(() => database.close());

describe("activator sessions", () => {
  it("stores only a hash and expires the session after fourteen days", async () => {
    const createdAt = new Date("2026-08-29T12:00:00.000Z");
    const session = await createActivatorSession(env, editToken, createdAt);

    expect(session?.identity).toMatchObject({
      activatorId,
      callsign: "N1RWJ",
      name: "Rob Jackson",
      status: "approved",
      expiresAt: "2026-09-12T12:00:00.000Z",
    });
    expect(session?.sessionToken).toBeTruthy();

    const stored = await env.DB.prepare(
      `SELECT token_hash, expires_at
       FROM activate_ri_activator_sessions
       WHERE activator_id = ?`,
    ).bind(activatorId).first<{ token_hash: string; expires_at: string }>();
    expect(stored?.token_hash).toBe(await tokenHash(session!.sessionToken));
    expect(stored?.token_hash).not.toContain(session!.sessionToken);

    const cookie = activatorSessionCookie(session!.sessionToken);
    expect(cookie).toContain("Secure; HttpOnly; SameSite=Strict; Path=/");
    expect(cookie).toContain(`Max-Age=${activatorSessionLifetimeSeconds}`);

    const authenticatedRequest = requestWithSession(session!.sessionToken);
    await expect(
      getActivatorSession(
        authenticatedRequest,
        env,
        new Date("2026-09-12T11:59:59.999Z"),
      ),
    ).resolves.toMatchObject({ activatorId });
    await expect(
      getActivatorSession(
        authenticatedRequest,
        env,
        new Date("2026-09-12T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });

  it("revokes the current session without revoking the reusable edit link", async () => {
    const session = await createActivatorSession(env, editToken);
    expect(session).not.toBeNull();
    const authenticatedRequest = requestWithSession(session!.sessionToken);

    await revokeCurrentActivatorSession(authenticatedRequest, env);
    await expect(getActivatorSession(authenticatedRequest, env)).resolves.toBeNull();
    await expect(createActivatorSession(env, editToken)).resolves.not.toBeNull();
  });

  it("rejects revoked edit links", async () => {
    await env.DB.prepare(
      `UPDATE activate_ri_edit_tokens
       SET revoked_at = ?
       WHERE token_hash = ?`,
    )
      .bind("2026-08-29T13:00:00.000Z", await tokenHash(editToken))
      .run();

    await expect(createActivatorSession(env, editToken)).resolves.toBeNull();
  });
});

function requestWithSession(sessionToken: string): Request {
  return new Request("https://ripota.org/activate-ri-2026/activators/", {
    headers: { cookie: `__Host-activate-ri-session=${sessionToken}` },
  });
}
