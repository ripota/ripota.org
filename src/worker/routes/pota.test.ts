import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePotaSpots } from "./pota";

function request(headers?: HeadersInit): Request {
  return new Request("https://ripota.org/api/pota/spots", { headers });
}

describe("handlePotaSpots", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns only normalized active RI spots with a short public cache", async () => {
    const upstreamFetch = vi.fn(async () =>
      Response.json([
        {
          spotId: 1,
          activator: "N1BS",
          frequency: "14052.0",
          mode: "CW",
          reference: "US-10545",
          name: "Hillsdale Preserve Management Area",
          spotTime: "2026-08-19T13:27:46",
          spotter: "KW7MM-#",
          comments: "RBN 5 dB",
          source: "RBN",
          invalid: null,
          expire: 561,
        },
        {
          spotId: 2,
          activator: "W1AW",
          frequency: "14000",
          mode: "CW",
          reference: "US-9999",
          name: "Outside RI",
          spotTime: "2026-08-19T13:27:46",
          expire: 561,
        },
      ]),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handlePotaSpots(request({ "cache-control": "no-cache" }));
    const data = await response.json() as { ok: boolean; spots: unknown[] };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, s-maxage=60");
    expect(data.ok).toBe(true);
    expect(data.spots).toHaveLength(1);
    expect(data.spots[0]).toMatchObject({
      parkReference: "US-10545",
      activatorCallsign: "N1BS",
    });
    expect(upstreamFetch).toHaveBeenCalledWith(
      "https://api.pota.app/spot/activator",
      expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }),
    );
  });

  it("distinguishes an empty RI result from an upstream failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    const emptyResponse = await handlePotaSpots(request({ "cache-control": "no-cache" }));
    await expect(emptyResponse.json()).resolves.toMatchObject({ ok: true, spots: [] });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 503 })));
    const failedResponse = await handlePotaSpots(request({ "cache-control": "no-cache" }));
    expect(failedResponse.status).toBe(502);
    expect(failedResponse.headers.get("cache-control")).toBe("no-store");
    await expect(failedResponse.json()).resolves.toEqual({
      ok: false,
      error: "Live POTA spots are temporarily unavailable.",
    });
  });

  it("fails closed when the upstream schema root changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ spots: [] })));

    const response = await handlePotaSpots(request({ "cache-control": "no-cache" }));

    expect(response.status).toBe(502);
  });
});
