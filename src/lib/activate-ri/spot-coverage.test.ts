import { describe, expect, it } from "vitest";
import { deriveSpotCoverage, type CoverageStop } from "./spot-coverage";

const now = new Date("2026-09-11T12:00:00Z");
const stop = (overrides: Partial<CoverageStop> = {}): CoverageStop => ({
  parkReference: "US-6979", activatorCallsign: "W1AW",
  startAt: "2026-09-11T13:00:00Z", endAt: "2026-09-11T14:00:00Z", status: "scheduled",
  ...overrides,
});

describe("missing park coverage", () => {
  it("includes scheduled parks but distinguishes past, present, and future windows", () => {
    expect(deriveSpotCoverage(false, false, [stop()], now).status).toBe("scheduled_later");
    expect(deriveSpotCoverage(false, false, [stop({ startAt: now.toISOString() })], now).status).toBe("scheduled_now");
    expect(deriveSpotCoverage(false, false, [stop({ startAt: "2026-09-11T10:00:00Z", endAt: now.toISOString() })], now).status).toBe("window_passed");
  });

  it("uses remaining plans over missed windows and ignores cancellations and unapproved stops", () => {
    const later = stop({ activatorCallsign: "N1BS" });
    const coverage = deriveSpotCoverage(false, false, [
      stop({ startAt: "2026-09-11T09:00:00Z", endAt: "2026-09-11T10:00:00Z" }), later,
    ], now);
    expect(coverage).toEqual({ status: "scheduled_later", stop: later });
    expect(deriveSpotCoverage(false, false, [stop({ status: "cancelled" }), stop({ status: "pending-review" })], now))
      .toEqual({ status: "unscheduled", stop: null });
  });

  it("does not mistake organizer completion for POTA confirmation", () => {
    expect(deriveSpotCoverage(false, false, [stop({ status: "completed" })], now).status).toBe("unscheduled");
    expect(deriveSpotCoverage(false, true, [], now).status).toBe("confirmed");
    expect(deriveSpotCoverage(true, false, [], now).status).toBe("spotted");
  });
});
