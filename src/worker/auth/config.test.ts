import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { defaultAdminReauthSeconds, getAuthConfig } from "./config";

describe("auth configuration", () => {
  it("keeps every new authentication feature dormant by default", () => {
    expect(getAuthConfig(baseEnv())).toMatchObject({
      adminMode: "access",
      activatorMode: "legacy",
      emailLoginEnabled: false,
      adminReauthSeconds: defaultAdminReauthSeconds,
      expectedOrigin: "https://ripota.org",
      rpId: "ripota.org",
    });
  });

  it("derives production WebAuthn identity only from SITE_ORIGIN", () => {
    const env = baseEnv({ SITE_ORIGIN: "https://auth.ripota.org" });
    const request = new Request("https://attacker.example/account/sign-in", {
      headers: { origin: "https://attacker.example", host: "attacker.example" },
    });
    expect(getAuthConfig(env, request)).toMatchObject({
      expectedOrigin: "https://auth.ripota.org",
      rpId: "auth.ripota.org",
    });
  });

  it("uses localhost and its exact origin only in explicit local mode", () => {
    const env = baseEnv({ SITE_ORIGIN: undefined, ALLOW_LOCAL_ADMIN_AUTH: "true" });
    expect(getAuthConfig(env, new Request("http://localhost:8787/path"))).toMatchObject({
      expectedOrigin: "http://localhost:8787",
      rpId: "localhost",
    });
  });

  it("fails closed when passkey mode lacks origin or rate limits", () => {
    expect(() => getAuthConfig(baseEnv({
      AUTH_ADMIN_MODE: "passkey",
      SITE_ORIGIN: undefined,
    }))).toThrow(/trusted site origin/i);
    expect(() => getAuthConfig(baseEnv({
      AUTH_ADMIN_MODE: "dual",
      AUTH_RATE_LIMIT_BURST: undefined,
    }))).toThrow(/rate-limit bindings/i);
  });
});

function baseEnv(overrides: Partial<Env> = {}): Env {
  const limiter = { limit: async () => ({ success: true }) } as RateLimit;
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    ASSETS: null as never,
    DB: {} as D1Database,
    SITE_ORIGIN: "https://ripota.org",
    AUTH_RATE_LIMIT_BURST: limiter,
    AUTH_EMAIL_RATE_LIMIT: limiter,
    ...overrides,
  };
}
