import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { runActivateRiPotaSchedule } from "./index";
import { handleActivateRiApi } from "./routes/activate-ri";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
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
  it.each([
    "2025-09-11T12:00:00Z",
    "2026-09-09T23:59:59Z",
    "2026-10-14T00:00:00Z",
    "2027-09-11T12:00:00Z",
  ])("does no database or upstream work outside the 2026 collection window: %s", async (value) => {
    const prepare = vi.fn();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await runActivateRiPotaSchedule(
      { scheduledTime: Date.parse(value), cron: "* * * * *", noRetry() {} } as ScheduledController,
      { DB: { prepare } as unknown as D1Database, ACTIVATE_RI_EVENT_ID: "activate-ri-2026" } as Env,
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function testEnv(DB: D1Database): Env {
  return {
    DB,
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    ALLOW_ADMIN_HEADER_AUTH: "true",
    SITE_ORIGIN: "https://ripota.org",
  };
}
