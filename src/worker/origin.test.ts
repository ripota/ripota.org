import { describe, expect, it } from "vitest";
import type { Env } from "./env";
import { hasTrustedOrigin, trustedSiteOrigin, trustedSiteUrl } from "./origin";

const baseEnv = {
  ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
  ASSETS: {} as Fetcher,
  DB: {} as D1Database,
} satisfies Env;

describe("trusted site origin", () => {
  it("uses the configured canonical origin instead of forwarded request hosts", () => {
    const env = { ...baseEnv, SITE_ORIGIN: "https://ripota.org/path" };
    const request = new Request("https://attacker.example/path", {
      headers: { origin: "https://ripota.org" },
    });

    expect(trustedSiteOrigin(request, env)).toBe("https://ripota.org");
    expect(hasTrustedOrigin(request, env)).toBe(true);
    expect(trustedSiteUrl(request, env, "/private/").href).toBe(
      "https://ripota.org/private/",
    );
  });

  it("rejects absent and cross-site origins", () => {
    const env = { ...baseEnv, SITE_ORIGIN: "https://ripota.org" };

    expect(hasTrustedOrigin(new Request("https://ripota.org/private"), env)).toBe(
      false,
    );
    expect(
      hasTrustedOrigin(
        new Request("https://ripota.org/private", {
          headers: { origin: "https://attacker.example" },
        }),
        env,
      ),
    ).toBe(false);
  });

  it("allows a loopback request origin only in explicit local mode", () => {
    const request = new Request("http://127.0.0.1:4321/private", {
      headers: { origin: "http://127.0.0.1:4321" },
    });

    expect(hasTrustedOrigin(request, baseEnv)).toBe(false);
    expect(
      hasTrustedOrigin(request, {
        ...baseEnv,
        ALLOW_LOCAL_ADMIN_AUTH: "true",
      }),
    ).toBe(true);
  });
});
