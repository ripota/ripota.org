import { describe, expect, it } from "vitest";
import { advanceReplay, replayActivity, replayDurationMs, replayMoment, replayTimeLabel } from "./replay-timeline";
import type { EventReplayEvent } from "./event-replay";

const events: EventReplayEvent[] = [
  { at: "2026-09-10T01:00:00.000Z", parkReference: "US-2870", activatorCallsign: "W1AW", mode: "CW", frequency: "14062" },
  { at: "2026-09-10T01:20:00.000Z", parkReference: "US-2870", activatorCallsign: "W1AW", mode: "SSB", frequency: "14250" },
  { at: "2026-09-11T12:00:00.000Z", parkReference: "US-2871", activatorCallsign: "N1BS", mode: "CW", frequency: "14062" },
];

describe("event replay timeline", () => {
  it("compresses the empty opening to one second and still completes in 72 seconds", () => {
    const start = Date.parse("2026-09-10T00:00:00Z");
    const end = Date.parse("2026-09-14T00:00:00Z");
    const first = Date.parse("2026-09-10T10:00:00Z");
    expect(advanceReplay(start, 1_000, start, end, first)).toBe(first);
    expect(advanceReplay(first, replayDurationMs - 1_000, start, end, first)).toBe(end);
    expect(advanceReplay(start, replayDurationMs + 10_000, start, end, first)).toBe(end);
    expect(advanceReplay(start, replayDurationMs / 2, start, end, start)).toBe((start + end) / 2);
  });
  it("accumulates unique parks while retaining the latest report at the selected time", () => {
    const start = replayMoment(events, Date.parse("2026-09-10T00:00:00Z"));
    expect(start.heard.size).toBe(0);
    expect(start.latest).toBeNull();
    const first = replayMoment(events, Date.parse(events[0].at));
    expect([...first.heard]).toEqual(["US-2870"]);
    expect(first.latestByPark.get("US-2870")?.mode).toBe("CW");
    const later = replayMoment(events, Date.parse("2026-09-12T00:00:00Z"));
    expect([...later.heard]).toEqual(["US-2870", "US-2871"]);
    expect(later.latestByPark.get("US-2870")?.mode).toBe("SSB");
    // Scrubbing backward must undo future activity instead of accumulating it.
    expect(replayMoment(events, Date.parse(events[0].at)).latest?.mode).toBe("CW");
  });

  it("shows hourly unique park activity instead of inflating repeated reports", () => {
    const bins = replayActivity(events, Date.parse("2026-09-10T00:00:00Z"), Date.parse("2026-09-14T00:00:00Z"));
    expect(bins).toHaveLength(96);
    expect(bins[1]).toBe(1);
    expect(bins[36]).toBe(1);
    expect(bins.reduce((sum, count) => sum + count, 0)).toBe(2);
  });

  it("always labels time in event UTC, including midnight", () => {
    expect(replayTimeLabel(Date.parse("2026-09-10T00:00:00Z"))).toBe("Sep 10, 00:00 UTC");
  });
});
