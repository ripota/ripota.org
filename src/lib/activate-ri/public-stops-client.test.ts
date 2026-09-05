import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicActivationStops } from "./public-stops-client";
import type { PublicActivationStop } from "./types";

const stop: PublicActivationStop = {
  id: "stop-1",
  parkReference: "US-2868",
  plannedDate: "2026-09-11",
  startTime: "09:00",
  endTime: "11:00",
  activatorCallsign: "N1RWJ",
  bands: ["20m"],
  modes: ["CW"],
  publicNotes: "",
  status: "scheduled",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("fetchPublicActivationStops", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns API stops without requesting the static fallback", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, stops: [stop] }));

    await expect(fetchPublicActivationStops(fetcher)).resolves.toEqual([stop]);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/activate-ri-2026/public/stops", {
      headers: { accept: "application/json" },
    });
  });

  it("accepts a genuinely empty live schedule without falling back", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, stops: [] }));

    await expect(fetchPublicActivationStops(fetcher)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { ok: true, stops: [], generatedAt: null },
    { ok: true, stops: [stop], generatedAt: "2026-09-04T12:00:00Z" },
  ])("does not substitute a static export for a production API outage: %j", async (snapshot) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(snapshot));

    await expect(fetchPublicActivationStops(fetcher)).rejects.toThrow(
      "Public stops response was unavailable.",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("uses a dated public stops export when Astro dev has no live API", async () => {
    vi.stubEnv("DEV", true);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, stops: [stop], generatedAt: "2026-09-04T12:00:00Z" }));

    await expect(fetchPublicActivationStops(fetcher)).resolves.toEqual([stop]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("/data/activate-ri-2026/stops.json", {
      headers: { accept: "application/json" },
    });
  });

  it.each([null, undefined, "", "not-a-date"])("rejects an undated or invalid local export in Astro dev: %s", async (generatedAt) => {
    vi.stubEnv("DEV", true);
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("No Worker API"))
      .mockResolvedValueOnce(jsonResponse({ ok: true, stops: [], generatedAt }));

    await expect(fetchPublicActivationStops(fetcher)).rejects.toThrow(
      "Public stops response was unavailable.",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws when neither source returns a public stops response", async () => {
    vi.stubEnv("DEV", true);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse([], { status: 200 }));

    await expect(fetchPublicActivationStops(fetcher)).rejects.toThrow(
      "Public stops response was unavailable.",
    );
  });
});
