import type { Env } from "../env";
import { hasTrustedOrigin } from "../origin";

const maximumBodyBytes = 8 * 1024;
const maximumMessageLength = 500;
const maximumNameLength = 80;
const maximumRouteLength = 300;
const maximumSourceLength = 500;
const maximumStackLength = 4 * 1024;

type ClientErrorKind = "error" | "resource" | "unhandledrejection";

type ClientErrorReport = {
  version: 1;
  kind: ClientErrorKind;
  name?: string;
  message: string;
  route: string;
  source?: string;
  stack?: string;
  line?: number;
  column?: number;
};

export async function handleClientErrorReport(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return emptyResponse(405, { allow: "POST" });
  }
  if (!hasTrustedOrigin(request, env)) {
    return emptyResponse(403);
  }
  if (!await withinClientErrorRateLimit(request, env)) {
    return emptyResponse(429, { "retry-after": "60" });
  }

  const body = await readBoundedJson(request);
  if (!body.ok) {
    return emptyResponse(body.status);
  }
  const report = clientErrorReport(body.value);
  if (!report) {
    return emptyResponse(400);
  }

  console.error(JSON.stringify({
    event: "client-error",
    kind: report.kind,
    errorName: report.name,
    message: redactClientText(report.message),
    route: sanitizeRoute(report.route),
    source: report.source ? redactClientText(report.source) : undefined,
    stack: report.stack ? redactClientText(report.stack) : undefined,
    line: report.line,
    column: report.column,
    cfRay: safeCfRay(request.headers.get("cf-ray")),
  }));

  return emptyResponse(204);
}

async function withinClientErrorRateLimit(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (!env.CLIENT_ERROR_RATE_LIMIT) {
    return true;
  }
  const networkKey = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return (await env.CLIENT_ERROR_RATE_LIMIT.limit({
    key: `client-error:${networkKey}`,
  })).success;
}

function clientErrorReport(value: unknown): ClientErrorReport | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  if (
    value.kind !== "error" &&
    value.kind !== "resource" &&
    value.kind !== "unhandledrejection"
  ) {
    return null;
  }
  if (!boundedString(value.message, 1, maximumMessageLength)) {
    return null;
  }
  if (
    !boundedString(value.route, 1, maximumRouteLength) ||
    !value.route.startsWith("/")
  ) {
    return null;
  }
  if (value.name !== undefined && !boundedString(value.name, 1, maximumNameLength)) {
    return null;
  }
  if (value.source !== undefined && !boundedString(value.source, 1, maximumSourceLength)) {
    return null;
  }
  if (value.stack !== undefined && !boundedString(value.stack, 1, maximumStackLength)) {
    return null;
  }
  if (!optionalLocationNumber(value.line) || !optionalLocationNumber(value.column)) {
    return null;
  }

  return {
    version: 1,
    kind: value.kind,
    message: value.message,
    route: value.route,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.source === undefined ? {} : { source: value.source }),
    ...(value.stack === undefined ? {} : { stack: value.stack }),
    ...(value.line === undefined ? {} : { line: value.line }),
    ...(value.column === undefined ? {} : { column: value.column }),
  };
}

function optionalLocationNumber(value: unknown): value is number | undefined {
  return value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000);
}

function boundedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return typeof value === "string" &&
    value.length >= minimumLength &&
    value.length <= maximumLength;
}

function sanitizeRoute(route: string): string {
  const pathname = route.split(/[?#]/, 1)[0];
  return pathname.replace(
    /^(\/activate-ri-2026\/edit\/)[^/]+/,
    "$1[redacted]",
  );
}

function redactClientText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .replace(
      /([?&](?:access_token|code|key|secret|session|token)=)[^&#\s]+/gi,
      "$1[redacted]",
    );
}

function safeCfRay(value: string | null): string | undefined {
  return value && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : undefined;
}

type ReadJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415 };

async function readBoundedJson(request: Request): Promise<ReadJsonResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { ok: false, status: 415 };
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    return { ok: false, status: 413 };
  }
  if (!request.body) {
    return { ok: false, status: 400 };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maximumBodyBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(result.value);
    }
  } catch {
    return { ok: false, status: 400 };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
    };
  } catch {
    return { ok: false, status: 400 };
  }
}

function emptyResponse(status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
