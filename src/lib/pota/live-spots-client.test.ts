import { describe, expect, it, vi } from "vitest";
import { fetchLivePotaSpots } from "./live-spots-client";

describe("fetchLivePotaSpots", () => {
  it("loads the normalized same-origin live spots endpoint", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, spots: [{ id: "spot-1" }] }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fetchLivePotaSpots(fetcher)).resolves.toEqual([{ id: "spot-1" }]);
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
  });
});
