import {
  fetchPublicPotaParkStatus,
  type PublicPotaParkStatusSnapshot,
} from "./pota-status-client";

export type PotaParkStatusState =
  | { status: "loading" }
  | { status: "ready"; snapshot: PublicPotaParkStatusSnapshot; refreshFailed: boolean }
  | { status: "unavailable" };

export type PotaParkStatusPollingRuntime = {
  setInterval(callback: () => void, milliseconds: number): void;
  onVisibilityChange(callback: () => void): void;
  isVisible(): boolean;
};

type Listener = (state: PotaParkStatusState) => void;
const refreshIntervalMilliseconds = 60_000;

export function createPotaParkStatusStore(
  fetchSnapshot: () => Promise<PublicPotaParkStatusSnapshot> = fetchPublicPotaParkStatus,
) {
  const listeners = new Set<Listener>();
  let state: PotaParkStatusState = { status: "loading" };
  let lastSnapshot: PublicPotaParkStatusSnapshot | undefined;
  let refreshInProgress: Promise<void> | undefined;
  let pollingRuntime: PotaParkStatusPollingRuntime | undefined;
  let refreshOnStart = true;

  const publish = (next: PotaParkStatusState) => {
    state = next;
    listeners.forEach((listener) => listener(next));
  };
  const refresh = (): Promise<void> => {
    if (refreshInProgress) return refreshInProgress;
    refreshInProgress = fetchSnapshot()
      .then((snapshot) => {
        lastSnapshot = snapshot;
        publish({ status: "ready", snapshot, refreshFailed: false });
      })
      .catch(() => {
        publish(lastSnapshot
          ? { status: "ready", snapshot: lastSnapshot, refreshFailed: true }
          : { status: "unavailable" });
      })
      .finally(() => {
        refreshInProgress = undefined;
      });
    return refreshInProgress;
  };
  const refreshWhileObserved = () => {
    if (listeners.size > 0 && pollingRuntime?.isVisible()) {
      refreshOnStart = false;
      void refresh();
    }
  };

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) refreshOnStart = true;
      };
    },
    start(runtime: PotaParkStatusPollingRuntime = browserRuntime()): void {
      if (!pollingRuntime) {
        pollingRuntime = runtime;
        runtime.setInterval(refreshWhileObserved, refreshIntervalMilliseconds);
        runtime.onVisibilityChange(refreshWhileObserved);
      }
      if (refreshOnStart) refreshWhileObserved();
    },
    refresh,
  };
}

function browserRuntime(): PotaParkStatusPollingRuntime {
  return {
    setInterval(callback, milliseconds) {
      window.setInterval(callback, milliseconds);
    },
    onVisibilityChange(callback) {
      document.addEventListener("visibilitychange", callback);
    },
    isVisible() {
      return document.visibilityState === "visible";
    },
  };
}

export const potaParkStatusStore = createPotaParkStatusStore();
