import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAccessIdentity } from "./access";
import type { Env } from "./env";

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare Access identity verification", () => {
  it("accepts only a signature, issuer, and audience from the configured application", async () => {
    const teamDomain = `auth-test-${crypto.randomUUID()}.cloudflareaccess.com`;
    const audience = "expected-audience";
    const trusted = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(trusted.publicKey);
    Object.assign(jwk, { kid: "trusted", alg: "RS256", use: "sig" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    })));
    const env = accessEnv(teamDomain, audience);

    const valid = await token(trusted.privateKey, teamDomain, audience, "trusted");
    await expect(requireAccessIdentity(request(valid), env)).resolves.toEqual({
      email: "admin@example.com",
    });

    const wrongAudience = await token(trusted.privateKey, teamDomain, "other-application", "trusted");
    expect(await requireAccessIdentity(request(wrongAudience), env)).toBeInstanceOf(Response);

    const attacker = await generateKeyPair("RS256");
    const forged = await token(attacker.privateKey, teamDomain, audience, "trusted");
    expect(await requireAccessIdentity(request(forged), env)).toBeInstanceOf(Response);
  });
});

function accessEnv(teamDomain: string, audience: string): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    CF_ACCESS_TEAM_DOMAIN: teamDomain,
    CF_ACCESS_AUD: audience,
    ASSETS: null as never,
    DB: null as never,
  };
}

function request(jwt: string): Request {
  return new Request("https://ripota.org/activate-ri-2026/admin/", {
    headers: { "Cf-Access-Jwt-Assertion": jwt },
  });
}

async function token(
  key: CryptoKey,
  teamDomain: string,
  audience: string,
  kid: string,
): Promise<string> {
  return new SignJWT({ email: "admin@example.com" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(`https://${teamDomain}`)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}
