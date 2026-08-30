import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import type { Env } from "../env";
import { authAuditStatement } from "./audit";
import { getAuthConfig } from "./config";
import {
  consumeChallenge,
  createChallenge,
  getActiveChallengeById,
  getPasskeyByCredentialId,
  getUserById,
  insertPasskey,
  listPasskeys,
  replacePasskeysForRecovery,
  updatePasskeyUse,
} from "./db";
import { authSessionCookie, createAuthSession, getAuthContext } from "./session";

export type PasskeyVerifier = {
  verifyAuthentication(options: Parameters<typeof verifyAuthenticationResponse>[0]): Promise<VerifiedAuthenticationResponse>;
  verifyRegistration(options: Parameters<typeof verifyRegistrationResponse>[0]): Promise<VerifiedRegistrationResponse>;
};

const defaultVerifier: PasskeyVerifier = {
  verifyAuthentication: verifyAuthenticationResponse,
  verifyRegistration: verifyRegistrationResponse,
};

export async function authenticationOptions(env: Env, request: Request): Promise<Record<string, unknown>> {
  const config = getAuthConfig(env, request);
  if (!config.passkeyEnabled || !config.rpId || !config.expectedOrigin) {
    throw new PasskeyError("Passkey authentication is not enabled.", 404);
  }
  const rateKey = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (env.AUTH_RATE_LIMIT_BURST && !(await env.AUTH_RATE_LIMIT_BURST.limit({ key: `options:${rateKey}` })).success) {
    throw new PasskeyError("Too many attempts.", 429);
  }
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    allowCredentials: [],
    userVerification: "required",
  });
  const stored = await createChallenge(env, {
    challenge: options.challenge,
    ceremony: "authentication",
  });
  return { challengeId: stored.id, options };
}

export async function verifyAuthentication(
  env: Env,
  request: Request,
  input: { challengeId: string; response: AuthenticationResponseJSON },
  verifier: PasskeyVerifier = defaultVerifier,
): Promise<{ cookie: string; expiresAt: string }> {
  const config = getAuthConfig(env, request);
  if (!config.passkeyEnabled || !config.rpId || !config.expectedOrigin) {
    throw new PasskeyError("Authentication failed.");
  }
  const challenge = await getActiveChallengeById(env, input.challengeId, "authentication");
  const credential = await getPasskeyByCredentialId(env, input.response.id);
  if (!challenge || !credential) {
    throw new PasskeyError("Authentication failed.");
  }
  const user = await getUserById(env, credential.userId);
  if (!user || user.disabledAt) {
    throw new PasskeyError("Authentication failed.");
  }

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifier.verifyAuthentication({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.expectedOrigin,
      expectedRPID: config.rpId,
      credential,
      requireUserVerification: true,
    });
  } catch {
    throw new PasskeyError("Authentication failed.");
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    throw new PasskeyError("Authentication failed.");
  }
  if (!await consumeChallenge(env, challenge.id)) {
    throw new PasskeyError("Authentication failed.");
  }
  await updatePasskeyUse(env, credential.managementId, verification.authenticationInfo.newCounter);
  const session = await createAuthSession(env, {
    userId: user.id,
    authenticationMethod: "passkey",
    passkeyVerified: true,
  });
  await authAuditStatement(env, {
    action: "passkey-authenticated",
    summary: "Authenticated with a passkey.",
    actorUserId: user.id,
    subjectUserId: user.id,
  }).run();
  return { cookie: authSessionCookie(session.token), expiresAt: session.expiresAt };
}

export async function registrationOptions(env: Env, request: Request): Promise<Record<string, unknown>> {
  const config = getAuthConfig(env, request);
  const context = await getAuthContext(request, env);
  if (!config.passkeyEnabled || !config.rpId || !config.expectedOrigin || !context) {
    throw new PasskeyError("Unauthorized.", 401);
  }
  const credentials = await listPasskeys(env, context.user.id);
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: base64UrlBytes(context.user.webauthnUserId),
    userName: context.user.primaryEmail ?? context.user.id,
    userDisplayName: context.user.displayName,
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
  const stored = await createChallenge(env, {
    challenge: options.challenge,
    ceremony: "registration",
    userId: context.user.id,
    sessionId: context.session.id,
  });
  return { challengeId: stored.id, options };
}

export async function verifyRegistration(
  env: Env,
  request: Request,
  input: { challengeId: string; response: RegistrationResponseJSON; label?: string },
  verifier: PasskeyVerifier = defaultVerifier,
): Promise<{ cookie: string; expiresAt: string }> {
  const config = getAuthConfig(env, request);
  const context = await getAuthContext(request, env);
  if (!config.passkeyEnabled || !config.rpId || !config.expectedOrigin || !context) {
    throw new PasskeyError("Unauthorized.", 401);
  }
  const challenge = await getActiveChallengeById(env, input.challengeId, "registration");
  if (!challenge || challenge.userId !== context.user.id || challenge.sessionId !== context.session.id) {
    throw new PasskeyError("Registration failed.");
  }
  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifier.verifyRegistration({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.expectedOrigin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
  } catch {
    throw new PasskeyError("Registration failed.");
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    throw new PasskeyError("Registration failed.");
  }
  if (!await consumeChallenge(env, challenge.id)) {
    throw new PasskeyError("Registration failed.");
  }
  const credentialInput = {
    userId: context.user.id,
    credential: verification.registrationInfo.credential,
    deviceType: verification.registrationInfo.credentialDeviceType,
    backedUp: verification.registrationInfo.credentialBackedUp,
    label: input.label,
  };
  if (context.session.purpose === "recovery") {
    await replacePasskeysForRecovery(env, credentialInput);
  } else {
    await insertPasskey(env, credentialInput);
    await env.DB.prepare(
      `UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    ).bind(new Date().toISOString(), context.session.id).run();
  }
  const session = await createAuthSession(env, {
    userId: context.user.id,
    authenticationMethod: "passkey",
    passkeyVerified: true,
  });
  return { cookie: authSessionCookie(session.token), expiresAt: session.expiresAt };
}

export class PasskeyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  return isCredentialResponse(value, "authenticatorData", "signature");
}

export function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  return isCredentialResponse(value, "attestationObject");
}

function isCredentialResponse(value: unknown, ...responseFields: string[]): value is AuthenticationResponseJSON & RegistrationResponseJSON {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.rawId !== "string" || value.type !== "public-key") {
    return false;
  }
  const response = value.response;
  if (!isRecord(response) || typeof response.clientDataJSON !== "string") {
    return false;
  }
  return responseFields.every((field) => typeof response[field] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
