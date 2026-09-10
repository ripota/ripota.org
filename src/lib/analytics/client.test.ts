import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privacySignalEnabled, trackAnalyticsEvent } from "./client";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal("navigator", { doNotTrack: null, globalPrivacyControl: false });
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("analytics client", () => {
  it("reuses a random event-scoped subject without sending credentials", async () => {
    await trackAnalyticsEvent("activate-ri-2026", "hunter_import_attempted", {
      importMethod: "file_picker",
    });
    await trackAnalyticsEvent("activate-ri-2026", "hunter_import_succeeded", {
      importMethod: "file_picker",
    });

    const calls = vi.mocked(fetch).mock.calls;
    const first = JSON.parse(String(calls[0]![1]?.body));
    const second = JSON.parse(String(calls[1]![1]?.body));
    expect(first.anonymousId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.anonymousId).toBe(first.anonymousId);
    expect(first.schemaVersion).toBe(2);
    expect(first.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.eventId).not.toBe(second.eventId);
    expect(calls[0]![1]).toMatchObject({
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  });

  it.each([
    [{ globalPrivacyControl: true, doNotTrack: null }, "Global Privacy Control"],
    [{ globalPrivacyControl: false, doNotTrack: "1" }, "Do Not Track"],
  ])("does not create an identifier or request when %s is enabled", async (privacyNavigator, _label) => {
    vi.stubGlobal("navigator", privacyNavigator);

    await trackAnalyticsEvent("activate-ri-2026", "volunteer_form_started");

    expect(privacySignalEnabled()).toBe(true);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not surface collection failures to the feature", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const tracking = trackAnalyticsEvent(
      "activate-ri-2026",
      "volunteer_form_started",
    );
    await vi.runAllTimersAsync();
    await expect(tracking).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a transient rejection once with the exact original event", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    const tracking = trackAnalyticsEvent("activate-ri-2026", "hunter_progress_changed", { direction: "hunted", completedCount: 1, totalCount: 61 });
    await vi.runAllTimersAsync();
    await tracking;
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]![1]?.body).toBe(calls[0]![1]?.body);
  });

  it("reports permanent rejection without retrying or exposing event values", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 400 }));
    await trackAnalyticsEvent("activate-ri-2026", "volunteer_form_started");
    expect(fetch).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("Anonymous analytics event rejected", 400);
  });

  it("honors the rate-limit cooldown and checks opt-out again before retry", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "60" } }));
    const tracking = trackAnalyticsEvent("activate-ri-2026", "volunteer_form_started");
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetch).toHaveBeenCalledOnce();
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    await vi.advanceTimersByTimeAsync(1_000);
    await tracking;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not run anonymous collection on authenticated application paths", async () => {
    vi.stubGlobal("location", { pathname: "/activate-ri-2026/activator/" });

    await trackAnalyticsEvent("activate-ri-2026", "map_action", {
      action: "open_popup",
    });

    expect(fetch).not.toHaveBeenCalled();
  });
});
