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
    await expect(getPasskeyByCredentialId(env, credential.id)).resolves.toMatchObject({ counter: 7 });
    await expect(verifyAuthentication(env, authRequest("/verify"), {
      challengeId: challenge.id,
      response: authenticationResponse,
    }, verifier)).rejects.toBeInstanceOf(PasskeyError);
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

function authRequest(path: string, token?: string): Request {
  return new Request(`https://ripota.org${path}`, {
    method: "POST",
    headers: {
      origin: "https://ripota.org",
      ...(token ? { cookie: `__Host-ripota-session=${token}` } : {}),
    },
  });
}
