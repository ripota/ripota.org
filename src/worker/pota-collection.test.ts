import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { runPotaCollection } from "./pota-collection";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let close: (() => void) | undefined;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { close?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function environment(): Env {
  const database = createMigratedSqliteD1();
  close = database.close;
  return { DB: database.DB, ACTIVATE_RI_EVENT_ID: "activate-ri-2026", ASSETS: {} as Fetcher };
}
function scheduled(value: string): ScheduledController {
  return { scheduledTime: Date.parse(value), cron: "* * * * *", noRetry() {} } as ScheduledController;
}

describe("durable POTA collection health", () => {
  it("distinguishes a successful zero-report fetch and preserves actual clocks after a delayed invocation", async () => {
    const env = environment();
    const controller = scheduled("2026-09-22T12:00:00Z");
    const actualStart = Date.parse("2026-09-22T12:05:00Z");
    let time = actualStart;
    vi.stubGlobal("fetch", vi.fn(async () => { time += 2_000; return Response.json([]); }));
    await runPotaCollection(controller, env, { now: () => new Date(time) });
    expect(await env.DB.prepare(
      `SELECT scheduled_at, started_at, finished_at, status, source_fetched_at, stale,
        live_report_count, error_category FROM activate_ri_pota_collection_runs`,
    ).first()).toEqual({
      scheduled_at: controller.scheduledTime, started_at: actualStart, finished_at: actualStart + 2_000,
      status: "success", source_fetched_at: actualStart + 2_000, stale: 0,
      live_report_count: 0, error_category: null,
    });
  });

  it("records unavailable collection with a null report count instead of a successful empty feed", async () => {
    const env = environment();
    const controller = scheduled("2026-09-22T12:00:00Z");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await runPotaCollection(controller, env, { now: () => new Date(controller.scheduledTime) });
    expect(await env.DB.prepare(
      "SELECT status, live_report_count, source_fetched_at, error_category FROM activate_ri_pota_collection_runs",
    ).first()).toEqual({ status: "failed", live_report_count: null, source_fetched_at: null, error_category: "live_unavailable" });
  });

  it("retains source fetch time when an upstream failure causes stale cache reuse", async () => {
    const env = environment();
    const first = scheduled("2026-09-22T12:00:00Z");
    const second = scheduled("2026-09-22T12:02:00Z");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 })));
    await runPotaCollection(first, env, { now: () => new Date(first.scheduledTime) });
    await runPotaCollection(second, env, { now: () => new Date(second.scheduledTime) });
    expect((await env.DB.prepare(
      "SELECT status, source_fetched_at, stale, live_report_count FROM activate_ri_pota_collection_runs ORDER BY started_at",
    ).all()).results).toEqual([
      { status: "success", source_fetched_at: first.scheduledTime, stale: 0, live_report_count: 0 },
      { status: "partial", source_fetched_at: first.scheduledTime, stale: 1, live_report_count: 0 },
    ]);
  });

  it("continues official history collection despite live-feed failure", async () => {
    const env = environment();
    const controller = scheduled("2026-09-12T12:00:00Z");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/spot/activator")
      ? new Response("unavailable", { status: 503 }) : Response.json([])));
    await runPotaCollection(controller, env, { now: () => new Date(controller.scheduledTime) });
    expect(await env.DB.prepare(
      `SELECT status, live_report_count, reconciliation_attempted, reconciliation_succeeded, error_category
       FROM activate_ri_pota_collection_runs`,
    ).first()).toEqual({ status: "partial", live_report_count: null,
      reconciliation_attempted: 20, reconciliation_succeeded: 20, error_category: "live_unavailable" });
  });
});
