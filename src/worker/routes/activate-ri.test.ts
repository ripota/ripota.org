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

function patch(path: string, payload: unknown, headers?: HeadersInit): Request {
  return new Request(`https://ripota.org${path}`, {
    method: "PATCH",
    headers: headers ?? { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function adminRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://ripota.org${path}`, init);
}

type AdminDbOptions = {
  routeRows?: unknown[];
  stopRows?: unknown[];
  routeStatus?: string | null;
  routeUpdateChanges?: number;
};

const pendingRouteRow = {
  id: "route-1",
  event_id: "activate-ri-2026",
  submitter_callsign: "N1RWJ",
  submitter_name: "Rob Jackson",
  submitter_email: "rob@example.com",
  submitter_phone: "401-555-0100",
  club: "Rhode Island POTA",
  public_notes: "Open to hunters.",
  organizer_notes: "Needs review.",
  status: "pending",
  created_at: "2026-06-16T12:00:00.000Z",
  updated_at: "2026-06-16T12:00:00.000Z",
  approved_at: null,
  approved_by: null,
};

const pendingStopRow = {
  id: "stop-1",
  route_id: "route-1",
  event_id: "activate-ri-2026",
  park_reference: "US-2868",
  planned_date: "2026-09-11",
  start_time: "09:00",
  end_time: "11:00",
  bands_json: '["40m","20m"]',
  modes_json: '["SSB","CW"]',
  public_notes: "Meet near the trailhead.",
  organizer_notes: "Confirm parking.",
  status: "pending-review",
  created_at: "2026-06-16T12:00:00.000Z",
  updated_at: "2026-06-16T12:00:00.000Z",
};

const pendingRouteDto = {
  ...pendingRouteRow,
  stops: [
    {
      id: "stop-1",
      route_id: "route-1",
      event_id: "activate-ri-2026",
      park_reference: "US-2868",
      planned_date: "2026-09-11",
      start_time: "09:00",
      end_time: "11:00",
      bands: ["40m", "20m"],
      modes: ["SSB", "CW"],
      public_notes: "Meet near the trailhead.",
      organizer_notes: "Confirm parking.",
      status: "pending-review",
      created_at: "2026-06-16T12:00:00.000Z",
      updated_at: "2026-06-16T12:00:00.000Z",
    },
  ],
};

function adminDb(options: AdminDbOptions = {}): D1Database {
  const batch = vi.fn(async (statements: unknown[]) =>
    statements.map((_, index) => ({
      success: true,
      meta: { changes: index === 0 ? (options.routeUpdateChanges ?? 1) : 1 },
    })),
  );
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => ({
        success: true,
        meta: { changes: options.routeUpdateChanges ?? 1 },
      })),
      all: vi.fn(async () => ({
        results: sql.includes("FROM activate_ri_stops")
          ? (options.stopRows ?? [pendingStopRow])
          : (options.routeRows ?? [pendingRouteRow]),
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

type EditDbOptions = {
  routeStatus?: string | null;
  changes?: number;
};

function editDb(options: EditDbOptions = {}): D1Database {
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => ({
        success: true,
        meta: { changes: options.changes ?? 1 },
      })),
      all: vi.fn(),
      first: vi.fn(async () => {
        if (!sql.includes("INNER JOIN activate_ri_routes")) {
          return null;
        }

        if (options.routeStatus === null) {
          return null;
        }

        return { status: options.routeStatus ?? "approved" };
      }),
    };

    return statement;
  });

  return {
    prepare,
    batch: vi.fn(async () => []),
  } as unknown as D1Database;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
      routes: [pendingRouteDto],
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

  it("lists pending routes with stops for authenticated admins without exposing edit tokens", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/routes", {
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    const body = await response.json() as { routes: typeof pendingRouteDto[] };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      routes: [pendingRouteDto],
    });
    expect(body.routes[0].stops[0]).toMatchObject({
      park_reference: "US-2868",
      planned_date: "2026-09-11",
      start_time: "09:00",
      end_time: "11:00",
      bands: ["40m", "20m"],
      modes: ["SSB", "CW"],
      public_notes: "Meet near the trailhead.",
      organizer_notes: "Confirm parking.",
    });
    expect(JSON.stringify(body)).not.toContain("edit_token_hash");
    expect(JSON.stringify(body)).not.toContain("approval_operation_id");
    const preparedSql = vi.mocked(testEnv.DB.prepare).mock.calls
      .map(([sql]) => sql)
      .join("\n");
    expect(preparedSql).toContain("FROM activate_ri_stops");
    expect(preparedSql).not.toContain("SELECT *");
    expect(preparedSql).not.toContain("edit_token_hash");
    expect(preparedSql).not.toContain("approval_operation_id");
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
      expect.anything(),
    ]);
    const prepareCalls = vi.mocked(testEnv.DB.prepare).mock.calls;
    const routeUpdateSql = prepareCalls[1][0];
    const stopUpdateSql = prepareCalls[2][0];
    const auditInsertSql = prepareCalls[3][0];
    expect(routeUpdateSql).toContain("UPDATE activate_ri_routes");
    expect(routeUpdateSql).toContain("approval_operation_id = ?");
    expect(stopUpdateSql).toContain("UPDATE activate_ri_stops");
    expect(stopUpdateSql).toContain("AND approval_operation_id = ?");
    expect(stopUpdateSql).not.toContain("AND approved_at = ?");
    expect(stopUpdateSql).not.toContain("AND approved_by = ?");
    expect(auditInsertSql).toContain("INSERT INTO activate_ri_audit_events");
    expect(auditInsertSql).toContain("AND approval_operation_id = ?");
    expect(auditInsertSql).not.toContain("AND approved_at = ?");
    expect(auditInsertSql).not.toContain("AND approved_by = ?");

    const batchStatements = vi.mocked(testEnv.DB.batch).mock
      .calls[0][0] as unknown as Array<{
      bind: { mock: { calls: unknown[][] } };
    }>;
    const routeUpdateBinds = batchStatements[0].bind.mock.calls[0];
    const stopUpdateBinds = batchStatements[1].bind.mock.calls[0];
    const auditInsertBinds = batchStatements[2].bind.mock.calls[0];
    const approvalOperationId = routeUpdateBinds[2];
    expect(typeof approvalOperationId).toBe("string");
    expect(stopUpdateBinds.at(-1)).toBe(approvalOperationId);
    expect(auditInsertBinds.at(-1)).toBe(approvalOperationId);
  });

  it("returns 409 without scheduling stops or audit when the route transition loses a race", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb({ routeStatus: "pending", routeUpdateChanges: 0 });

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
    expect(testEnv.DB.batch).toHaveBeenCalledOnce();
    const prepareCalls = vi.mocked(testEnv.DB.prepare).mock.calls;
    const routeUpdateSql = prepareCalls[1][0];
    const stopUpdateSql = prepareCalls[2][0];
    const auditInsertSql = prepareCalls[3][0];
    expect(routeUpdateSql).toContain("approval_operation_id = ?");
    expect(stopUpdateSql).toContain("AND approval_operation_id = ?");
    expect(stopUpdateSql).not.toContain("AND approved_at = ?");
    expect(stopUpdateSql).not.toContain("AND approved_by = ?");
    expect(auditInsertSql).toContain("AND approval_operation_id = ?");
    expect(auditInsertSql).not.toContain("AND approved_at = ?");
    expect(auditInsertSql).not.toContain("AND approved_by = ?");

    const batchStatements = vi.mocked(testEnv.DB.batch).mock
      .calls[0][0] as unknown as Array<{
      bind: { mock: { calls: unknown[][] } };
    }>;
    const routeUpdateBinds = batchStatements[0].bind.mock.calls[0];
    const stopUpdateBinds = batchStatements[1].bind.mock.calls[0];
    const auditInsertBinds = batchStatements[2].bind.mock.calls[0];
    const approvalOperationId = routeUpdateBinds[2];
    expect(stopUpdateBinds.at(-1)).toBe(approvalOperationId);
    expect(auditInsertBinds.at(-1)).toBe(approvalOperationId);
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

  it("updates approved stops through a hashed edit token", async () => {
    const testEnv = env();
    testEnv.DB = editDb();
    const token = "magic-token";
    const response = await handleActivateRiApi(
      patch(`/api/activate-ri-2026/edit/${token}/stops/stop-1`, {
        startTime: "10:00",
        endTime: "12:00",
        bands: ["40m", "20m"],
        modes: ["SSB", "CW"],
        publicNotes: "Updated trailhead plan.",
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(testEnv.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("r.edit_token_hash = ?"),
    );
    expect(testEnv.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE activate_ri_stops"),
    );

    const statements = vi.mocked(testEnv.DB.prepare).mock.results.map(
      (result) => result.value as { bind: { mock: { calls: unknown[][] } } },
    );
    const routeLookupBinds = statements[0].bind.mock.calls[0];
    const updateBinds = statements[1].bind.mock.calls[0];
    const expectedHash = await sha256Hex(token);
    expect(routeLookupBinds).toEqual([
      "stop-1",
      "activate-ri-2026",
      "activate-ri-2026",
      expectedHash,
    ]);
    expect(updateBinds).toEqual([
      "10:00",
      "12:00",
      JSON.stringify(["40m", "20m"]),
      JSON.stringify(["SSB", "CW"]),
      "Updated trailhead plan.",
      expect.any(String),
      "stop-1",
      "activate-ri-2026",
      "activate-ri-2026",
      expectedHash,
    ]);
    expect(JSON.stringify(updateBinds)).not.toContain(token);
  });

  it("cancels approved stops through a hashed edit token", async () => {
    const testEnv = env();
    testEnv.DB = editDb();
    const token = "magic-token";

    const response = await handleActivateRiApi(
      post(`/api/activate-ri-2026/edit/${token}/stops/stop-1/cancel`, {
        cancelReason: "Weather.",
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const statements = vi.mocked(testEnv.DB.prepare).mock.results.map(
      (result) => result.value as { bind: { mock: { calls: unknown[][] } } },
    );
    const cancelBinds = statements[1].bind.mock.calls[0];
    const expectedHash = await sha256Hex(token);
    expect(cancelBinds).toEqual([
      expect.any(String),
      "Weather.",
      expect.any(String),
      "stop-1",
      "activate-ri-2026",
      "activate-ri-2026",
      expectedHash,
    ]);
    expect(JSON.stringify(cancelBinds)).not.toContain(token);
  });

  it("allows cancellation without a JSON body", async () => {
    const testEnv = env();
    testEnv.DB = editDb();

    const response = await handleActivateRiApi(
      new Request(
        "https://ripota.org/api/activate-ri-2026/edit/token/stops/stop-1/cancel",
        { method: "POST" },
      ),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects invalid edit stop payload shapes", async () => {
    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: 10,
        endTime: "12:00",
        bands: ["40m", 20],
        modes: ["SSB"],
        publicNotes: null,
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: [
        "Enter startTime as text.",
        "Enter publicNotes as text.",
        "Enter bands as a list of text values.",
      ],
    });
  });

  it("returns JSON errors for malformed edit JSON", async () => {
    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", "{not-json"),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Expected valid JSON."],
    });
  });

  it("returns JSON errors for unsupported edit content types", async () => {
    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", "hello", {
        "content-type": "text/plain",
      }),
      env(),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Expected application/json."],
    });
  });

  it("returns 404 for edit tokens or stops that do not match", async () => {
    const testEnv = env();
    testEnv.DB = editDb({ routeStatus: null });

    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/wrong-token/stops/stop-1", {
        startTime: "10:00",
        endTime: "12:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "",
      }),
      testEnv,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Stop not found",
    });
  });

  it("returns 409 for edit tokens belonging to non-approved routes", async () => {
    const testEnv = env();
    testEnv.DB = editDb({ routeStatus: "pending" });

    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: "10:00",
        endTime: "12:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "",
      }),
      testEnv,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Route is not approved",
    });
  });

  it("does not report edit success when no stop row changes", async () => {
    const testEnv = env();
    testEnv.DB = editDb({ changes: 0 });

    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: "10:00",
        endTime: "12:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "",
      }),
      testEnv,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Stop not found",
    });
  });
});
