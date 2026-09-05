import { afterEach, describe, expect, it, vi } from "vitest";
import { eventPhaseAt, subscribeEventPhase } from "./event-phase";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("automatic event phases", () => {
  it.each([
    ["2026-09-09T23:59:59.999Z", "planning"],
    ["2026-09-10T00:00:00Z", "event-live"],
    ["2026-09-13T23:59:59.999Z", "event-live"],
    ["2026-09-14T00:00:00Z", "post-event"],
  ])("uses UTC boundaries at %s", (time, phase) => {
    expect(eventPhaseAt(new Date(time))).toBe(phase);
  });

  it("transitions an already open page and resumes a suspended tab", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T23:59:59Z"));
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const listener = vi.fn();
    const unsubscribe = subscribeEventPhase(listener);
    expect(listener).toHaveBeenLastCalledWith("planning");
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenLastCalledWith("event-live");
    vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenLastCalledWith("post-event");
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});
