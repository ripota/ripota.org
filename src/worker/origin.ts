import type { Env } from "./env";

export function trustedSiteOrigin(request: Request, env: Env): string | null {
  if (env.SITE_ORIGIN) {
    try {
      return new URL(env.SITE_ORIGIN).origin;
    } catch {
      return null;
    }
  }

  if (env.ALLOW_LOCAL_ADMIN_AUTH === "true") {
    const url = new URL(request.url);
    if (isLoopbackHostname(url.hostname)) {
      return url.origin;
    }
  }

  return null;
}

export function hasTrustedOrigin(request: Request, env: Env): boolean {
  const expected = trustedSiteOrigin(request, env);
  return expected !== null && request.headers.get("origin") === expected;
}

export function trustedSiteUrl(
  request: Request,
  env: Env,
  path: string,
): URL {
  const origin = trustedSiteOrigin(request, env);
  if (!origin) {
    throw new Error("SITE_ORIGIN is not configured.");
  }

  return new URL(path, origin);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
