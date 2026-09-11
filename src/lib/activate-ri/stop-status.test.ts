import { describe, expect, it } from "vitest";
import { isStopDone, scheduleStopStatusLabel } from "./stop-status";

describe("schedule stop completion", () => {
  it("shows qualifying matched evidence as done without changing the saved plan", () => {
    const stop = { status: "delayed", activity: "confirmed" as const };
    expect(isStopDone(stop)).toBe(true);
    expect(scheduleStopStatusLabel(stop)).toBe("Done");
    expect(stop.status).toBe("delayed");
  });

  it("does not confuse a spot with a completed activation", () => {
    expect(isStopDone({ status: "scheduled", activity: "spotted" })).toBe(false);
    expect(scheduleStopStatusLabel({ status: "delayed", activity: "spotted" })).toBe("Delayed");
    expect(scheduleStopStatusLabel({ status: "completed", activity: "spotted" })).toBe("Done");
  });

  it("preserves cancelled and unpublished status even if evidence is supplied", () => {
    expect(scheduleStopStatusLabel({ status: "cancelled", activity: "confirmed" })).toBe("Cancelled");
    expect(scheduleStopStatusLabel({ status: "pending-review", activity: "confirmed" })).toBe("Pending review");
    expect(isStopDone({ status: "scheduled" })).toBe(false);
  });
});
