import { describe, expect, it, vi } from "vitest";
import { createParkMediaStore, fetchParkMediaCounts, type ParkMediaState } from "./park-media-store";

describe("park media availability", () => {
  it("reads validated photo/video counts without cookies and accepts an empty gallery", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, parks: [
      { reference: "US-2868", photos: 2, videos: 0 },
      { reference: "US-2869", photos: 0, videos: 1 },
    ] }));
    const counts = await fetchParkMediaCounts(fetcher);
    expect([...counts]).toEqual([
      ["US-2868", { photos: 2, videos: 0 }],
      ["US-2869", { photos: 0, videos: 1 }],
    ]);
    expect(fetcher).toHaveBeenCalledWith("/api/activate-ri-2026/public/media?summary=parks", {
      headers: { accept: "application/json" }, cache: "no-store", credentials: "omit",
    });
    expect(await fetchParkMediaCounts(async () => Response.json({ ok: true, parks: [] }))).toEqual(new Map());
  });

  it("rejects an old gallery response and malformed counts instead of advertising uncertain media", async () => {
    for (const value of [
      { ok: true, media: [], nextCursor: null },
      { ok: false, parks: [] },
      { ok: true, parks: [{ reference: null, photos: 1, videos: 0 }] },
      { ok: true, parks: [{ reference: "US-2868", photos: -1, videos: 0 }] },
      { ok: true, parks: [{ reference: "US-2868", photos: 0, videos: 0.5 }] },
      { ok: true, parks: [{ reference: "US-2868", photos: "1", videos: 0 }] },
      { ok: true, parks: [
        { reference: "US-2868", photos: 1, videos: 0 },
        { reference: "US-2868", photos: 1, videos: 0 },
      ] },
    ]) {
      await expect(fetchParkMediaCounts(async () => Response.json(value))).rejects.toThrow("invalid");
    }
    await expect(fetchParkMediaCounts(async () => new Response(null, { status: 503 }))).rejects.toThrow("unavailable");
  });

  it("shares one request among map and table subscribers and explicit concurrent refreshes", async () => {
    const counts = new Map([["US-2868", { photos: 1, videos: 1 }]]);
    let resolve!: (value: typeof counts) => void;
    const fetchCounts = vi.fn(() => new Promise<typeof counts>((done) => { resolve = done; }));
    const store = createParkMediaStore(fetchCounts);
    const mapListener = vi.fn();
    const tableListener = vi.fn();
    store.subscribe(mapListener);
    store.start();
    store.subscribe(tableListener);
    store.start();
    const first = store.refresh();
    expect(store.refresh()).toBe(first);
    await Promise.resolve();
    expect(fetchCounts).toHaveBeenCalledTimes(1);
    resolve(counts);
    await first;
    expect(mapListener).toHaveBeenLastCalledWith({ status: "ready", counts });
    expect(tableListener).toHaveBeenLastCalledWith({ status: "ready", counts });
    store.start();
    expect(fetchCounts).toHaveBeenCalledTimes(1);
  });

  it("clears known availability on failed refresh and can recover without retaining unsubscribed listeners", async () => {
    const counts = new Map([["US-2868", { photos: 0, videos: 1 }]]);
    const fetchCounts = vi.fn().mockResolvedValueOnce(counts).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Map());
    const store = createParkMediaStore(fetchCounts);
    const states: ParkMediaState[] = [];
    const unsubscribe = store.subscribe(state => states.push(state));
    await store.refresh();
    expect(states.at(-1)).toEqual({ status: "ready", counts });
    await store.refresh();
    expect(states.at(-1)).toEqual({ status: "unavailable" });
    const stateCount = states.length;
    unsubscribe();
    await store.refresh();
    expect(states).toHaveLength(stateCount);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(listener).toHaveBeenLastCalledWith({ status: "ready", counts: new Map() });
  });
});
