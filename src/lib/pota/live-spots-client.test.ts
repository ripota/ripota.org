import { describe, expect, it, vi } from "vitest";
import { fetchLivePotaSpots } from "./live-spots-client";

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
