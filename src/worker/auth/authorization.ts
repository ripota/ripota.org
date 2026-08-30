import { requireAccessIdentity, type AccessIdentity } from "../access";
import {
  getActivatorSession,
  type ActivatorSessionIdentity,
} from "../activator-session";
import type { Env } from "../env";
import { json } from "../http";
import { withPrivateHeaders } from "../private-response";
import { getAuthConfig } from "./config";
import { getAuthContext } from "./session";
import type { AuthConfig } from "./config";
import type { AuthContext } from "./types";

export type AdminIdentity = AccessIdentity & {
  userId?: string;
  authentication: "passkey" | "access";
};

export type ActivatorIdentity = ActivatorSessionIdentity & {
  userId?: string;
  authentication: "unified" | "legacy";
};

export type AdminAuthorizationFailure = "unauthenticated" | "forbidden" | "reauthentication-required";

export function evaluateAdminAuthorization(
  context: AuthContext | null,
  config: Pick<AuthConfig, "adminReauthSeconds">,
  now = new Date(),
): AdminAuthorizationFailure | null {
  if (!context || context.session.purpose !== "authenticated") {
    return "unauthenticated";
  }
  if (!context.admin) {
    return "forbidden";
  }
  if (!context.session.passkeyVerifiedAt) {
    return "reauthentication-required";
  }
  const verifiedAt = new Date(context.session.passkeyVerifiedAt).getTime();
  if (!Number.isFinite(verifiedAt) || now.getTime() - verifiedAt > config.adminReauthSeconds * 1000) {
    return "reauthentication-required";
  }
  return null;
}

export async function requireAdmin(
  request: Request,
  env: Env,
  options: { navigation?: boolean; now?: Date } = {},
): Promise<AdminIdentity | Response> {
  const config = getAuthConfig(env, request);
  if (config.adminMode !== "access") {
    const context = await getAuthContext(request, env, options.now);
    const failure = evaluateAdminAuthorization(context, config, options.now);
    if (!failure && context) {
      return {
        email: context.user.primaryEmail ?? "verified-user",
        userId: context.user.id,
        authentication: "passkey",
      };
    }
    if (config.adminMode === "passkey") {
      return adminFailureResponse(request, failure, options.navigation);
    }
  }

  const access = await requireAccessIdentity(request, env);
  return access instanceof Response
    ? adminFailureResponse(request, "unauthenticated", options.navigation)
    : { ...access, authentication: "access" };
}

export async function requireActivator(
  request: Request,
  env: Env,
): Promise<ActivatorIdentity | Response> {
  const config = getAuthConfig(env, request);
  if (config.activatorMode !== "legacy") {
    const context = await getAuthContext(request, env);
    if (context?.session.purpose === "authenticated" && context.activator) {
      return {
        activatorId: context.activator.activatorId,
        eventId: context.activator.eventId,
        callsign: context.activator.callsign,
        name: context.activator.name,
        status: context.activator.status,
        expiresAt: context.session.expiresAt,
        userId: context.user.id,
        authentication: "unified",
      };
    }
    if (config.activatorMode === "unified") {
      return unauthorized();
    }
  }

  const legacy = await getActivatorSession(request, env);
  return legacy ? { ...legacy, authentication: "legacy" } : unauthorized();
}

function adminFailureResponse(
  request: Request,
  failure: AdminAuthorizationFailure | null,
  navigation = false,
): Response {
  if (navigation && request.method === "GET") {
    const url = new URL(request.url);
    const returnTo = `${url.pathname}${url.search}`;
    const location = `/account/sign-in/?returnTo=${encodeURIComponent(returnTo)}`;
    return withPrivateHeaders(new Response(null, { status: 303, headers: { location } }));
  }
  const status = failure === "forbidden" ? 403 : 401;
  return withPrivateHeaders(json({
    ok: false,
    error: failure === "reauthentication-required" ? "Passkey reauthentication required" : status === 403 ? "Forbidden" : "Unauthorized",
    reauthenticationRequired: failure === "reauthentication-required",
  }, { status }));
}

function unauthorized(): Response {
  return withPrivateHeaders(json({ ok: false, error: "Unauthorized" }, { status: 401 }));
}
