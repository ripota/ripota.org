import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./env";
import { tokenHash } from "./edit-token";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";
import { createUserWithVerifiedEmail, grantAdminRole, linkActivatorMembership } from "./auth/db";
import { createAuthSession } from "./auth/session";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  authenticationOptions,
  registrationOptions,
  type PasskeyVerifier,
  verifyAuthentication,
  verifyRegistration,
} from "./auth/passkeys";

const origin = "https://ripota.org";
const legacyToken = "acceptance-private-edit-token";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  database = createMigratedSqliteD1();
  send = vi.fn(async () => ({ messageId: "sent" }));
  const limiter = { limit: vi.fn(async () => ({ success: true })) } as RateLimit;
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: origin,
    AUTH_ADMIN_MODE: "dual",
    AUTH_ACTIVATOR_MODE: "dual",
    AUTH_EMAIL_LOGIN_ENABLED: "true",
    AUTH_RATE_LIMIT_BURST: limiter,
    AUTH_EMAIL_RATE_LIMIT: limiter,
    TURNSTILE_REQUIRED: "false",
    ACTIVATE_RI_EMAIL_FROM: "activate-ri-2026@ripota.org",
    EMAIL: { send } as SendEmail,
    ASSETS: { fetch: vi.fn(async () => new Response("asset shell")) } as unknown as Fetcher,
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
  ).bind(await tokenHash(legacyToken), now).run();
});

afterEach(() => database.close());

describe("unified authentication acceptance", () => {
  it("preserves a legacy link while creating an activator account that can enroll", async () => {
    const exchange = await worker.fetch(request(`/activate-ri-2026/edit/${legacyToken}/`), env);
    expect(exchange.status).toBe(303);
    const cookies = exchange.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("__Host-activate-ri-session=");
    expect(cookies).toContain("__Host-ripota-session=");
    const sessionCookie = authCookie(cookies);

    const current = await worker.fetch(request("/api/auth/session", {
      headers: { cookie: sessionCookie },
    }), env);
    await expect(current.json()).resolves.toMatchObject({
      signedIn: true,
      authenticationMethod: "legacy-link",
      activator: { callsign: "N1ABC" },
    });

    const registration = await worker.fetch(request("/api/auth/passkeys/registration/options", {
      method: "POST",
      headers: { cookie: sessionCookie, origin },
    }), env);
    expect(registration.status).toBe(200);
    await expect(registration.json()).resolves.toMatchObject({
      ok: true,
      options: { rp: { id: "ripota.org" } },
    });

    const registrationRequest = request("/api/auth/passkeys/registration/options", {
      method: "POST",
      headers: { cookie: sessionCookie, origin },
    });
    const registrationCeremony = await registrationOptions(env, registrationRequest);
    const registered = await verifyRegistration(env, registrationRequest, {
      challengeId: String(registrationCeremony.challengeId),
      response: registrationResponse,
      label: "Acceptance passkey",
    }, verifier);
    expect(registered.cookie).toContain("__Host-ripota-session=");

    const authenticationCeremony = await authenticationOptions(env, request(
      "/api/auth/passkey/authentication/options",
      { method: "POST", headers: { origin } },
    ));
    const authenticated = await verifyAuthentication(env, request(
      "/api/auth/passkey/authentication/verify",
      { method: "POST", headers: { origin } },
    ), {
      challengeId: String(authenticationCeremony.challengeId),
      response: authenticationResponse,
    }, verifier);
    expect(authenticated.cookie).toContain("__Host-ripota-session=");

    const reused = await worker.fetch(request(`/activate-ri-2026/edit/${legacyToken}/`), env);
    expect(reused.status).toBe(303);
    const row = await env.DB.prepare(
      `SELECT revoked_at FROM activate_ri_edit_tokens WHERE token_hash = ?`,
    ).bind(await tokenHash(legacyToken)).first<{ revoked_at: string | null }>();
    expect(row?.revoked_at).toBeNull();
  });

  it("uses the same public response for email fallback and consumes the eligible link once", async () => {
    const unknown = await worker.fetch(jsonRequest("/api/auth/email-login", {
      email: "missing@example.com",
      turnstileToken: "",
    }), env);
    const eligible = await worker.fetch(jsonRequest("/api/auth/email-login", {
      email: "USER@example.com",
      turnstileToken: "",
    }), env);
    expect(await eligible.json()).toEqual(await unknown.json());
    expect(send).toHaveBeenCalledOnce();

    const message = send.mock.calls[0][0] as { text: string };
    const link = message.text.split("\n").find((line) => line.startsWith(`${origin}/account/access/#`));
    const rawToken = new URL(link!).hash.slice(1);
    const consume = await worker.fetch(jsonRequest("/api/auth/email-login/consume", { token: rawToken }), env);
    expect(consume.status).toBe(200);
    expect(consume.headers.get("set-cookie")).toContain("__Host-ripota-session=");
    const replay = await worker.fetch(jsonRequest("/api/auth/email-login/consume", { token: rawToken }), env);
    expect(replay.status).toBe(400);
  });

  it("requires a passkey administrator session for account recovery controls", async () => {
    const user = await createUserWithVerifiedEmail(env, "admin@example.com", "Admin");
    await grantAdminRole(env, user.id, null);

    const accessOnly = await worker.fetch(request("/api/activate-ri-2026/admin/accounts", {
      headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
    }), env);
    expect(accessOnly.status).toBe(401);

    const session = await createAuthSession(env, {
      userId: user.id,
      authenticationMethod: "passkey",
      passkeyVerified: true,
    });
    const authorized = await worker.fetch(request("/api/activate-ri-2026/admin/accounts", {
      headers: { cookie: `__Host-ripota-session=${session.token}` },
    }), env);
    expect(authorized.status).toBe(200);
    const body = await authorized.json() as {
      ok: boolean;
      accounts: Array<{ email: string; admin: boolean }>;
    };
    expect(body.ok).toBe(true);
    expect(body.accounts).toContainEqual(expect.objectContaining({
      email: "admin@example.com",
      admin: true,
    }));

    const subject = await createUserWithVerifiedEmail(env, "user@example.com", "User");
    await linkActivatorMembership(env, subject.id, "activator");
    const detail = await worker.fetch(request(
      `/api/activate-ri-2026/admin/accounts/${encodeURIComponent(subject.id)}`,
      { headers: { cookie: `__Host-ripota-session=${session.token}` } },
    ), env);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      account: { userId: subject.id, callsign: "N1ABC", claimed: true },
    });

    const missingConfirmation = await worker.fetch(jsonRequest(
      `/api/activate-ri-2026/admin/accounts/${encodeURIComponent(subject.id)}/passkey-reset`,
      { confirmation: "" },
      `__Host-ripota-session=${session.token}`,
    ), env);
    expect(missingConfirmation.status).toBe(409);
    const reset = await worker.fetch(jsonRequest(
      `/api/activate-ri-2026/admin/accounts/${encodeURIComponent(subject.id)}/passkey-reset`,
      { confirmation: "N1ABC" },
      `__Host-ripota-session=${session.token}`,
    ), env);
    expect(reset.status).toBe(200);
  });
});

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${origin}${path}`, init);
}

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function authCookie(setCookie: string): string {
  const token = setCookie.match(/__Host-ripota-session=([^;,]+)/)?.[1];
  if (!token) throw new Error("Unified session cookie missing");
  return `__Host-ripota-session=${token}`;
}

const credential: WebAuthnCredential = {
  id: "acceptance-credential",
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 0,
  transports: ["internal"],
};

const registrationResponse: RegistrationResponseJSON = {
  id: credential.id,
  rawId: credential.id,
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "client-data", attestationObject: "attestation" },
};

const authenticationResponse: AuthenticationResponseJSON = {
  id: credential.id,
  rawId: credential.id,
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "client-data",
    authenticatorData: "authenticator-data",
    signature: "signature",
  },
};

const verifier: PasskeyVerifier = {
  async verifyRegistration(): Promise<VerifiedRegistrationResponse> {
    return {
      verified: true,
      registrationInfo: {
        fmt: "none",
        aaguid: "00000000-0000-0000-0000-000000000000",
        credential,
        credentialType: "public-key",
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        origin,
        rpID: "ripota.org",
      },
    };
  },
  async verifyAuthentication(): Promise<VerifiedAuthenticationResponse> {
    return {
      verified: true,
      authenticationInfo: {
        credentialID: credential.id,
        newCounter: 1,
        userVerified: true,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        origin,
        rpID: "ripota.org",
      },
    };
  },
};
