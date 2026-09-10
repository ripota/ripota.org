import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import worker from "./index";
import { captureFeatureUsage } from "./feature-usage";
import { observeWorkerTask, recordOperationalFailure } from "./operational-health";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let close: (() => void) | undefined;
afterEach(() => { close?.(); close = undefined; vi.restoreAllMocks(); });
function environment(response: Response | Error = new Response("ok")): Env {
  const db = createMigratedSqliteD1();
  close = db.close;
  return {
    DB: db.DB, ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    ASSETS: { fetch: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }) } as unknown as Fetcher,
  };
}

describe("operational health aggregates", () => {
  it("groups observed failures by UTC date and fixed category, including out-of-order writes", async () => {
    const env = environment();
    await recordOperationalFailure(env, "browser_error", new Date("2026-09-11T23:59:59Z"));
    await recordOperationalFailure(env, "browser_error", new Date("2026-09-11T23:50:00Z"));
    await recordOperationalFailure(env, "browser_error", new Date("2026-09-12T00:00:00Z"));
    expect((await env.DB.prepare("SELECT * FROM operational_health_daily ORDER BY day").all()).results).toEqual([
      { scope: "activate-ri-2026", day: "2026-09-11", category: "browser_error", count: 2,
        first_seen_at: "2026-09-11T23:50:00.000Z", last_seen_at: "2026-09-11T23:59:59.000Z" },
      { scope: "activate-ri-2026", day: "2026-09-12", category: "browser_error", count: 1,
        first_seen_at: "2026-09-12T00:00:00.000Z", last_seen_at: "2026-09-12T00:00:00.000Z" },
    ]);
  });

  it("preserves a failed Worker route's original exception and retains no request/error details", async () => {
    const failure = new Error("private@example.com token=secret");
    const env = environment(failure);
    await expect(worker.fetch(new Request("https://ripota.org/?token=private"), env)).rejects.toBe(failure);
    const rows = (await env.DB.prepare("SELECT * FROM operational_health_daily").all()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "worker_exception", count: 1 });
    expect(JSON.stringify(rows)).not.toMatch(/private|token|secret|ripota\.org/);
  });

  it("counts unexpected 500 responses without changing them", async () => {
    const response = new Response("failed", { status: 500, headers: { "x-request-test": "preserved" } });
    const env = environment(response);
    expect(await worker.fetch(new Request("https://ripota.org/"), env)).toBe(response);
    expect(await env.DB.prepare("SELECT category, count FROM operational_health_daily").first())
      .toEqual({ category: "worker_response_5xx", count: 1 });
  });

  it("does not count expected client/auth responses or deliberate unavailable states as incidents", async () => {
    const env = environment();
    for (const status of [400, 401, 403, 404, 409, 429, 503]) {
      vi.mocked(env.ASSETS.fetch).mockResolvedValueOnce(new Response(null, { status }));
      expect((await worker.fetch(new Request("https://ripota.org/"), env)).status).toBe(status);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_health_daily").first()).toEqual({ count: 0 });
  });

  it("retains scheduled failures while preserving rejection and ignoring diagnostic-store failures", async () => {
    const env = environment();
    const failure = new Error("scheduled task failed");
    await expect(observeWorkerTask(env, "scheduled_archive", Promise.reject(failure))).rejects.toBe(failure);
    expect(await env.DB.prepare("SELECT category, count FROM operational_health_daily").first())
      .toEqual({ category: "scheduled_archive", count: 1 });
    vi.spyOn(env.DB, "prepare").mockImplementation(() => { throw new Error("D1 unavailable"); });
    await expect(observeWorkerTask(env, "scheduled_archive", Promise.reject(failure))).rejects.toBe(failure);
    await expect(recordOperationalFailure(env, "browser_error")).resolves.toBeUndefined();
  });

  it("records lost private-feature facts without failing the requesting feature", async () => {
    const env = environment();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.prepare("DROP TABLE analytics_feature_events").run();
    await expect(captureFeatureUsage(env, undefined, {
      scope: "activate-ri-2026", subjectType: "activator", subjectId: "test-actor", feature: "plan_editor",
    })).resolves.toBeUndefined();
    expect(await env.DB.prepare("SELECT category, count FROM operational_health_daily").first())
      .toEqual({ category: "feature_analytics", count: 1 });
  });
});
