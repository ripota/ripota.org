import { describe, expect, it, vi } from "vitest";
import type { LivePotaSpotsSnapshot } from "./live-spots-client";
import {
  createLivePotaSpotsStore,
  type LivePotaSpotsPollingRuntime,
  type LivePotaSpotsState,
} from "./live-spots-store";

const snapshot: LivePotaSpotsSnapshot = {
  spots: [],
  generatedAt: "2026-08-19T14:00:00.000Z",
  stale: false,
};

describe("live POTA spots store", () => {
  it("starts only one poller and shares each snapshot with every subscriber", async () => {
    const fetchSnapshot = vi.fn(async () => snapshot);
    const store = createLivePotaSpotsStore(fetchSnapshot);
    const firstStates: LivePotaSpotsState[] = [];
    const secondStates: LivePotaSpotsState[] = [];
    const intervalCallbacks: Array<() => void> = [];
    const runtime: LivePotaSpotsPollingRuntime = {
      setInterval: vi.fn((callback) => intervalCallbacks.push(callback)),
      onVisibilityChange: vi.fn(),
      isVisible: () => true,
    };

    store.subscribe((state) => firstStates.push(state));
    store.subscribe((state) => secondStates.push(state));
    store.start(runtime);
    store.start(runtime);
    await store.refresh();

    expect(fetchSnapshot).toHaveBeenCalledOnce();
    expect(runtime.setInterval).toHaveBeenCalledOnce();
    expect(firstStates.at(-1)).toEqual({ status: "ready", snapshot });
    expect(secondStates.at(-1)).toEqual({ status: "ready", snapshot });

    intervalCallbacks[0]();
    await store.refresh();
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it("publishes unavailable and recovers after a later successful refresh", async () => {
    const fetchSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(snapshot);
    const store = createLivePotaSpotsStore(fetchSnapshot);
    const states: LivePotaSpotsState[] = [];
    store.subscribe((state) => states.push(state));

    await store.refresh();
    expect(states.at(-1)).toEqual({ status: "unavailable" });

    await store.refresh();
    expect(states.at(-1)).toEqual({ status: "ready", snapshot });
  });
});
