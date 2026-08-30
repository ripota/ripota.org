export type PrivatePageKind = "portal" | "editor";

const sharedDirectives = [
  "default-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
];

export function withPrivateHeaders(
  response: Response,
  kind: PrivatePageKind = "portal",
): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("pragma", "no-cache");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
  headers.set("content-security-policy", contentSecurityPolicy(kind));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function contentSecurityPolicy(kind: PrivatePageKind): string {
  const scriptSources = kind === "editor"
    ? "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com"
    : "script-src 'self' 'unsafe-inline'";
  const frameSources = kind === "editor"
    ? "frame-src https://challenges.cloudflare.com"
    : "frame-src 'none'";

  return [
    ...sharedDirectives,
    scriptSources,
    frameSources,
    "connect-src 'self' wss://ripota.org",
  ].join("; ");
}
