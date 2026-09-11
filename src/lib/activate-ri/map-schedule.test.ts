import { describe, expect, it } from "vitest";
import { upcomingMapStops } from "./map-schedule";
import type { PublicActivationStop } from "./types";

const stop = (id: string, overrides: Partial<PublicActivationStop> = {}): PublicActivationStop => ({
  id, parkReference: "US-7865", plannedDate: "2026-09-12", startTime: "10:00", endTime: "13:00",
  activatorCallsign: "K1NW", bands: ["20m"], modes: ["CW"], publicNotes: "", status: "scheduled", ...overrides,
});

describe("upcoming map activations", () => {
  it("keeps future activators at a completed park and excludes expired, done, cancelled, private, and sample stops", () => {
    expect(upcomingMapStops([
      stop("future"), stop("done", { activity: "confirmed" }), stop("completed", { status: "completed" }),
      stop("cancelled", { status: "cancelled" }), stop("pending", { status: "pending-review" }), stop("sample-demo"),
      stop("expired", { plannedDate: "2026-09-11", endTime: "12:00" }),
      stop("current", { plannedDate: "2026-09-11", activity: "spotted" }),
      stop("delayed", { startTime: "14:00", endTime: "15:00", status: "delayed" }),
    ], new Date("2026-09-11T12:00:00Z")).map(({ id }) => id)).toEqual(["current", "future", "delayed"]);
  });

  it("orders and expires RI evening windows across UTC midnight", () => {
    const stops = [
      stop("late", { plannedDate: "2026-09-11", startTime: "01:00", endTime: "04:00" }),
      stop("early", { plannedDate: "2026-09-11", startTime: "22:00", endTime: "01:00" }),
    ];
    expect(upcomingMapStops(stops, new Date("2026-09-12T00:30:00Z")).map(({ id }) => id)).toEqual(["early", "late"]);
    expect(upcomingMapStops(stops, new Date("2026-09-12T01:00:00Z")).map(({ id }) => id)).toEqual(["late"]);
    expect(upcomingMapStops(stops, new Date("2026-09-12T04:00:00Z"))).toEqual([]);
  });
});
