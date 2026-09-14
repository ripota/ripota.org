import { describe, expect, it, vi } from "vitest";
import { eventReplayWindow, fetchEventReplay, parseEventReplay, type EventReplay } from "./event-replay";

const replay: EventReplay = {
  ok: true, eventId: "activate-ri-2026", generatedAt: "2026-09-14T12:00:00.000Z",
  window: { ...eventReplayWindow }, source: "pota-spot-archive", totalParks: 61, truncated: false,
  events: [{ at: "2026-09-11T12:00:00.000Z", parkReference: "US-10542", activatorCallsign: "K1NW", mode: "SSB", frequency: "14315" }],
};

describe("event replay client", () => {
  it("fetches and validates archived event data, retaining a valid empty archive", async () => {
    const fetcher = vi.fn(async () => Response.json(replay));
    await expect(fetchEventReplay(fetcher)).resolves.toEqual(replay);
    expect(fetcher).toHaveBeenCalledWith("/api/activate-ri-2026/public/event-replay", { headers: { accept: "application/json" } });
    expect(parseEventReplay({ ...replay, events: [] }).events).toEqual([]);
  });

  it("rejects service failure and malformed or out-of-window observations", async () => {
    await expect(fetchEventReplay(async () => new Response("Unavailable", { status: 503 }))).rejects.toThrow("temporarily unavailable");
    for (const value of [null, {}, { ...replay, ok: false }, { ...replay, source: "daily-logs" },
      { ...replay, events: [{ ...replay.events[0], at: "not-a-date" }] },
      { ...replay, events: [{ ...replay.events[0], at: eventReplayWindow.end }] },
      { ...replay, events: [{ ...replay.events[0], at: "2026-09-09T00:00:00.000Z" }] },
      { ...replay, events: [{ ...replay.events[0], activatorCallsign: "<script>" }] },
      { ...replay, events: [replay.events[0], { ...replay.events[0], at: "2026-09-10T01:00:00.000Z" }] },
    ]) expect(() => parseEventReplay(value)).toThrow("temporarily unavailable");
  });

  it("returns an allowlisted projection without unrelated response properties", () => {
    expect(parseEventReplay({ ...replay, internal: "private", events: [{ ...replay.events[0], comments: "private" }] })).toEqual(replay);
  });
});
