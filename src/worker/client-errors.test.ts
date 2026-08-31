import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { handleClientErrorReport } from "./routes/client-errors";

afterEach(() => vi.restoreAllMocks());

describe("client error reports", () => {
  it("logs a bounded, redacted, same-origin report", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const limiter = vi.fn(async () => ({ success: true }));
    const response = await handleClientErrorReport(request({
      version: 1,
      kind: "error",
      name: "TypeError",
      message: "Failed for person@example.com at https://ripota.org/page?token=secret",
      route: "/activate-ri-2026/edit/private-token/?token=also-secret",
      source: "https://ripota.org/_astro/app.js?token=asset-secret",
      stack: "TypeError: person@example.com\n at https://ripota.org/app.js?secret=hidden",
      line: 42,
      column: 7,
    }), testEnv({ limit: limiter } as RateLimit));

    expect(response.status).toBe(204);
    expect(limiter).toHaveBeenCalledWith({ key: "client-error:192.0.2.10" });
    expect(error).toHaveBeenCalledOnce();
    const entry = JSON.parse(String(error.mock.calls[0][0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: "client-error",
      kind: "error",
      errorName: "TypeError",
      route: "/activate-ri-2026/edit/[redacted]/",
      line: 42,
      column: 7,
      cfRay: "test-ray-BOS",
    });
    expect(JSON.stringify(entry)).not.toContain("person@example.com");
    expect(JSON.stringify(entry)).not.toContain("private-token");
    expect(JSON.stringify(entry)).not.toContain("asset-secret");
    expect(JSON.stringify(entry)).not.toContain("also-secret");
  });

  it("rejects cross-origin, oversized, malformed, and rate-limited reports", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const allowed = { limit: vi.fn(async () => ({ success: true })) } as RateLimit;
    const denied = { limit: vi.fn(async () => ({ success: false })) } as RateLimit;

    expect((await handleClientErrorReport(request(validReport(), {
      origin: "https://example.com",
    }), testEnv(allowed))).status).toBe(403);
    expect((await handleClientErrorReport(request(validReport(), {
      contentLength: "9000",
    }), testEnv(allowed))).status).toBe(413);
    expect((await handleClientErrorReport(request({ ...validReport(), route: "https://example.com/" }), testEnv(allowed))).status).toBe(400);
    expect((await handleClientErrorReport(request(validReport()), testEnv(denied))).status).toBe(429);
    expect(error).not.toHaveBeenCalled();
  });
});

function validReport(): Record<string, unknown> {
  return {
    version: 1,
    kind: "unhandledrejection",
    message: "Unhandled promise rejection",
    route: "/account/security/",
  };
}

function request(
  body: Record<string, unknown>,
  options: { origin?: string; contentLength?: string } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    origin: options.origin ?? "https://ripota.org",
    "CF-Connecting-IP": "192.0.2.10",
    "cf-ray": "test-ray-BOS",
  });
  if (options.contentLength) headers.set("content-length", options.contentLength);
  return new Request("https://ripota.org/api/client-errors", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function testEnv(CLIENT_ERROR_RATE_LIMIT: RateLimit): Env {
  return {
    ASSETS: null as never,
    DB: null as never,
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    CLIENT_ERROR_RATE_LIMIT,
    SITE_ORIGIN: "https://ripota.org",
  };
}
