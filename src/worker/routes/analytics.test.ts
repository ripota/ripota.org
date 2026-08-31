import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { handleAnalyticsEvent } from "./analytics";

const anonymousId = "45f073b5-e599-42c1-bc56-67b766bf284c";

function testEnv(): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    ANALYTICS: {
      writeDataPoint: vi.fn(),
    } as unknown as AnalyticsEngineDataset,
    ANALYTICS_HASH_KEY: "test-secret-that-is-not-used-in-production",
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    DB: { prepare: vi.fn() } as unknown as D1Database,
    SITE_ORIGIN: "https://ripota.org",
  };
}

function post(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("https://ripota.org/api/analytics/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://ripota.org",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("analytics event route", () => {
  it("writes a validated event without retaining the browser identifier", async () => {
    const env = testEnv();
    const response = await handleAnalyticsEvent(post({
      schemaVersion: 1,
      scope: "activate-ri-2026",
      name: "hunter_import_succeeded",
      anonymousId,
      properties: { importMethod: "drop" },
    }), env);

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(env.ANALYTICS?.writeDataPoint).toHaveBeenCalledOnce();
    const point = vi.mocked(env.ANALYTICS!.writeDataPoint).mock.calls[0]![0]!;
    expect(point.indexes?.[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(point.indexes).not.toContain(anonymousId);
    expect(point.blobs).toEqual([
      "activate-ri-2026",
      "hunter_import_succeeded",
      "anonymous",
      "",
      "",
      "",
      "",
      "",
      "",
      "drop",
      "1",
    ]);
    expect(point.doubles).toEqual([1]);
  });

  it("uses a stable scoped HMAC for the same browser identifier", async () => {
    const env = testEnv();
    await handleAnalyticsEvent(post({
      schemaVersion: 1,
      scope: "activate-ri-2026",
      name: "hunter_checklist_resumed",
      anonymousId,
    }), env);
    await handleAnalyticsEvent(post({
      schemaVersion: 1,
      scope: "activate-ri-2026",
      name: "volunteer_form_started",
      anonymousId,
    }), env);

    const calls = vi.mocked(env.ANALYTICS!.writeDataPoint).mock.calls;
    expect(calls[0]![0]!.indexes).toEqual(calls[1]![0]!.indexes);
  });

  it.each([
    ["unknown event", { schemaVersion: 1, scope: "activate-ri-2026", name: "page_view", anonymousId }],
    ["unknown scope", { schemaVersion: 1, scope: "other-event", name: "volunteer_form_started", anonymousId }],
    ["raw identifying property", { schemaVersion: 1, scope: "activate-ri-2026", name: "hunter_import_succeeded", anonymousId, properties: { callsign: "W1AW" } }],
    ["unapproved property value", { schemaVersion: 1, scope: "activate-ri-2026", name: "hunter_import_failed", anonymousId, properties: { errorCode: "contains-private-data" } }],
  ])("rejects %s", async (_label, body) => {
    const env = testEnv();
    const response = await handleAnalyticsEvent(post(body), env);

    expect(response.status).toBe(400);
    expect(env.ANALYTICS?.writeDataPoint).not.toHaveBeenCalled();
  });

  it("requires the configured same-origin caller", async () => {
    const env = testEnv();
    const response = await handleAnalyticsEvent(post({
      schemaVersion: 1,
      scope: "activate-ri-2026",
      name: "volunteer_form_started",
      anonymousId,
    }, { origin: "https://example.com" }), env);

    expect(response.status).toBe(403);
    expect(env.ANALYTICS?.writeDataPoint).not.toHaveBeenCalled();
  });

  it("fails closed when the dataset or hashing secret is unavailable", async () => {
    const env = testEnv();
    delete env.ANALYTICS_HASH_KEY;
    const response = await handleAnalyticsEvent(post({
      schemaVersion: 1,
      scope: "activate-ri-2026",
      name: "volunteer_form_started",
      anonymousId,
    }), env);

    expect(response.status).toBe(503);
    expect(env.ANALYTICS?.writeDataPoint).not.toHaveBeenCalled();
  });

  it("limits request size before parsing", async () => {
    const env = testEnv();
    const response = await handleAnalyticsEvent(post({ value: "x".repeat(5_000) }), env);

    expect(response.status).toBe(413);
    expect(env.ANALYTICS?.writeDataPoint).not.toHaveBeenCalled();
  });

  it("rate limits the anonymous collector before parsing", async () => {
    const env = testEnv();
    const limit = vi.fn().mockResolvedValue({ success: false });
    env.ANALYTICS_RATE_LIMIT = { limit } as unknown as RateLimit;
    const response = await handleAnalyticsEvent(post({ value: "ignored" }, {
      "CF-Connecting-IP": "192.0.2.1",
    }), env);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(limit).toHaveBeenCalledWith({ key: "analytics:192.0.2.1" });
    expect(env.ANALYTICS?.writeDataPoint).not.toHaveBeenCalled();
  });
});
