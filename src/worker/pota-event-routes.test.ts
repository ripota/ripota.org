import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { runActivateRiPotaSchedule, runPotaSpotCleanupSchedule } from "./index";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Activate RI POTA API routes", () => {
  it("serves an allowlisted persisted projection and protects organizer status", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);

    const publicResponse = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/public/park-status"),
      env,
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toContain("max-age=60");
    await expect(publicResponse.json()).resolves.toMatchObject({
      ok: true,
      eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
      summary: { total: 61, confirmed: 0 },
    });

    const unauthorized = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/admin/pota-status"),
      env,
    );
    expect(unauthorized.status).toBe(401);
  });

  it("serves public rolling spot activity without authentication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T15:00:00Z"));
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    await database.DB.prepare(
      `INSERT INTO pota_spot_observations (
        spot_key, source_spot_id, park_reference, park_name, activator_callsign,
        spot_time, first_observed_at, last_observed_at, reported_expires_at,
        frequency, mode, source_label
      ) VALUES ('42', '42', 'US-10542', 'Camp Cronin', 'K1NW', ?, ?, ?, ?, '14315', '', 'POTA')`,
    ).bind(
      "2026-09-03T14:45:00.000Z",
      Date.parse("2026-09-03T14:45:00Z"),
      Date.now(),
      Date.now() + 600_000,
    ).run();

    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/public/spot-activity"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scope: "recent",
      summary: { parks: 1, activators: 1, modes: 0, bands: 1, spots: 1 },
      parks: [{ reference: "US-10542", activators: ["K1NW"], bands: ["20m"] }],
    });
  });

  it("starts protected deep reconciliation and leaves work in scheduled batches", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    const pending: Promise<unknown>[] = [];
    const context = {
      waitUntil(promise: Promise<unknown>) { pending.push(promise); },
    } as ExecutionContext;
    const response = await handleActivateRiApi(new Request(
      "https://ripota.org/api/activate-ri-2026/admin/pota-reconcile",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://ripota.org",
          "Cf-Access-Authenticated-User-Email": "organizer@example.com",
        },
        body: JSON.stringify({ deep: true }),
      },
    ), env, context);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true, accepted: true, deep: true });
    await Promise.all(pending);
    const statusResponse = await handleActivateRiApi(new Request(
      "https://ripota.org/api/activate-ri-2026/admin/pota-status",
      { headers: { "Cf-Access-Authenticated-User-Email": "organizer@example.com" } },
    ), env);
    await expect(statusResponse.json()).resolves.toMatchObject({
      ok: true,
      status: { deepReconciliationPending: true },
    });
  });
});

describe("Activate RI POTA cron guards", () => {
  it("collects rolling spot history before the event without creating event evidence", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([upstreamSpot()])))
    const env = testEnv(database.DB);
    await runActivateRiPotaSchedule(
      scheduledController("2026-09-03T14:45:00Z"),
      env,
    );
    const rolling = await database.DB.prepare("SELECT COUNT(*) AS count FROM pota_spot_observations")
      .first<{ count: number }>();
    const event = await database.DB.prepare("SELECT COUNT(*) AS count FROM activate_ri_pota_spot_observations")
      .first<{ count: number }>();
    expect(rolling?.count).toBe(1);
    expect(event?.count).toBe(0);
  });

  it("runs rolling-history cleanup independently", async () => {
    const database = createMigratedSqliteD1();
    cleanup = database.close;
    const env = testEnv(database.DB);
    await database.DB.prepare(
      `INSERT INTO pota_spot_observations (
        spot_key, source_spot_id, park_reference, park_name, activator_callsign,
        spot_time, first_observed_at, last_observed_at
      ) VALUES ('1', '1', 'US-10542', 'Camp Cronin', 'K1NW', ?, 0, 0)`,
    ).bind("2026-08-01T12:00:00Z").run();

    await runPotaSpotCleanupSchedule(scheduledController("2026-09-03T05:17:00Z", "17 5 * * *"), env);

    const rolling = await database.DB.prepare("SELECT COUNT(*) AS count FROM pota_spot_observations")
      .first<{ count: number }>();
    expect(rolling?.count).toBe(0);
  });
});

function scheduledController(value: string, cron = "* * * * *"): ScheduledController {
  return { scheduledTime: Date.parse(value), cron, noRetry() {} } as ScheduledController;
}

function upstreamSpot(): Record<string, unknown> {
  return {
    spotId: 42,
    activator: "K1NW",
    frequency: "14315",
    mode: "",
    reference: "US-10542",
    name: "Camp Cronin Fishing Area",
    spotTime: "2026-09-03T14:45:00",
    spotter: "K1NW",
    comments: "",
    source: "POTA",
    invalid: null,
    expire: 600,
    locationDesc: "US-RI",
  };
}

function testEnv(DB: D1Database): Env {
  return {
    DB,
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    ALLOW_ADMIN_HEADER_AUTH: "true",
    SITE_ORIGIN: "https://ripota.org",
  };
}
