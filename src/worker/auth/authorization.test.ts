import { describe, expect, it } from "vitest";
import { defaultAdminReauthSeconds } from "./config";
import { evaluateAdminAuthorization } from "./authorization";
import type { AuthContext, AuthMethod, AuthSessionPurpose } from "./types";

const now = new Date("2026-08-30T12:00:00.000Z");

describe("admin authorization contract", () => {
  it("accepts a current passkey session with an active admin role", () => {
    expect(evaluateAdminAuthorization(context(), config, now)).toBeNull();
  });

  it("requires passkey assurance even for dual-role email sessions", () => {
    expect(evaluateAdminAuthorization(context({
      method: "email",
      passkeyVerifiedAt: null,
      activator: true,
    }), config, now)).toBe("reauthentication-required");
  });

  it("rejects stale assurance, missing roles, and non-authenticated sessions", () => {
    expect(evaluateAdminAuthorization(context({
      passkeyVerifiedAt: "2026-08-29T23:59:59.000Z",
    }), config, now)).toBe("reauthentication-required");
    expect(evaluateAdminAuthorization(context({ admin: false }), config, now)).toBe("forbidden");
    expect(evaluateAdminAuthorization(context({ purpose: "enrollment" }), config, now)).toBe("unauthenticated");
    expect(evaluateAdminAuthorization(context({ purpose: "recovery" }), config, now)).toBe("unauthenticated");
    expect(evaluateAdminAuthorization(null, config, now)).toBe("unauthenticated");
  });
});

const config = { adminReauthSeconds: defaultAdminReauthSeconds };

function context(overrides: {
  method?: AuthMethod;
  purpose?: AuthSessionPurpose;
  passkeyVerifiedAt?: string | null;
  admin?: boolean;
  activator?: boolean;
} = {}): AuthContext {
  return {
    user: {
      id: "user",
      webauthnUserId: "webauthn-user",
      displayName: "User",
      primaryEmail: "user@example.com",
      disabledAt: null,
    },
    session: {
      id: "session",
      userId: "user",
      purpose: overrides.purpose ?? "authenticated",
      authenticationMethod: overrides.method ?? "passkey",
      authenticatedAt: now.toISOString(),
      passkeyVerifiedAt: overrides.passkeyVerifiedAt === undefined ? now.toISOString() : overrides.passkeyVerifiedAt,
      createdAt: now.toISOString(),
      expiresAt: "2026-09-13T12:00:00.000Z",
      lastUsedAt: now.toISOString(),
    },
    admin: overrides.admin ?? true,
    activator: overrides.activator ? {
      activatorId: "activator",
      eventId: "activate-ri-2026",
      callsign: "N1ABC",
      name: "User",
      status: "approved",
    } : null,
  };
}
