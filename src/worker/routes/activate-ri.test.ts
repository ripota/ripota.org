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
  planRows?: unknown[];
  stopRows?: unknown[];
  publicStopRows?: unknown[];
  clubRows?: unknown[];
  activityRows?: unknown[];
  planStatus?: string | null;
  planUpdateChanges?: number;
};

const pendingPlanRow = {
  id: "plan-1",
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
  plan_id: "plan-1",
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

const pendingPlanDto = {
  ...pendingPlanRow,
  stops: [
    {
      id: "stop-1",
      plan_id: "plan-1",
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

const publicStopRow = {
  id: "stop-public-1",
  park_reference: "US-2868",
  planned_date: "2026-09-11",
  start_time: "09:00",
  end_time: "11:00",
  submitter_callsign: "N1RWJ",
  bands_json: '["40m","20m"]',
  modes_json: '["SSB","CW"]',
  public_notes: "Meet near the trailhead.",
  status: "scheduled",
};

const activityRow = {
  id: "event-1",
  event_id: "activate-ri-2026",
  plan_id: "plan-1",
  stop_id: null,
  actor_type: "activator",
  actor_email: "rob@example.com",
  action: "plan-created",
  summary: "N1RWJ submitted 1 activation stop.",
  details_json: '{"stopCount":1}',
  created_at: "2026-06-16T12:00:00.000Z",
};

function adminDb(options: AdminDbOptions = {}): D1Database {
  const batch = vi.fn(async (statements: unknown[]) =>
    statements.map((_, index) => ({
      success: true,
      meta: { changes: index === 0 ? (options.planUpdateChanges ?? 1) : 1 },
    })),
  );
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => ({
        success: true,
        meta: { changes: options.planUpdateChanges ?? 1 },
      })),
      all: vi.fn(async () => ({
        results: sql.includes("FROM activate_ri_activity_events")
          ? (options.activityRows ?? [activityRow])
          : sql.includes("AS club") && sql.includes("activate_ri_activators")
          ? (options.clubRows ?? [
              { club: "Rhode Island POTA" },
              { club: "Fidelity Amateur Radio Club" },
            ])
          : sql.includes("INNER JOIN activate_ri_plans r")
          ? (options.publicStopRows ?? [publicStopRow])
          : sql.includes("FROM activate_ri_stops")
            ? (options.stopRows ?? [pendingStopRow])
            : (options.planRows ?? [pendingPlanRow]),
      })),
      first: vi.fn(async () => {
        if (options.planStatus === undefined) {
          return { status: "pending" };
        }

        if (options.planStatus === null) {
          return null;
        }

        return { status: options.planStatus };
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
  planStatus?: string | null;
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
        if (!sql.includes("INNER JOIN activate_ri_plans")) {
          return null;
        }

        if (options.planStatus === null) {
          return null;
        }

        return { status: options.planStatus ?? "approved" };
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

  it("accepts valid plan submissions for organizer review", async () => {
    const testEnv = env();
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/plans", validPayload()),
      testEnv,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "Submission received for organizer review.",
    });
    expect(testEnv.DB.batch).toHaveBeenCalledTimes(2);
    const insertStatements = vi.mocked(testEnv.DB.batch).mock.calls[0][0];
    expect(insertStatements).toHaveLength(4);
  });

  it("returns validation errors for invalid plan submissions", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/plans", {
        submitterCallsign: "not a call sign!",
        submitterName: "",
        submitterEmail: "not-email",
        stops: [],
      }),
      turnstileEnv(),
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
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns validation errors for non-object JSON payloads", async () => {
    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/plans", null),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Enter a valid plan submission."],
    });
  });

  it("returns JSON errors for unsupported content types", async () => {
    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/plans", {
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
      new Request("https://ripota.org/api/activate-ri-2026/plans", {
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
      post("/api/activate-ri-2026/plans", validPayload()),
      turnstileEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Turnstile verification failed."],
    });
  });

  it("fails closed when the Turnstile required binding is missing", async () => {
    const testEnv = env();
    delete testEnv.TURNSTILE_REQUIRED;

    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/plans", validPayload()),
      testEnv,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Turnstile verification failed."],
    });
    expect(testEnv.DB.batch).not.toHaveBeenCalled();
  });

  it("returns sanitized JSON errors when Turnstile verification is unsuccessful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: false })),
    );

    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/plans", validPayloadWithTurnstile()),
      turnstileEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Turnstile verification failed."],
    });
  });

  it("accepts plan submissions after successful Turnstile verification", async () => {
    const fetch = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetch);

    const testEnv = turnstileEnv();
    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/plans", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify(validPayloadWithTurnstile()),
      }),
      testEnv,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "Submission received for organizer review.",
    });
    expect(testEnv.DB.batch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();

    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { method: string; body: FormData },
    ];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(init.method).toBe("POST");
    expect(init.body.get("secret")).toBe("test-secret");
    expect(init.body.get("response")).toBe("test-token");
    expect(init.body.get("remoteip")).toBe("203.0.113.10");
  });

  it("returns sanitized JSON errors when Turnstile verification cannot be parsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );

    const response = await handleActivateRiApi(
      post("/api/activate-ri-2026/plans", validPayloadWithTurnstile()),
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
      post("/api/activate-ri-2026/plans", validPayloadWithTurnstile()),
      turnstileEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Turnstile verification failed."],
    });
  });

  it("returns JSON 404 for unknown Activate RI API plans", async () => {
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

  it("requires Cloudflare Access identity for admin plans", async () => {
    const listResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans"),
      env(),
    );
    const publishResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/publish", {
        method: "POST",
      }),
      env(),
    );
    const approveResponse = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans/plan-1/approve", {
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
    expect(publishResponse.status).toBe(401);
    await expect(publishResponse.json()).resolves.toEqual({
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
      adminRequest("/api/activate-ri-2026/admin/plans", {
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      plans: [pendingPlanDto],
    });
  });

  it("rejects spoofed admin email headers without Access config or local bypass", async () => {
    const testEnv = env();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans", {
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
      adminRequest("/api/activate-ri-2026/admin/plans", {
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

  it("lists pending plans with stops for authenticated admins without exposing edit tokens", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans", {
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    const body = await response.json() as { plans: typeof pendingPlanDto[] };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      plans: [pendingPlanDto],
    });
    expect(body.plans[0].stops[0]).toMatchObject({
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

  it("exports public publish rows for authenticated admins", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/publish", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    const body = await response.json() as { generatedAt: string; rows: unknown[] };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      generatedAt: expect.any(String),
      rows: [publicStopRow],
    });
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
    expect(JSON.stringify(body)).not.toMatch(
      /submitter_email|submitter_phone|edit_token_hash|approval_operation_id|organizer_notes|audit|log/i,
    );

    const statement = vi.mocked(testEnv.DB.prepare).mock.results[0].value as {
      bind: { mock: { calls: unknown[][] } };
    };
    expect(statement.bind.mock.calls[0]).toEqual([
      "activate-ri-2026",
      "activate-ri-2026",
    ]);

    const preparedSql = vi.mocked(testEnv.DB.prepare).mock.calls
      .map(([sql]) => sql)
      .join("\n");
    expect(preparedSql).toContain("INNER JOIN activate_ri_plans r");
    expect(preparedSql).toContain("r.status = 'approved'");
    expect(preparedSql).toContain(
      "s.status IN ('scheduled', 'delayed', 'cancelled', 'completed')",
    );
    expect(preparedSql).toContain("s.event_id = ?");
    expect(preparedSql).toContain("r.event_id = ?");
    expect(preparedSql).not.toContain("SELECT *");
    expect(preparedSql).not.toMatch(
      /submitter_email|submitter_phone|edit_token_hash|approval_operation_id|organizer_notes|activate_ri_audit_events|raw_logs/i,
    );
  });

  it("returns public live stops without private plan fields", async () => {
    const testEnv = env();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/public/stops"),
      testEnv,
    );

    const body = await response.json() as { stops: unknown[] };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    );
    expect(body).toEqual({
      ok: true,
      generatedAt: expect.any(String),
      stops: [
        {
          id: "stop-public-1",
          parkReference: "US-2868",
          plannedDate: "2026-09-11",
          startTime: "09:00",
          endTime: "11:00",
          activatorCallsign: "N1RWJ",
          bands: ["40m", "20m"],
          modes: ["SSB", "CW"],
          publicNotes: "Meet near the trailhead.",
          status: "scheduled",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/submitter_email|edit_token_hash|organizer_notes/i);
  });

  it("returns public club suggestions without private activator fields", async () => {
    const testEnv = env();
    testEnv.DB = adminDb({
      clubRows: [
        { club: "Fidelity Amateur Radio Club" },
        { club: "Rhode Island POTA" },
      ],
    });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/public/clubs"),
      testEnv,
    );

    const body = await response.json() as { clubs: unknown[] };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    );
    expect(body).toEqual({
      ok: true,
      clubs: ["Fidelity Amateur Radio Club", "Rhode Island POTA"],
    });
    expect(JSON.stringify(body)).not.toMatch(
      /email|callsign|phone|edit_token_hash|organizer_notes/i,
    );

    const preparedSql = vi.mocked(testEnv.DB.prepare).mock.calls
      .map(([sql]) => sql)
      .join("\n");
    expect(preparedSql).toContain("activate_ri_activators");
    expect(preparedSql).not.toContain("SELECT *");
  });

  it("stores public live stops in the Worker cache on a cache miss", async () => {
    const testEnv = env();
    testEnv.DB = adminDb();
    const put = vi.fn(async () => undefined);
    const match = vi.fn(async () => undefined);
    vi.stubGlobal("caches", {
      default: { match, put },
    });
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/public/stops"),
      testEnv,
      { waitUntil } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    );
    expect(match).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(testEnv.DB.prepare).toHaveBeenCalledOnce();
  });

  it("returns cached public live stops without querying D1", async () => {
    const testEnv = env();
    const cachedBody = {
      ok: true,
      generatedAt: "2026-06-17T12:00:00.000Z",
      stops: [],
    };
    const cachedResponse = new Response(JSON.stringify(cachedBody), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      },
    });
    const put = vi.fn(async () => undefined);
    const match = vi.fn(async () => cachedResponse);
    vi.stubGlobal("caches", {
      default: { match, put },
    });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/public/stops"),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(cachedBody);
    expect(match).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
    expect(testEnv.DB.prepare).not.toHaveBeenCalled();
  });

  it("lists admin activity events for authenticated admins", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb();

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/activity", {
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      events: [
        {
          id: "event-1",
          event_id: "activate-ri-2026",
          plan_id: "plan-1",
          stop_id: null,
          actor_type: "activator",
          actor_email: "rob@example.com",
          action: "plan-created",
          summary: "N1RWJ submitted 1 activation stop.",
          details: { stopCount: 1 },
          created_at: "2026-06-16T12:00:00.000Z",
        },
      ],
    });
  });

  it("approves pending plans for authenticated admins", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb({ planStatus: "pending", planUpdateChanges: 1 });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans/plan-1/approve", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean };
    expect(body).toEqual({
      ok: true,
    });
    expect(JSON.stringify(body)).not.toContain("edit_token_hash");
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
    const planUpdateSql = prepareCalls[1][0];
    const stopUpdateSql = prepareCalls[2][0];
    const auditInsertSql = prepareCalls[3][0];
    expect(planUpdateSql).toContain("UPDATE activate_ri_plans");
    expect(planUpdateSql).toContain("approval_operation_id = ?");
    expect(stopUpdateSql).toContain("UPDATE activate_ri_stops");
    expect(stopUpdateSql).toContain("AND approval_operation_id = ?");
    expect(stopUpdateSql).not.toContain("AND approved_at = ?");
    expect(stopUpdateSql).not.toContain("AND approved_by = ?");
    expect(auditInsertSql).toContain("INSERT INTO activate_ri_activity_events");
    expect(auditInsertSql).not.toContain("AND approved_at = ?");
    expect(auditInsertSql).not.toContain("AND approved_by = ?");

    const batchStatements = vi.mocked(testEnv.DB.batch).mock
      .calls[0][0] as unknown as Array<{
      bind: { mock: { calls: unknown[][] } };
    }>;
    const planUpdateBinds = batchStatements[0].bind.mock.calls[0];
    const stopUpdateBinds = batchStatements[1].bind.mock.calls[0];
    const auditInsertBinds = batchStatements[2].bind.mock.calls[0];
    const approvalOperationId = planUpdateBinds[2];
    expect(typeof approvalOperationId).toBe("string");
    expect(stopUpdateBinds.at(-1)).toBe(approvalOperationId);
    expect(auditInsertBinds[6]).toBe("plan-approved");
    expect(String(auditInsertBinds[8])).toContain(String(approvalOperationId));
  });

  it("returns 409 without scheduling stops or audit when the plan transition loses a race", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb({ planStatus: "pending", planUpdateChanges: 0 });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans/plan-1/approve", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: "Plan is not pending",
    });
    expect(JSON.stringify(body)).not.toContain("editUrl");
    expect(JSON.stringify(body)).not.toContain("edit_token_hash");
    expect(testEnv.DB.batch).toHaveBeenCalledOnce();
    const prepareCalls = vi.mocked(testEnv.DB.prepare).mock.calls;
    const planUpdateSql = prepareCalls[1][0];
    const stopUpdateSql = prepareCalls[2][0];
    const auditInsertSql = prepareCalls[3][0];
    expect(planUpdateSql).toContain("approval_operation_id = ?");
    expect(stopUpdateSql).toContain("AND approval_operation_id = ?");
    expect(stopUpdateSql).not.toContain("AND approved_at = ?");
    expect(stopUpdateSql).not.toContain("AND approved_by = ?");
    expect(auditInsertSql).toContain("INSERT INTO activate_ri_activity_events");
    expect(auditInsertSql).not.toContain("AND approved_at = ?");
    expect(auditInsertSql).not.toContain("AND approved_by = ?");

    const batchStatements = vi.mocked(testEnv.DB.batch).mock
      .calls[0][0] as unknown as Array<{
      bind: { mock: { calls: unknown[][] } };
    }>;
    const planUpdateBinds = batchStatements[0].bind.mock.calls[0];
    const stopUpdateBinds = batchStatements[1].bind.mock.calls[0];
    const auditInsertBinds = batchStatements[2].bind.mock.calls[0];
    const approvalOperationId = planUpdateBinds[2];
    expect(stopUpdateBinds.at(-1)).toBe(approvalOperationId);
    expect(auditInsertBinds[6]).toBe("plan-approved");
    expect(String(auditInsertBinds[8])).toContain(String(approvalOperationId));
  });

  it("returns 404 for missing plan approvals without scheduling stops or audit", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb({ planStatus: null });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans/missing-plan/approve", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: "Plan not found",
    });
    expect(JSON.stringify(body)).not.toContain("editUrl");
    expect(JSON.stringify(body)).not.toContain("edit_token_hash");
    expect(testEnv.DB.batch).not.toHaveBeenCalled();
  });

  it("returns 409 for wrong-status plan approvals without scheduling stops or audit", async () => {
    const testEnv = adminEnv();
    testEnv.DB = adminDb({ planStatus: "approved" });

    const response = await handleActivateRiApi(
      adminRequest("/api/activate-ri-2026/admin/plans/plan-1/approve", {
        method: "POST",
        headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
      }),
      testEnv,
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: "Plan is not pending",
    });
    expect(JSON.stringify(body)).not.toContain("editUrl");
    expect(JSON.stringify(body)).not.toContain("edit_token_hash");
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
      expect.stringContaining("a.magic_token_hash = ?"),
    );
    expect(testEnv.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE activate_ri_stops"),
    );

    const statements = vi.mocked(testEnv.DB.prepare).mock.results.map(
      (result) => result.value as { bind: { mock: { calls: unknown[][] } } },
    );
    const planLookupBinds = statements[0].bind.mock.calls[0];
    const updateBinds = statements[1].bind.mock.calls[0];
    const expectedHash = await sha256Hex(token);
    expect(planLookupBinds).toEqual([
      "stop-1",
      "activate-ri-2026",
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
        "Enter bands as a list of text values.",
        "Enter startTime in HH:MM 24-hour format.",
      ],
    });
  });

  it("rejects edit stop time formats outside HH:MM 24-hour format", async () => {
    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: "9:00",
        endTime: "24:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "",
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: [
        "Enter startTime in HH:MM 24-hour format.",
        "Enter endTime in HH:MM 24-hour format.",
      ],
    });
  });

  it("rejects edit stop end times that are not after start times", async () => {
    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: "12:00",
        endTime: "12:00",
        bands: ["40m"],
        modes: ["SSB"],
        publicNotes: "",
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Enter endTime after startTime."],
    });
  });

  it("rejects edit stop payloads without bands after trimming", async () => {
    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: "10:00",
        endTime: "12:00",
        bands: ["  "],
        modes: ["SSB"],
        publicNotes: "",
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Enter at least one band."],
    });
  });

  it("rejects edit stop payloads without modes after trimming", async () => {
    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: "10:00",
        endTime: "12:00",
        bands: ["40m"],
        modes: ["  "],
        publicNotes: "",
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: ["Enter at least one mode."],
    });
  });

  it("rejects edit stop payloads with unsupported bands or modes", async () => {
    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: "10:00",
        endTime: "12:00",
        bands: ["40m", "11m"],
        modes: ["SSB", "AM"],
        publicNotes: "",
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      errors: [
        "Bands must use supported bands: 160m, 80m, 60m, 40m, 30m, 20m, 17m, 15m, 12m, 10m, 6m, 2m, 70cm.",
        "Modes must use supported modes: SSB, CW, Digital.",
      ],
    });
  });

  it("normalizes whitespace in valid edit stop payloads before updating", async () => {
    const testEnv = env();
    testEnv.DB = editDb();

    const response = await handleActivateRiApi(
      patch("/api/activate-ri-2026/edit/token/stops/stop-1", {
        startTime: " 10:00 ",
        endTime: " 12:00 ",
        bands: [" 40m ", " "],
        modes: [" ssb ", "cw", "digital"],
        publicNotes: " Updated trailhead plan. ",
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const statements = vi.mocked(testEnv.DB.prepare).mock.results.map(
      (result) => result.value as { bind: { mock: { calls: unknown[][] } } },
    );
    const updateBinds = statements[1].bind.mock.calls[0];
    expect(updateBinds.slice(0, 5)).toEqual([
      "10:00",
      "12:00",
      JSON.stringify(["40m"]),
      JSON.stringify(["SSB", "CW", "Digital"]),
      "Updated trailhead plan.",
    ]);
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
    testEnv.DB = editDb({ planStatus: null });

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

  it("returns 409 for edit tokens belonging to non-approved plans", async () => {
    const testEnv = env();
    testEnv.DB = editDb({ planStatus: "pending" });

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
      error: "Plan is not approved",
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
