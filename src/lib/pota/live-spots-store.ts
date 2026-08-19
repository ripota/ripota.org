import {
  fetchLivePotaSpots,
  type LivePotaSpotsSnapshot,
} from "./live-spots-client";

export type LivePotaSpotsState =
  | { status: "loading" }
  | { status: "ready"; snapshot: LivePotaSpotsSnapshot }
  | { status: "unavailable" };

type Listener = (state: LivePotaSpotsState) => void;

export type LivePotaSpotsPollingRuntime = {
  setInterval(callback: () => void, milliseconds: number): void;
  onVisibilityChange(callback: () => void): void;
  isVisible(): boolean;
};

const refreshIntervalMilliseconds = 60_000;

export function createLivePotaSpotsStore(
  fetchSnapshot: () => Promise<LivePotaSpotsSnapshot> = fetchLivePotaSpots,
) {
  const listeners = new Set<Listener>();
  let state: LivePotaSpotsState = { status: "loading" };
  let refreshInProgress: Promise<void> | undefined;
  let started = false;

  const publish = (nextState: LivePotaSpotsState): void => {
    state = nextState;
    listeners.forEach((listener) => listener(state));
  };

  const refresh = (): Promise<void> => {
    if (refreshInProgress) {
      return refreshInProgress;
    }

    refreshInProgress = fetchSnapshot()
      .then((snapshot) => publish({ status: "ready", snapshot }))
      .catch(() => publish({ status: "unavailable" }))
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

    start(runtime: LivePotaSpotsPollingRuntime = browserPollingRuntime()): void {
      if (started) {
        return;
      }

      started = true;
      void refresh();
      runtime.setInterval(() => void refresh(), refreshIntervalMilliseconds);
      runtime.onVisibilityChange(() => {
        if (runtime.isVisible()) {
          void refresh();
        }
      });
    },

    refresh,
  };
}

function browserPollingRuntime(): LivePotaSpotsPollingRuntime {
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

export const livePotaSpotsStore = createLivePotaSpotsStore();
