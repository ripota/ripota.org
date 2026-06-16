import { afterEach, describe, expect, it, vi } from "vitest";
import { handleActivateRiApi } from "./activate-ri";
import type { Env } from "../env";

function env(): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    TURNSTILE_REQUIRED: "false",
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

  it("lists pending routes for authenticated admins", async () => {
    const routes = [
      {
        id: "route-1",
        event_id: "activate-ri-2026",
        submitter_callsign: "N1RWJ",
        status: "pending",
      },
    ];
    const testEnv = env();
    const all = vi.fn(async () => ({ results: routes }));
    const prepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => ({ success: true })),
      all,
      first: vi.fn(),
    }));
    testEnv.DB = {
      ...testEnv.DB,
      prepare,
    } as unknown as D1Database;

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes", {
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, routes });
    expect(prepare).toHaveBeenCalledWith(
      `SELECT * FROM activate_ri_routes WHERE status = 'pending' ORDER BY created_at ASC`,
    );
    expect(all).toHaveBeenCalledOnce();
  });

  it("approves routes for authenticated admins", async () => {
    const testEnv = env();
    const batch = vi.fn(async () => []);
    const bind = vi.fn().mockReturnThis();
    const prepare = vi.fn(() => ({
      bind,
      run: vi.fn(async () => ({ success: true })),
      all: vi.fn(),
      first: vi.fn(),
    }));
    testEnv.DB = {
      ...testEnv.DB,
      prepare,
      batch,
    } as unknown as D1Database;

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes/route-1/approve", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      "admin@example.com",
      expect.any(String),
      "route-1",
    );
    expect(bind).toHaveBeenCalledWith(expect.any(String), "route-1");
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      "activate-ri-2026",
      "route-1",
      "admin@example.com",
      expect.any(String),
    );
    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
      expect.anything(),
    ]);
  });
});
