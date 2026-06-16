import { afterEach, describe, expect, it, vi } from "vitest";
import { handleActivateRiApi } from "./activate-ri";
import type { Env } from "../env";

function env(): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    TURNSTILE_REQUIRED: "false",
    ALLOW_ADMIN_HEADER_AUTH: "false",
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(async () => ({ success: true })),
        all: vi.fn(),
        first: vi.fn(),
      })),
      batch: vi.fn(async () => []),
    } as unknown as D1Database,
  };
}

function adminEnv(): Env {
  return {
    ...env(),
    ALLOW_ADMIN_HEADER_AUTH: "true",
  };
}

function turnstileEnv(): Env {
  return {
    ...env(),
    TURNSTILE_REQUIRED: "true",
    TURNSTILE_SECRET_KEY: "test-secret",
  };
}

function validPayload(): Record<string, unknown> {
  return {
    submitterCallsign: "N1RWJ",
    submitterName: "Rob Jackson",
    submitterEmail: "rob@example.com",
    stops: [
      {
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        bands: ["40m"],
        modes: ["SSB"],
      },
    ],
  };
}

function validPayloadWithTurnstile(): unknown {
  return {
    ...validPayload(),
    turnstileToken: "test-token",
  };
}

function post(path: string, payload: unknown): Request {
  return new Request(`https://ripota.org${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function adminRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://ripota.org${path}`, init);
}

type AdminDbOptions = {
  listRows?: unknown[];
  routeStatus?: string | null;
  routeUpdateChanges?: number;
};

function adminDb(options: AdminDbOptions = {}): D1Database {
  const batch = vi.fn(async () => []);
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => ({
        success: true,
        meta: { changes: options.routeUpdateChanges ?? 1 },
      })),
      all: vi.fn(async () => ({
        results:
          options.listRows ??
          (sql.includes("SELECT *")
            ? [{ id: "route-1", edit_token_hash: "secret-token-hash" }]
            : [{ id: "route-1", status: "pending" }]),
      })),
      first: vi.fn(async () => {
        if (options.routeStatus === undefined) {
          return { status: "pending" };
        }

        if (options.routeStatus === null) {
          return null;
        }

        return { status: options.routeStatus };
      }),
    };

    return statement;
  });

  return {
    prepare,
    batch,
  } as unknown as D1Database;
}

describe("handleActivateRiApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts valid route submissions for organizer review", async () => {
    const testEnv = env();
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", validPayload()),
      testEnv,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "Submission received for organizer review.",
    });
    expect(testEnv.DB.batch).toHaveBeenCalledOnce();
  });

  it("returns validation errors for invalid route submissions", async () => {
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", {
        submitterCallsign: "not a call sign!",
        submitterName: "",
        submitterEmail: "not-email",
        stops: [],
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "Enter a valid activator callsign.",
        "Enter the activator name.",
        "Enter a valid email address.",
        "Add at least one activation stop.",
      ]),
    });
  });

  it("returns validation errors for non-object JSON payloads", async () => {
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", null),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Enter a valid route submission."],
    });
  });

  it("returns JSON errors for unsupported content types", async () => {
    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/routes", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hello",
      }),
      env(),
    );

    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Expected application/json."],
    });
  });

  it("returns JSON errors for malformed JSON", async () => {
    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/routes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
      env(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Expected valid JSON."],
    });
  });

  it("returns sanitized JSON errors when Turnstile is required without a token", async () => {
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", validPayload()),
      turnstileEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Turnstile verification failed."],
    });
  });

  it("returns sanitized JSON errors when Turnstile verification is unsuccessful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: false })),
    );

    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", validPayloadWithTurnstile()),
      turnstileEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Turnstile verification failed."],
    });
  });

  it("returns sanitized JSON errors when Turnstile verification cannot be parsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );

    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", validPayloadWithTurnstile()),
      turnstileEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Turnstile verification failed."],
    });
  });

  it("returns sanitized JSON errors when Turnstile verification fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );

    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/routes", validPayloadWithTurnstile()),
      turnstileEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Turnstile verification failed."],
    });
  });

  it("returns JSON 404 for unknown Activate RI API routes", async () => {
    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/missing"),
      env(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Not found",
    });
  });

  it("requires Cloudflare Access identity for admin routes", async () => {
    const listResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes"),
      env(),
    );
    const approveResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes/route-1/approve", {
        method: "POST",
      }),
      env(),
    );

    expect(listResponse.status).toBe(401);
    expect(listResponse.headers.get("content-type")).toContain(
      "application/json",
    );
    await expect(listResponse.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
    expect(approveResponse.status).toBe(401);
    await expect(approveResponse.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("allows local admin header auth only when explicitly enabled", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes", {
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      routes: [{ id: "route-1", status: "pending" }],
    });
  });

  it("rejects spoofed admin email headers without Access config or local bypass", async () => {
    const testEnv = env();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes", {
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("rejects spoofed admin email headers when Access JWT config is present", async () => {
    const testEnv = {
      ...env(),
      CF_ACCESS_TEAM_DOMAIN: "ripota.cloudflareaccess.com",
      CF_ACCESS_AUD: "test-audience",
    };
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "admin@example.com",
          "Cf-Access-Jwt-Assertion": "not-a-valid-jwt",
        },
      }),
      testEnv,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("lists pending routes for authenticated admins without exposing edit tokens", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes", {
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      routes: [{ id: "route-1", status: "pending" }],
    });
    expect(JSON.stringify(body)).not.toContain("edit_token_hash");
    expect(testEnv.DB.prepare).toHaveBeenCalledWith(
      expect.not.stringContaining("SELECT *"),
    );
    expect(testEnv.DB.prepare).toHaveBeenCalledWith(
      expect.not.stringContaining("edit_token_hash"),
    );
  });

  it("approves pending routes for authenticated admins", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb({ routeStatus: "pending", routeUpdateChanges: 1 });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes/route-1/approve", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(testEnv.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ? AND event_id = ? AND status = 'pending'"),
    );
    expect(testEnv.DB.batch).toHaveBeenCalledOnce();
    expect(testEnv.DB.batch).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ]);
  });

  it("returns 404 for missing route approvals without scheduling stops or audit", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb({ routeStatus: null });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes/missing-route/approve", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Route not found",
    });
    expect(testEnv.DB.batch).not.toHaveBeenCalled();
  });

  it("returns 409 for wrong-status route approvals without scheduling stops or audit", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb({ routeStatus: "approved" });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes/route-1/approve", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Route is not pending",
    });
    expect(testEnv.DB.batch).not.toHaveBeenCalled();
  });
});
