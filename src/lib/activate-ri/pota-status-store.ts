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
  let started = false;

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

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    start(runtime: PotaParkStatusPollingRuntime = browserRuntime()): void {
      if (started) return;
      started = true;
      if (runtime.isVisible()) void refresh();
      runtime.setInterval(() => {
        if (runtime.isVisible()) void refresh();
      }, refreshIntervalMilliseconds);
      runtime.onVisibilityChange(() => {
        if (runtime.isVisible()) void refresh();
      });
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
