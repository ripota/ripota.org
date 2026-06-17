import { describe, expect, it, vi } from "vitest";
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
  it("returns API stops without requesting the static fallback", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, stops: [stop] }));

    await expect(fetchPublicActivationStops(fetcher)).resolves.toEqual([stop]);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/activate-ri-2026/public/stops", {
      headers: { accept: "application/json" },
    });
  });

  it("falls back to the static public stops export when the live API is unavailable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, stops: [stop] }));

    await expect(fetchPublicActivationStops(fetcher)).resolves.toEqual([stop]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("/data/activate-ri-2026/stops.json", {
      headers: { accept: "application/json" },
    });
  });

  it("throws when neither source returns a public stops response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse([], { status: 200 }));

    await expect(fetchPublicActivationStops(fetcher)).rejects.toThrow(
      "Public stops response was unavailable.",
    );
  });
});
