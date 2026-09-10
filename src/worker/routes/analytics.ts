import { parseAnalyticsEvent } from "../../lib/analytics/events";
import type { Env } from "../env";
import { json } from "../http";
import { hasTrustedOrigin } from "../origin";
import { persistAnonymousAnalyticsEvent, recordAnalyticsIngestionOutcome } from "../analytics-archive";

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

  if (!await withinAnalyticsRateLimit(request, env)) {
    await recordOutcome(env, "rate_limited");
    return analyticsJson(
      { ok: false, error: "Too many requests" },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    await recordOutcome(env, "rejected");
    return analyticsJson(
      { ok: false, error: "Expected application/json" },
      { status: 415 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    await recordOutcome(env, "rejected");
    return analyticsJson({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  const body = await readBoundedBody(request);
  if (body === null) {
    await recordOutcome(env, "rejected");
    return analyticsJson({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  let rawEvent: unknown;
  try {
    rawEvent = JSON.parse(body);
  } catch {
    await recordOutcome(env, "rejected");
    return analyticsJson({ ok: false, error: "Invalid event" }, { status: 400 });
  }

  const event = parseAnalyticsEvent(rawEvent);
  if (!event) {
    await recordOutcome(env, "rejected");
    return analyticsJson({ ok: false, error: "Invalid event" }, { status: 400 });
  }

  if (!env.ANALYTICS_HASH_KEY) {
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
  let inserted: boolean;
  try {
    inserted = await persistAnonymousAnalyticsEvent(env.DB, event, subjectHash, new Date().toISOString());
  } catch {
    await recordOutcome(env, "storage_failed");
    return analyticsJson({ ok: false, error: "Analytics unavailable" }, { status: 503 });
  }
  await recordOutcome(env, inserted ? "accepted" : "duplicate");
  if (!inserted) return analyticsJson({ ok: true }, { status: 202 });

  try {
    if (!env.ANALYTICS) throw new Error("Analytics mirror unavailable");
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
        ...(event.schemaVersion === 2 ? [
          event.occurredAt,
          properties.entryMode ?? "",
          properties.agendaScope ?? "",
          properties.direction ?? "",
          properties.persistence ?? "",
          properties.importQuality ?? "",
          properties.pageCategory ?? "",
          properties.importAttemptId ?? "",
          event.eventId,
        ] : []),
      ],
      doubles: event.schemaVersion === 1 ? [1] : [
        1,
        properties.completedCount ?? -1,
        properties.totalCount ?? -1,
        properties.parkCount ?? -1,
        properties.windowCount ?? -1,
        properties.examinedRows ?? -1,
        properties.recoveredRows ?? -1,
        properties.skippedRows ?? -1,
        properties.matchedCount ?? -1,
      ],
    });
  } catch {
    await recordOutcome(env, "mirror_failed");
    console.error(JSON.stringify({ event: "analytics-mirror-failed" }));
  }

  return analyticsJson({ ok: true }, { status: 202 });
}

async function recordOutcome(env: Env, outcome: Parameters<typeof recordAnalyticsIngestionOutcome>[1]): Promise<void> {
  try {
    await recordAnalyticsIngestionOutcome(env.DB, outcome, new Date().toISOString());
  } catch { /* Diagnostics must not turn a durable accepted event into a failure. */ }
}

async function withinAnalyticsRateLimit(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (!env.ANALYTICS_RATE_LIMIT) {
    return true;
  }
  const networkKey = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return (await env.ANALYTICS_RATE_LIMIT.limit({
    key: `analytics:${networkKey}`,
  })).success;
}

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } catch {
    return "";
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
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
