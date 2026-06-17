import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

export type AccessIdentity = {
  email: string;
};

const accessJwtHeader = "Cf-Access-Jwt-Assertion";
const accessEmailHeader = "Cf-Access-Authenticated-User-Email";
const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type AccessJwtPayload = {
  email?: unknown;
  sub?: unknown;
};

export async function requireAccessIdentity(
  request: Request,
  env: Env,
): Promise<AccessIdentity | Response> {
  if (env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) {
    const identity = await verifyAccessJwt(request, env);
    return identity ?? unauthorized();
  }

  if (env.ALLOW_ADMIN_HEADER_AUTH === "true") {
    const email = request.headers.get(accessEmailHeader);
    if (email) {
      return { email };
    }
  }

  if (env.ALLOW_LOCAL_ADMIN_AUTH === "true" && isLocalRequest(request)) {
    return { email: env.LOCAL_ADMIN_EMAIL ?? "local-admin@ripota.org" };
  }

  return unauthorized();
}

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

async function verifyAccessJwt(
  request: Request,
  env: Env,
): Promise<AccessIdentity | null> {
  const jwt = request.headers.get(accessJwtHeader);
  if (!jwt || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    return null;
  }

  try {
    const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
    const jwks = jwksForTeamDomain(teamDomain);
    const { payload } = await jwtVerify(jwt, jwks, {
      issuer: `https://${teamDomain}`,
      audience: env.CF_ACCESS_AUD,
    });
    const { email, sub } = payload as AccessJwtPayload;
    const identityEmail = stringOrNull(email) ?? stringOrNull(sub);

    return identityEmail ? { email: identityEmail } : null;
  } catch {
    return null;
  }
}

function normalizeTeamDomain(teamDomain: string): string {
  const domain = teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return domain.includes(".") ? domain : `${domain}.cloudflareaccess.com`;
}

function jwksForTeamDomain(
  teamDomain: string,
): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksByTeamDomain.get(teamDomain);
  if (existing) {
    return existing;
  }

  const jwks = createRemoteJWKSet(
    new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
  );
  jwksByTeamDomain.set(teamDomain, jwks);
  return jwks;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
