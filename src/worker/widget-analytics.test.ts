import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordWidgetRequest, captureWidgetRequest } from "./widget-analytics";
import { createMigratedSqliteD1 } from "./test-utils/sqlite-d1";

let database: ReturnType<typeof createMigratedSqliteD1>;
beforeEach(() => { database = createMigratedSqliteD1(); });
afterEach(() => { database.close(); vi.restoreAllMocks(); });

describe("widget analytics", () => {
  it("groups requests by UTC day, embedder, and action, preserving timestamp bounds", async () => {
    const writeDataPoint = vi.fn();
    const env = { DB: database.DB, ANALYTICS: { writeDataPoint } };
    await recordWidgetRequest(env, "K1NW", "load", "2027-01-01T23:59:00.000Z");
    await recordWidgetRequest(env, "K1NW", "load", "2027-01-01T23:58:00.000Z");
    await recordWidgetRequest(env, "K1NW", "load", "2027-01-02T00:00:00.000Z");
    await recordWidgetRequest(env, "generic", "refresh", "2027-01-02T00:00:00.000Z");
    const rows = (await database.DB.prepare("SELECT * FROM analytics_widget_daily ORDER BY day, embedder").all()).results;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ day: "2027-01-01", scope: "on-air", embedder: "K1NW", action: "load", count: 2,
      first_seen_at: "2027-01-01T23:58:00.000Z", last_seen_at: "2027-01-01T23:59:00.000Z" });
    expect(rows[1]).toMatchObject({ day: "2027-01-02", embedder: "K1NW", count: 1 });
    expect(rows[2]).toMatchObject({ embedder: "generic", action: "refresh", count: 1 });
    expect(writeDataPoint).toHaveBeenCalledTimes(4);
    expect(writeDataPoint.mock.calls[0]![0]).toMatchObject({ indexes: ["widget:on-air:K1NW"], doubles: [1] });
    expect(writeDataPoint.mock.calls[0]![0].blobs.slice(0, 5)).toEqual(["on-air", "widget_request", "widget", "on_air_widget", "load"]);
    expect(writeDataPoint.mock.calls[0]![0].blobs[11]).toBe("K1NW");
    expect(await database.DB.prepare("SELECT started_at FROM analytics_collection_metadata WHERE stream = 'widget_requests'").first())
      .toEqual({ started_at: "2027-01-01T23:58:00.000Z" });
  });

  it("preserves D1 totals if the optional mirror fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordWidgetRequest({ DB: database.DB, ANALYTICS: { writeDataPoint() { throw new Error("Unavailable"); } } },
      "K1NW", "click", "2027-01-01T00:00:00.000Z");
    expect(await database.DB.prepare("SELECT count FROM analytics_widget_daily").first()).toEqual({ count: 1 });
    expect(error).toHaveBeenCalledWith(JSON.stringify({ event: "widget-analytics-mirror-failed", scope: "on-air" }));
  });

  it("registers background work with the execution context and respects read-only development", async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } } as ExecutionContext;
    const request = new Request("https://ripota.org/embed/on-air/");
    await captureWidgetRequest(request, { DB: database.DB }, ctx, "generic", "load", "2027-01-01T00:00:00.000Z");
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    await captureWidgetRequest(request, { DB: database.DB, REMOTE_DATA_READ_ONLY: "true" }, ctx, "generic", "load", "2027-01-01T00:00:00.000Z");
    expect(pending).toHaveLength(1);
    expect(await database.DB.prepare("SELECT count FROM analytics_widget_daily").first()).toEqual({ count: 1 });
  });
});
