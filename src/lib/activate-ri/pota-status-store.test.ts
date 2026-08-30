import { describe, expect, it, vi } from "vitest";
import { createPotaParkStatusStore, type PotaParkStatusPollingRuntime } from "./pota-status-store";
import type { PublicPotaParkStatusSnapshot } from "./pota-status-client";

describe("POTA park status polling", () => {
  it("pauses while hidden, refreshes on visibility, and preserves the last success after failure", async () => {
    const snapshot = testSnapshot();
    const fetchSnapshot = vi.fn<() => Promise<PublicPotaParkStatusSnapshot>>()
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error("temporary"));
    let interval: (() => void) | undefined;
    let visibility: (() => void) | undefined;
    let visible = true;
    const runtime: PotaParkStatusPollingRuntime = {
      setInterval(callback) { interval = callback; },
      onVisibilityChange(callback) { visibility = callback; },
      isVisible() { return visible; },
    };
    const states: unknown[] = [];
    const store = createPotaParkStatusStore(fetchSnapshot);
    store.subscribe((state) => states.push(state));
    store.start(runtime);
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ status: "ready", snapshot, refreshFailed: false }));
    await Promise.resolve();

    visible = false;
    interval?.();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    visible = true;
    visibility?.();
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ status: "ready", snapshot, refreshFailed: true }));
  });
});

function testSnapshot(): PublicPotaParkStatusSnapshot {
  return {
    generatedAt: "2026-09-11T12:00:00Z",
    lastPotaSyncAt: null,
    lastSpotIngestAt: null,
    stale: false,
    warning: null,
    eventWindow: { startDate: "2026-09-10", endDate: "2026-09-13", timezone: "UTC" },
    summary: { total: 61, confirmed: 0, observedNotConfirmed: 0, scheduledNotConfirmed: 0, stillNeeded: 61, withoutConfirmation: 61 },
    parks: [],
  };
}
