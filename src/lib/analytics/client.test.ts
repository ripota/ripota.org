import { beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    await expect(trackAnalyticsEvent(
      "activate-ri-2026",
      "volunteer_form_started",
    )).resolves.toBeUndefined();
  });

  it("does not run anonymous collection on authenticated application paths", async () => {
    vi.stubGlobal("location", { pathname: "/activate-ri-2026/activator/" });

    await trackAnalyticsEvent("activate-ri-2026", "map_action", {
      action: "open_popup",
    });

    expect(fetch).not.toHaveBeenCalled();
  });
});
