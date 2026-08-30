import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import { accessBootstrap } from "./bootstrap";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

beforeEach(() => {
  database = createMigratedSqliteD1();
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    ALLOW_ADMIN_HEADER_AUTH: "true",
    AUTH_BOOTSTRAP_ADMIN_EMAILS: "organizer@example.com",
    ASSETS: null as never,
    DB: database.DB,
  };
});
afterEach(() => database.close());

describe("Access administrator bootstrap", () => {
  it("requires both a verified Access identity and the bootstrap allowlist", async () => {
    const missing = await accessBootstrap(request(), env);
    expect(missing).toBeInstanceOf(Response);
    expect((missing as Response).status).toBe(401);

    const denied = await accessBootstrap(request("other@example.com"), env);
    expect(denied).toBeInstanceOf(Response);
    expect((denied as Response).status).toBe(403);

    const allowed = await accessBootstrap(request("organizer@example.com"), env);
    expect(allowed).not.toBeInstanceOf(Response);
    expect((allowed as { cookie: string }).cookie).toMatch(/^__Host-ripota-session=/);
    const session = await env.DB.prepare(
      `SELECT purpose, authentication_method, passkey_verified_at FROM auth_sessions`,
    ).first<{ purpose: string; authentication_method: string; passkey_verified_at: string | null }>();
    expect(session).toEqual({
      purpose: "enrollment",
      authentication_method: "access-bootstrap",
      passkey_verified_at: null,
    });
  });

  it("does not trust the Access email header unless header auth is explicitly enabled", async () => {
    env.ALLOW_ADMIN_HEADER_AUTH = "false";
    const result = await accessBootstrap(request("organizer@example.com"), env);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

function request(email?: string): Request {
  return new Request("https://ripota.org/api/auth/access-bootstrap/start", {
    method: "POST",
    headers: email ? { "Cf-Access-Authenticated-User-Email": email } : {},
  });
}
