import type { Env } from "../env";
import type { AuthActivatorMode, AuthAdminMode } from "./types";

export const defaultAdminReauthSeconds = 12 * 60 * 60;

export type AuthConfig = {
  adminMode: AuthAdminMode;
  activatorMode: AuthActivatorMode;
  emailLoginEnabled: boolean;
  adminReauthSeconds: number;
  expectedOrigin: string | null;
  rpId: string | null;
  rpName: "RI POTA";
  passkeyEnabled: boolean;
};

export function getAuthConfig(env: Env, request?: Request): AuthConfig {
  const adminMode = env.AUTH_ADMIN_MODE === "dual" || env.AUTH_ADMIN_MODE === "passkey"
    ? env.AUTH_ADMIN_MODE
    : "access";
  const activatorMode = env.AUTH_ACTIVATOR_MODE === "dual" || env.AUTH_ACTIVATOR_MODE === "unified"
    ? env.AUTH_ACTIVATOR_MODE
    : "legacy";
  const emailLoginEnabled = env.AUTH_EMAIL_LOGIN_ENABLED === "true";
  const adminReauthSeconds = positiveInteger(
    env.AUTH_ADMIN_REAUTH_SECONDS,
    defaultAdminReauthSeconds,
  );
  const expectedOrigin = configuredOrigin(env, request);
  const rpId = expectedOrigin ? rpIdForOrigin(expectedOrigin) : null;
  const passkeyEnabled = adminMode !== "access" || activatorMode !== "legacy";

  if (passkeyEnabled) {
    if (!expectedOrigin || !rpId || !env.DB) {
      throw new Error("Passkey authentication requires a trusted site origin and D1 binding.");
    }
    if (!env.AUTH_RATE_LIMIT_BURST || !env.AUTH_EMAIL_RATE_LIMIT) {
      throw new Error("Passkey authentication requires auth-specific rate-limit bindings.");
    }
  }

  return {
    adminMode,
    activatorMode,
    emailLoginEnabled,
    adminReauthSeconds,
    expectedOrigin,
    rpId,
    rpName: "RI POTA",
    passkeyEnabled,
  };
}

function configuredOrigin(env: Env, request?: Request): string | null {
  if (env.SITE_ORIGIN) {
    try {
      const url = new URL(env.SITE_ORIGIN);
      if (url.pathname !== "/" || url.search || url.hash) {
        return null;
      }
      return url.origin;
    } catch {
      return null;
    }
  }

  if (env.ALLOW_LOCAL_ADMIN_AUTH === "true" && request) {
    const url = new URL(request.url);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") {
      return url.origin;
    }
  }

  return null;
}

function rpIdForOrigin(origin: string): string | null {
  const url = new URL(origin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") {
    return "localhost";
  }
  return url.protocol === "https:" ? url.hostname : null;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
