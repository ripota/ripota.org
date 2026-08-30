import type { Env } from "../env";
import { json, readJson } from "../http";
import { hasTrustedOrigin } from "../origin";
import { withPrivateHeaders } from "../private-response";
import {
  authenticationOptions,
  isAuthenticationResponse,
  isRegistrationResponse,
  PasskeyError,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../auth/passkeys";
import {
  clearAuthSessionCookie,
  getAuthContext,
  revokeCurrentAuthSession,
} from "../auth/session";
import {
  listPasskeys,
  listUserSessions,
  renamePasskey,
  revokeOtherUserSessions,
  revokePasskey,
  revokeUserSession,
} from "../auth/db";
import { consumeEmailLogin, requestEmailLogin } from "../auth/email-login";
import { consumeLegacyEditToken, legacySessionCookie, upgradeLegacySession } from "../auth/legacy";
import { clearActivatorSessionCookie } from "../activator-session";
import { accessBootstrap } from "../auth/bootstrap";
import { consumePasskeyReset } from "../auth/admin-recovery";
import { getAuthConfig } from "../auth/config";

export async function handleAuthApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/auth/session") {
      const context = await getAuthContext(request, env);
      return privateJson(context ? {
        ok: true,
        signedIn: true,
        user: {
          displayName: context.user.displayName,
          email: context.user.primaryEmail,
        },
        authenticationMethod: context.session.authenticationMethod,
        passkeyVerifiedAt: context.session.passkeyVerifiedAt,
        admin: context.admin,
        activator: context.activator ? {
          callsign: context.activator.callsign,
          status: context.activator.status,
        } : null,
        roles: [
          ...(context.admin ? ["administrator"] : []),
          ...(context.activator ? ["activator"] : []),
        ],
        nextRoutes: [
          { label: "Account security", path: "/account/security/" },
          ...(context.activator
            ? [{ label: "Activator portal", path: "/activate-ri-2026/activator/" }]
            : []),
          ...(context.admin
            ? [{ label: "Admin workspace", path: "/activate-ri-2026/admin/" }]
            : []),
        ],
      } : { ok: true, signedIn: false });
    }

    if (request.method !== "GET" && !hasTrustedOrigin(request, env)) {
      return privateJson({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      await revokeCurrentAuthSession(request, env);
      const headers = new Headers();
      headers.append("set-cookie", clearAuthSessionCookie());
      headers.append("set-cookie", clearActivatorSessionCookie());
      return privateJson({ ok: true }, { headers });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/email-login") {
      const payload = await readJson(request);
      const input = isRecord(payload) ? payload : {};
      return privateJson(await requestEmailLogin(request, env, {
        email: input.email,
        turnstileToken: input.turnstileToken,
      }));
    }
    if (request.method === "POST" && url.pathname === "/api/auth/email-login/consume") {
      const payload = await readJson(request);
      const token = isRecord(payload) && typeof payload.token === "string" ? payload.token : "";
      const result = await consumeEmailLogin(env, token) ?? await consumePasskeyReset(env, token);
      return result
        ? privateJson({ ok: true, expiresAt: result.expiresAt }, { headers: { "set-cookie": result.cookie } })
        : privateJson({ ok: false, error: "Access link invalid or expired" }, { status: 400 });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/legacy/upgrade-session") {
      const result = await upgradeLegacySession(request, env);
      if (!result) {
        return privateJson({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const headers = new Headers();
      headers.append("set-cookie", result.unified.cookie);
      headers.append("set-cookie", result.clearLegacyCookie);
      return privateJson({ ok: true, expiresAt: result.unified.expiresAt }, { headers });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/legacy/consume-edit-token") {
      const payload = await readJson(request);
      const token = isRecord(payload) && typeof payload.token === "string" ? payload.token : "";
      const result = await consumeLegacyEditToken(env, token);
      if (!result) {
        return privateJson({ ok: false, error: "Access link invalid" }, { status: 400 });
      }
      const headers = new Headers();
      headers.append("set-cookie", legacySessionCookie(result.legacy.sessionToken));
      headers.append("set-cookie", result.unified.cookie);
      return privateJson({ ok: true, expiresAt: result.unified.expiresAt }, { headers });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/access-bootstrap/start") {
      const result = await accessBootstrap(request, env);
      if (result instanceof Response) {
        return withPrivateHeaders(result);
      }
      return privateJson({ ok: true, expiresAt: result.expiresAt }, {
        headers: { "set-cookie": result.cookie },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/auth/passkeys") {
      const context = await getAuthContext(request, env);
      if (!context) {
        return privateJson({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const passkeys = await listPasskeys(env, context.user.id);
      return privateJson({ ok: true, passkeys: passkeys.map((passkey) => ({
        id: passkey.managementId,
        label: passkey.label,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt,
      })) });
    }
    if (request.method === "GET" && url.pathname === "/api/auth/sessions") {
      const context = await getAuthContext(request, env);
      if (!context) {
        return privateJson({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const sessions = await listUserSessions(env, context.user.id);
      return privateJson({ ok: true, sessions: sessions.map((session) => ({
        ...session,
        current: session.id === context.session.id,
      })) });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/passkey/authentication/options") {
      return privateJson({ ok: true, ...(await authenticationOptions(env, request)) });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/passkey/authentication/verify") {
      const payload = await readJson(request);
      if (!isRecord(payload) || typeof payload.challengeId !== "string" || !isAuthenticationResponse(payload.response)) {
        return privateJson({ ok: false, error: "Authentication failed" }, { status: 400 });
      }
      const result = await verifyAuthentication(env, request, {
        challengeId: payload.challengeId,
        response: payload.response,
      });
      return privateJson({ ok: true, expiresAt: result.expiresAt }, { headers: { "set-cookie": result.cookie } });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/passkeys/registration/options") {
      return privateJson({ ok: true, ...(await registrationOptions(env, request)) });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/passkeys/registration/verify") {
      const payload = await readJson(request);
      if (!isRecord(payload) || typeof payload.challengeId !== "string" || !isRegistrationResponse(payload.response)) {
        return privateJson({ ok: false, error: "Registration failed" }, { status: 400 });
      }
      const result = await verifyRegistration(env, request, {
        challengeId: payload.challengeId,
        response: payload.response,
        label: typeof payload.label === "string" ? payload.label : undefined,
      });
      return privateJson({ ok: true, expiresAt: result.expiresAt }, { headers: { "set-cookie": result.cookie } });
    }
    const passkeyMatch = url.pathname.match(/^\/api\/auth\/passkeys\/([^/]+)$/);
    if (passkeyMatch && (request.method === "PATCH" || request.method === "DELETE")) {
      const context = await requirePasskeyContext(request, env);
      if (context instanceof Response) {
        return context;
      }
      const id = decodeURIComponent(passkeyMatch[1]);
      if (request.method === "PATCH") {
        const payload = await readJson(request);
        const label = isRecord(payload) && typeof payload.label === "string" ? payload.label : "";
        const updated = label.length <= 80 && await renamePasskey(env, context.user.id, id, label);
        return updated
          ? privateJson({ ok: true })
          : privateJson({ ok: false, error: "Passkey not found" }, { status: 404 });
      }
      const result = await revokePasskey(env, context.user.id, id);
      return result === "revoked"
        ? privateJson({ ok: true })
        : privateJson({ ok: false, error: result === "last-passkey" ? "Keep at least one passkey." : "Passkey not found" }, { status: result === "last-passkey" ? 409 : 404 });
    }
    const sessionMatch = url.pathname.match(/^\/api\/auth\/sessions\/([^/]+)$/);
    if (request.method === "DELETE" && sessionMatch) {
      const context = await requirePasskeyContext(request, env);
      if (context instanceof Response) {
        return context;
      }
      const revoked = await revokeUserSession(env, context.user.id, decodeURIComponent(sessionMatch[1]));
      return revoked
        ? privateJson({ ok: true })
        : privateJson({ ok: false, error: "Session not found" }, { status: 404 });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/sessions/revoke-others") {
      const context = await requirePasskeyContext(request, env);
      if (context instanceof Response) {
        return context;
      }
      const revoked = await revokeOtherUserSessions(env, context.user.id, context.session.id);
      return privateJson({ ok: true, revoked });
    }
    return privateJson({ ok: false, error: "Not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof Response) {
      return withPrivateHeaders(error);
    }
    if (error instanceof PasskeyError) {
      return privateJson({ ok: false, error: error.message }, { status: error.status });
    }
    console.error(JSON.stringify({ event: "auth-route-failed", path: url.pathname }));
    return privateJson({ ok: false, error: "Authentication failed" }, { status: 500 });
  }
}

async function requirePasskeyContext(request: Request, env: Env) {
  const context = await getAuthContext(request, env);
  if (!context || context.session.purpose !== "authenticated") {
    return privateJson({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const verifiedAt = context.session.passkeyVerifiedAt
    ? new Date(context.session.passkeyVerifiedAt).getTime()
    : Number.NaN;
  const reauthWindowMs = getAuthConfig(env, request).adminReauthSeconds * 1000;
  if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > reauthWindowMs) {
    return privateJson({ ok: false, error: "Passkey reauthentication required", reauthenticationRequired: true }, { status: 401 });
  }
  return context;
}

function privateJson(data: unknown, init?: ResponseInit): Response {
  return withPrivateHeaders(json(data, init));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
