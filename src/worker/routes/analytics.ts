import { parseAnalyticsEvent } from "../../lib/analytics/events";
import type { Env } from "../env";
import { json } from "../http";
import { hasTrustedOrigin } from "../origin";

const maxBodyBytes = 4_096;

export async function handleAnalyticsEvent(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return analyticsJson(
      { ok: false, error: "Method not allowed" },
      { status: 405, headers: { allow: "POST" } },
    );
  }

  if (!hasTrustedOrigin(request, env)) {
    return analyticsJson({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return analyticsJson(
      { ok: false, error: "Expected application/json" },
      { status: 415 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return analyticsJson({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBodyBytes) {
    return analyticsJson({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  let rawEvent: unknown;
  try {
    rawEvent = JSON.parse(body);
  } catch {
    return analyticsJson({ ok: false, error: "Invalid event" }, { status: 400 });
  }

  const event = parseAnalyticsEvent(rawEvent);
  if (!event) {
    return analyticsJson({ ok: false, error: "Invalid event" }, { status: 400 });
  }

  if (!env.ANALYTICS || !env.ANALYTICS_HASH_KEY) {
    return analyticsJson(
      { ok: false, error: "Analytics unavailable" },
      { status: 503 },
    );
  }

  const subjectHash = await hashAnonymousId(
    env.ANALYTICS_HASH_KEY,
    event.scope,
    event.anonymousId,
  );
  const properties = event.properties ?? {};

  env.ANALYTICS.writeDataPoint({
    indexes: [subjectHash],
    blobs: [
      event.scope,
      event.name,
      "anonymous",
      properties.feature ?? "",
      properties.action ?? "",
      properties.placement ?? "",
      properties.outcome ?? "",
      properties.errorCode ?? "",
      properties.filterCategory ?? "",
      properties.importMethod ?? "",
      String(event.schemaVersion),
    ],
    doubles: [1],
  });

  return analyticsJson({ ok: true }, { status: 202 });
}

async function hashAnonymousId(
  secret: string,
  scope: string,
  anonymousId: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${scope}:${anonymousId}`),
  );
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function analyticsJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return json(data, { ...init, headers });
}
