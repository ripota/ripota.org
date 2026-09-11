import { describe, expect, it, vi } from "vitest";
import {
  createPotaParkStatusStore,
  type PotaParkStatusPollingRuntime,
  type PotaParkStatusState,
} from "./pota-status-store";
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
    visibility?.();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    visible = true;
    visibility?.();
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ status: "ready", snapshot, refreshFailed: true }));
  });

  it("keeps polling for remaining listeners and stops automatic requests after the last unsubscribe", async () => {
    const snapshot = testSnapshot();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot);
    const polling = testPollingRuntime();
    const store = createPotaParkStatusStore(fetchSnapshot);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(first);
    const unsubscribeSecond = store.subscribe(second);
    store.start(polling.runtime);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await store.refresh();

    unsubscribeFirst();
    polling.interval();
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    await store.refresh();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(3);

    unsubscribeSecond();
    polling.interval();
    polling.visibilityChange();
    store.start(polling.runtime);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(3);
  });

  it("resumes on a later subscribe and start without duplicating active starts or polling callbacks", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(testSnapshot());
    const polling = testPollingRuntime();
    const store = createPotaParkStatusStore(fetchSnapshot);
    store.start(polling.runtime);
    polling.interval();
    polling.visibilityChange();
    expect(fetchSnapshot).not.toHaveBeenCalled();

    const unsubscribe = store.subscribe(vi.fn());
    store.start(polling.runtime);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await store.refresh();
    store.start(polling.runtime);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.subscribe(vi.fn());
    store.start(polling.runtime);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    await store.refresh();
    store.start(polling.runtime);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(polling.runtime.setInterval).toHaveBeenCalledTimes(1);
    expect(polling.runtime.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(polling.runtime.onVisibilityChange).toHaveBeenCalledTimes(1);
  });

  it("waits until visible to refresh after subscriptions resume", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(testSnapshot());
    const polling = testPollingRuntime();
    const store = createPotaParkStatusStore(fetchSnapshot);
    const unsubscribe = store.subscribe(vi.fn());
    store.start(polling.runtime);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await store.refresh();
    unsubscribe();

    polling.setVisible(false);
    store.subscribe(vi.fn());
    store.start(polling.runtime);
    polling.interval();
    polling.visibilityChange();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    polling.setVisible(true);
    polling.visibilityChange();
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    await store.refresh();
  });

  it("allows an explicit refresh without listeners", async () => {
    const snapshot = testSnapshot();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot);
    const store = createPotaParkStatusStore(fetchSnapshot);
    await store.refresh();

    const listener = vi.fn();
    store.subscribe(listener);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ status: "ready", snapshot, refreshFailed: false });
  });

  it("does not notify removed listeners when an in-flight request completes", async () => {
    const snapshot = testSnapshot();
    let resolveSnapshot!: (snapshot: PublicPotaParkStatusSnapshot) => void;
    const fetchSnapshot = vi.fn(() => new Promise<PublicPotaParkStatusSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    }));
    const store = createPotaParkStatusStore(fetchSnapshot);
    const polling = testPollingRuntime();
    const listener = vi.fn<(state: PotaParkStatusState) => void>();
    const unsubscribe = store.subscribe(listener);
    store.start(polling.runtime);
    const completion = store.refresh();
    unsubscribe();
    resolveSnapshot(snapshot);
    await completion;

    expect(listener).toHaveBeenCalledExactlyOnceWith({ status: "loading" });
    polling.interval();
    polling.visibilityChange();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });
});

function testPollingRuntime() {
  let interval = () => {};
  let visibilityChange = () => {};
  let visible = true;
  const runtime: PotaParkStatusPollingRuntime = {
    setInterval: vi.fn((callback) => { interval = callback; }),
    onVisibilityChange: vi.fn((callback) => { visibilityChange = callback; }),
    isVisible: () => visible,
  };
  return {
    runtime,
    interval: () => interval(),
    visibilityChange: () => visibilityChange(),
    setVisible: (next: boolean) => { visible = next; },
  };
}

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
