import { describe, expect, it } from "vitest";
import { eventPhaseAt } from "../activate-ri/event-phase";
import { onAirViewForPhase } from "./on-air-view";

describe("on-air event context", () => {
  it.each([
    ["2026-09-09T23:59:59.999Z", false, "live"],
    ["2026-09-10T00:00:00Z", true, "event"],
    ["2026-09-13T23:59:59.999Z", true, "event"],
    ["2026-09-14T00:00:00Z", false, "live"],
    ["2027-06-01T12:00:00Z", false, "live"],
  ])("uses the shared event calendar at %s", (time, showEventProgress, mapMode) => {
    expect(onAirViewForPhase(eventPhaseAt(new Date(time)))).toEqual({ showEventProgress, mapMode });
  });
});
