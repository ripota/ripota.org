import { describe, expect, it, vi } from "vitest";
import {
  fetchLivePotaSpots,
  shouldWarnAboutStaleSnapshot,
} from "./live-spots-client";

describe("fetchLivePotaSpots", () => {
  it("loads the normalized same-origin live spots endpoint", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          spots: [{ id: "spot-1" }],
          generatedAt: "2026-08-19T14:00:00.000Z",
          stale: false,
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );

    await expect(fetchLivePotaSpots(fetcher)).resolves.toEqual({
      spots: [{ id: "spot-1" }],
      generatedAt: "2026-08-19T14:00:00.000Z",
      stale: false,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/pota/spots", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  });

  it("rejects unavailable or invalid responses", async () => {
    await expect(
      fetchLivePotaSpots(async () => new Response("unavailable", { status: 502 })),
    ).rejects.toThrow(/unavailable/i);
    await expect(
      fetchLivePotaSpots(async () => Response.json({ ok: true, spots: null })),
    ).rejects.toThrow(/invalid/i);
    await expect(
      fetchLivePotaSpots(async () => Response.json({ ok: true, spots: [] })),
    ).rejects.toThrow(/invalid/i);
  });
});

describe("shouldWarnAboutStaleSnapshot", () => {
  const generatedAt = "2026-08-19T14:00:00.000Z";

  it("does not warn for a stale snapshot less than five minutes old", () => {
    expect(shouldWarnAboutStaleSnapshot(
      { spots: [], generatedAt, stale: true },
      new Date("2026-08-19T14:04:59.999Z"),
    )).toBe(false);
  });

  it("warns once a stale snapshot is five minutes old", () => {
    expect(shouldWarnAboutStaleSnapshot(
      { spots: [], generatedAt, stale: true },
      new Date("2026-08-19T14:05:00.000Z"),
    )).toBe(true);
  });

  it("does not warn for a fresh snapshot regardless of its age", () => {
    expect(shouldWarnAboutStaleSnapshot(
      { spots: [], generatedAt, stale: false },
      new Date("2026-08-19T15:00:00.000Z"),
    )).toBe(false);
  });
});
