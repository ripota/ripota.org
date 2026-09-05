import type { ReportedLocation } from "./classify";

export type LocationSessionError =
  | "unsupported"
  | "permission-denied"
  | "position-unavailable"
  | "timeout";

export type LocationSessionState =
  | { status: "idle" | "requesting" | "active" | "stopped" }
  | { status: "error"; error: LocationSessionError };

type VisibilityDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

type LocationSessionOptions = {
  geolocation?: Geolocation | null;
  document?: VisibilityDocument | null;
  onPosition: (location: ReportedLocation) => void;
  onStateChange?: (state: LocationSessionState) => void;
};

export type LocationSession = {
  start: () => void;
  stop: () => void;
  destroy: () => void;
  getState: () => LocationSessionState;
};

function errorName(error: GeolocationPositionError): LocationSessionError {
  switch (error.code) {
    case 1:
      return "permission-denied";
    case 3:
      return "timeout";
    default:
      return "position-unavailable";
  }
}

export function createLocationSession(
  options: LocationSessionOptions,
): LocationSession {
  const geolocation =
    options.geolocation === undefined
      ? globalThis.navigator?.geolocation
      : options.geolocation;
  const visibilityDocument =
    options.document === undefined ? globalThis.document : options.document;

  let state: LocationSessionState = { status: "idle" };
  let watchId: number | undefined;
  let destroyed = false;
  let watchGeneration = 0;

  function emit(nextState: LocationSessionState) {
    state = nextState;
    options.onStateChange?.(nextState);
  }

  function clearWatch() {
    watchGeneration += 1;
    if (watchId !== undefined && geolocation) {
      geolocation.clearWatch(watchId);
      watchId = undefined;
    }
  }

  function fail(error: LocationSessionError) {
    clearWatch();
    emit({ status: "error", error });
  }

  function start() {
    if (destroyed || state.status === "requesting" || state.status === "active") {
      return;
    }

    if (!geolocation) {
      fail("unsupported");
      return;
    }

    emit({ status: "requesting" });
    const currentWatch = ++watchGeneration;

    try {
      watchId = geolocation.watchPosition(
        (position) => {
          if (destroyed || currentWatch !== watchGeneration) return;

          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: Math.max(0, position.coords.accuracy),
          };

          emit({ status: "active" });
          options.onPosition(location);
        },
        (error) => {
          if (!destroyed && currentWatch === watchGeneration) fail(errorName(error));
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5_000,
          timeout: 12_000,
        },
      );
    } catch {
      fail("position-unavailable");
    }
  }

  function stop() {
    if (destroyed) return;
    clearWatch();
    emit({ status: "stopped" });
  }

  function handleVisibilityChange() {
    if (
      visibilityDocument?.visibilityState === "hidden" &&
      (state.status === "requesting" || state.status === "active")
    ) {
      stop();
    }
  }

  function destroy() {
    if (destroyed) return;
    clearWatch();
    visibilityDocument?.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    destroyed = true;
  }

  visibilityDocument?.addEventListener(
    "visibilitychange",
    handleVisibilityChange,
  );

  return {
    start,
    stop,
    destroy,
    getState: () => state,
  };
}
