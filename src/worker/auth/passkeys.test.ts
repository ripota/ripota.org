import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { createMigratedSqliteD1 } from "../test-utils/sqlite-d1";
import {
  createChallenge,
  createUserWithVerifiedEmail,
  getPasskeyByCredentialId,
  insertPasskey,
} from "./db";
import {
  authenticationOptions,
  PasskeyError,
  registrationOptions,
  type PasskeyVerifier,
  verifyAuthentication,
  verifyRegistration,
} from "./passkeys";
import { createAuthSession } from "./session";

let database: ReturnType<typeof createMigratedSqliteD1>;
let env: Env;

beforeEach(() => {
  database = createMigratedSqliteD1();
  const limiter = { limit: vi.fn(async () => ({ success: true })) } as RateLimit;
  env = {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    SITE_ORIGIN: "https://ripota.org",
    AUTH_ADMIN_MODE: "dual",
    AUTH_RATE_LIMIT_BURST: limiter,
    AUTH_EMAIL_RATE_LIMIT: limiter,
    ASSETS: null as never,
    DB: database.DB,
  };
});

afterEach(() => database.close());

describe("passkey ceremonies", () => {
  it("creates discoverable required-verification authentication options", async () => {
    const result = await authenticationOptions(env, authRequest("/options"));
    expect(result.options).toMatchObject({
      rpId: "ripota.org",
      allowCredentials: [],
      userVerification: "required",
    });
    expect(result.challengeId).toEqual(expect.any(String));
  });

  it("authenticates an active credential once and updates its counter", async () => {
    const user = await createUserWithVerifiedEmail(env, "user@example.com", "User");
    await insertPasskey(env, {
      userId: user.id,
      credential,
      deviceType: "multiDevice",
      backedUp: true,
    });
    const challenge = await createChallenge(env, {
      challenge: "stored-challenge",
      ceremony: "authentication",
    });
    const verifier = verifierWith({
      verified: true,
      authenticationInfo: {
        credentialID: credential.id,
        newCounter: 7,
        userVerified: true,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        origin: "https://ripota.org",
        rpID: "ripota.org",
      },
    });
    const result = await verifyAuthentication(env, authRequest("/verify"), {
      challengeId: challenge.id,
      response: authenticationResponse,
    }, verifier);
    expect(result.cookie).toMatch(/^__Host-ripota-session=/);
    expect(verifier.verifyAuthentication).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: "stored-challenge",
      expectedOrigin: "https://ripota.org",
      expectedRPID: "ripota.org",
      requireUserVerification: true,
    }));
    await expect(getPasskeyByCredentialId(env, credential.id)).resolves.toMatchObject({ counter: 7 });
    await expect(verifyAuthentication(env, authRequest("/verify"), {
      challengeId: challenge.id,
      response: authenticationResponse,
    }, verifier)).rejects.toBeInstanceOf(PasskeyError);
  });

  it("allows only one concurrent authentication completion", async () => {
    const user = await createUserWithVerifiedEmail(env, "race@example.com", "Race");
    await insertPasskey(env, {
      userId: user.id,
      credential,
      deviceType: "multiDevice",
      backedUp: true,
    });
    const challenge = await createChallenge(env, {
      challenge: "race-challenge",
      ceremony: "authentication",
    });
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => { release = resolve; });
    const verifier = verifierWith({
      verified: true,
      authenticationInfo: {
        credentialID: credential.id,
        newCounter: 8,
        userVerified: true,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        origin: "https://ripota.org",
        rpID: "ripota.org",
      },
    });
    vi.mocked(verifier.verifyAuthentication).mockImplementation(async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await bothArrived;
      return {
        verified: true,
        authenticationInfo: {
          credentialID: credential.id,
          newCounter: 8,
          userVerified: true,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
          origin: "https://ripota.org",
          rpID: "ripota.org",
        },
      };
    });
    const attempts = await Promise.allSettled([
      verifyAuthentication(env, authRequest("/verify"), {
        challengeId: challenge.id,
        response: authenticationResponse,
      }, verifier),
      verifyAuthentication(env, authRequest("/verify"), {
        challengeId: challenge.id,
        response: authenticationResponse,
      }, verifier),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const sessions = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM auth_sessions
       WHERE user_id = ? AND ceremony_challenge_id = ? AND revoked_at IS NULL`,
    ).bind(user.id, challenge.id).first<{ count: number }>();
    expect(sessions?.count).toBe(1);
  });

  it("returns one generic failure for unknown, revoked, disabled, and invalid assertions", async () => {
    const verifier = verifierWith({
      verified: false,
      authenticationInfo: {
        credentialID: credential.id,
        newCounter: 0,
        userVerified: false,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        origin: "https://ripota.org",
        rpID: "ripota.org",
      },
    });
    const unknownChallenge = await createChallenge(env, {
      challenge: "unknown",
      ceremony: "authentication",
    });
    await expect(verifyAuthentication(env, authRequest("/verify"), {
      challengeId: unknownChallenge.id,
      response: { ...authenticationResponse, id: "unknown", rawId: "unknown" },
    }, verifier)).rejects.toMatchObject({ message: "Authentication failed." });

    const revokedUser = await createUserWithVerifiedEmail(env, "revoked@example.com", "Revoked");
    await insertPasskey(env, { userId: revokedUser.id, credential, deviceType: "multiDevice", backedUp: true });
    await env.DB.prepare(
      `UPDATE auth_passkey_credentials SET revoked_at = '2026-08-30T12:00:00.000Z' WHERE credential_id = ?`,
    ).bind(credential.id).run();
    const revokedChallenge = await createChallenge(env, { challenge: "revoked", ceremony: "authentication" });
    await expect(verifyAuthentication(env, authRequest("/verify"), {
      challengeId: revokedChallenge.id,
      response: authenticationResponse,
    }, verifier)).rejects.toMatchObject({ message: "Authentication failed." });

    const disabledCredential = { ...credential, id: "disabled-credential" };
    const disabledUser = await createUserWithVerifiedEmail(env, "disabled@example.com", "Disabled");
    await insertPasskey(env, { userId: disabledUser.id, credential: disabledCredential, deviceType: "multiDevice", backedUp: true });
    await env.DB.prepare(
      `UPDATE auth_users SET disabled_at = '2026-08-30T12:00:00.000Z' WHERE id = ?`,
    ).bind(disabledUser.id).run();
    const disabledChallenge = await createChallenge(env, { challenge: "disabled", ceremony: "authentication" });
    await expect(verifyAuthentication(env, authRequest("/verify"), {
      challengeId: disabledChallenge.id,
      response: { ...authenticationResponse, id: disabledCredential.id, rawId: disabledCredential.id },
    }, verifier)).rejects.toMatchObject({ message: "Authentication failed." });

    const activeCredential = { ...credential, id: "invalid-assertion" };
    const activeUser = await createUserWithVerifiedEmail(env, "active@example.com", "Active");
    await insertPasskey(env, { userId: activeUser.id, credential: activeCredential, deviceType: "multiDevice", backedUp: true });
    const invalidChallenge = await createChallenge(env, { challenge: "invalid", ceremony: "authentication" });
    await expect(verifyAuthentication(env, authRequest("/verify"), {
      challengeId: invalidChallenge.id,
      response: { ...authenticationResponse, id: activeCredential.id, rawId: activeCredential.id },
    }, verifier)).rejects.toMatchObject({ message: "Authentication failed." });
    const challengeState = await env.DB.prepare(
      `SELECT used_at FROM auth_webauthn_challenges WHERE id = ?`,
    ).bind(invalidChallenge.id).first<{ used_at: string | null }>();
    expect(challengeState?.used_at).toBeNull();
  });

  it("keeps the challenge and enrollment session active when registration rolls back", async () => {
    const owner = await createUserWithVerifiedEmail(env, "owner@example.com", "Owner");
    const enrollee = await createUserWithVerifiedEmail(env, "enrollee@example.com", "Enrollee");
    await insertPasskey(env, {
      userId: owner.id,
      credential,
      deviceType: "multiDevice",
      backedUp: true,
    });
    const enrollment = await createAuthSession(env, {
      userId: enrollee.id,
      purpose: "enrollment",
      authenticationMethod: "access-bootstrap",
    });
    const request = authRequest("/registration", enrollment.token);
    const options = await registrationOptions(env, request);
    const verifier = verifierWith(undefined, registrationVerification(credential));

    await expect(verifyRegistration(env, request, {
      challengeId: String(options.challengeId),
      response: registrationResponse,
    }, verifier)).rejects.toEqual(expect.objectContaining({ message: "Registration failed." }));

    const state = await env.DB.prepare(
      `SELECT c.used_at, s.revoked_at
       FROM auth_webauthn_challenges c
       INNER JOIN auth_sessions s ON s.id = ?
       WHERE c.id = ?`,
    ).bind(enrollment.id, String(options.challengeId)).first<{ used_at: string | null; revoked_at: string | null }>();
    expect(state).toEqual({ used_at: null, revoked_at: null });
  });

  it("binds registration to the current user and rotates the session", async () => {
    const user = await createUserWithVerifiedEmail(env, "user@example.com", "User");
    const enrollment = await createAuthSession(env, {
      userId: user.id,
      purpose: "enrollment",
      authenticationMethod: "access-bootstrap",
    });
    const request = authRequest("/registration", enrollment.token);
    const options = await registrationOptions(env, request);
    expect(options.options).toMatchObject({
      rp: { id: "ripota.org", name: "RI POTA" },
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const verifier = verifierWith(undefined, {
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
        origin: "https://ripota.org",
        rpID: "ripota.org",
      },
    });
    const result = await verifyRegistration(env, request, {
      challengeId: String(options.challengeId),
      response: registrationResponse,
      label: "Phone",
    }, verifier);
    expect(result.cookie).toMatch(/^__Host-ripota-session=/);
    await expect(getPasskeyByCredentialId(env, credential.id)).resolves.toMatchObject({
      userId: user.id,
      label: "Phone",
      backedUp: true,
    });
  });

  it("rejects a registration challenge presented by another user", async () => {
    const first = await createUserWithVerifiedEmail(env, "first@example.com", "First");
    const second = await createUserWithVerifiedEmail(env, "second@example.com", "Second");
    const firstSession = await createAuthSession(env, {
      userId: first.id,
      purpose: "enrollment",
      authenticationMethod: "access-bootstrap",
    });
    const secondSession = await createAuthSession(env, {
      userId: second.id,
      purpose: "enrollment",
      authenticationMethod: "access-bootstrap",
    });
    const options = await registrationOptions(env, authRequest("/registration", firstSession.token));
    const verifier = verifierWith(undefined, registrationVerification(credential));
    await expect(verifyRegistration(env, authRequest("/registration", secondSession.token), {
      challengeId: String(options.challengeId),
      response: registrationResponse,
    }, verifier)).rejects.toMatchObject({ message: "Registration failed." });
    expect(verifier.verifyRegistration).not.toHaveBeenCalled();
  });

  it("atomically replaces credentials and revokes unified and legacy sessions during recovery", async () => {
    const user = await createUserWithVerifiedEmail(env, "recover@example.com", "Recover");
    await env.DB.prepare(
      `INSERT INTO activate_ri_activators (
         id, event_id, email_normalized, name, phone, club, primary_callsign,
         created_at, updated_at, public_notes, organizer_notes, status
       ) VALUES ('activator', ?, 'recover@example.com', 'Recover', '', '', 'N1REC',
         '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z', '', '', 'approved')`,
    ).bind(env.ACTIVATE_RI_EVENT_ID).run();
    await env.DB.prepare(
      `INSERT INTO auth_activator_memberships (id, user_id, event_id, activator_id, created_at)
       VALUES ('membership', ?, ?, 'activator', '2026-08-30T12:00:00.000Z')`,
    ).bind(user.id, env.ACTIVATE_RI_EVENT_ID).run();
    await env.DB.prepare(
      `INSERT INTO activate_ri_activator_sessions (
         token_hash, event_id, activator_id, created_at, expires_at, last_used_at
       ) VALUES ('legacy', ?, 'activator', '2026-08-30T12:00:00.000Z',
         '2026-09-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z')`,
    ).bind(env.ACTIVATE_RI_EVENT_ID).run();
    await insertPasskey(env, {
      userId: user.id,
      credential,
      deviceType: "multiDevice",
      backedUp: true,
    });
    const recovery = await createAuthSession(env, {
      userId: user.id,
      purpose: "recovery",
      authenticationMethod: "email",
    });
    const request = authRequest("/registration", recovery.token);
    const options = await registrationOptions(env, request);
    const replacement = { ...credential, id: "replacement-credential" };
    const response = { ...registrationResponse, id: replacement.id, rawId: replacement.id };
    const result = await verifyRegistration(env, request, {
      challengeId: String(options.challengeId),
      response,
      label: "Replacement",
    }, verifierWith(undefined, registrationVerification(replacement)));
    expect(result.cookie).toMatch(/^__Host-ripota-session=/);

    const rows = await env.DB.prepare(
      `SELECT
         (SELECT revoked_at FROM auth_passkey_credentials WHERE credential_id = ?) AS old_revoked,
         (SELECT revoked_at FROM auth_sessions WHERE id = ?) AS recovery_revoked,
         (SELECT revoked_at FROM activate_ri_activator_sessions WHERE token_hash = 'legacy') AS legacy_revoked,
         (SELECT COUNT(*) FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL) AS active_sessions`,
    ).bind(credential.id, recovery.id, user.id).first<{
      old_revoked: string | null;
      recovery_revoked: string | null;
      legacy_revoked: string | null;
      active_sessions: number;
    }>();
    expect(rows?.old_revoked).not.toBeNull();
    expect(rows?.recovery_revoked).not.toBeNull();
    expect(rows?.legacy_revoked).not.toBeNull();
    expect(rows?.active_sessions).toBe(1);
    await expect(getPasskeyByCredentialId(env, replacement.id)).resolves.toMatchObject({
      label: "Replacement",
    });
  });
});

const credential: WebAuthnCredential = {
  id: "credential-id",
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 0,
  transports: ["internal"],
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

const registrationResponse: RegistrationResponseJSON = {
  id: credential.id,
  rawId: credential.id,
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "client-data",
    attestationObject: "attestation",
  },
};

function verifierWith(
  authentication?: VerifiedAuthenticationResponse,
  registration?: VerifiedRegistrationResponse,
): PasskeyVerifier {
  return {
    verifyAuthentication: vi.fn(async (): Promise<VerifiedAuthenticationResponse> => {
      if (!authentication) {
        throw new Error("Unexpected authentication verification.");
      }
      return authentication;
    }),
    verifyRegistration: vi.fn(async (): Promise<VerifiedRegistrationResponse> => {
      return registration ?? { verified: false };
    }),
  };
}

function registrationVerification(value: WebAuthnCredential): VerifiedRegistrationResponse {
  return {
    verified: true,
    registrationInfo: {
      fmt: "none",
      aaguid: "00000000-0000-0000-0000-000000000000",
      credential: value,
      credentialType: "public-key",
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
      origin: "https://ripota.org",
      rpID: "ripota.org",
    },
  };
}

function authRequest(path: string, token?: string): Request {
  return new Request(`https://ripota.org${path}`, {
    method: "POST",
    headers: {
      origin: "https://ripota.org",
      ...(token ? { cookie: `__Host-ripota-session=${token}` } : {}),
    },
  });
}
