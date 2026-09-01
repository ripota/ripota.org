import { describe, expect, it, vi } from "vitest";
import { createLocationSession } from "./session";

function geolocationHarness() {
  let success: PositionCallback | undefined;
  let failure: PositionErrorCallback | undefined;

  const geolocation = {
    watchPosition: vi.fn(
      (onSuccess: PositionCallback, onFailure?: PositionErrorCallback | null) => {
        success = onSuccess;
        failure = onFailure ?? undefined;
        return 17;
      },
    ),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;

  return {
    geolocation,
    succeed(latitude: number, longitude: number, accuracy: number) {
      success?.({
        coords: {
          latitude,
          longitude,
          accuracy,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: 1,
        toJSON: () => ({}),
      });
    },
    fail(code: number) {
      failure?.({
        code,
        message: "location failed",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    },
  };
}

function visibilityHarness() {
  const listeners = new Map<string, EventListener>();
  const document = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
  } as unknown as Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;

  return {
    document,
    hide() {
      Object.assign(document, { visibilityState: "hidden" });
      listeners.get("visibilitychange")?.(new Event("visibilitychange"));
    },
  };
}

describe("createLocationSession", () => {
  it("watches for high-accuracy updates and emits normalized positions", () => {
    const harness = geolocationHarness();
    const onPosition = vi.fn();
    const onStateChange = vi.fn();
    const session = createLocationSession({
      geolocation: harness.geolocation,
      document: null,
      onPosition,
      onStateChange,
    });

    session.start();
    harness.succeed(41.7, -71.5, 9);

    expect(harness.geolocation.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 12_000,
      },
    );
    expect(onPosition).toHaveBeenCalledWith({
      latitude: 41.7,
      longitude: -71.5,
      accuracy: 9,
    });
    expect(session.getState()).toEqual({ status: "active" });
  });

  it("maps a denied permission to a user-facing state and stops watching", () => {
    const harness = geolocationHarness();
    const session = createLocationSession({
      geolocation: harness.geolocation,
      document: null,
      onPosition: vi.fn(),
    });

    session.start();
    harness.fail(1);

    expect(session.getState()).toEqual({
      status: "error",
      error: "permission-denied",
    });
    expect(harness.geolocation.clearWatch).toHaveBeenCalledWith(17);
  });

  it("reports unsupported browsers without starting a watcher", () => {
    const session = createLocationSession({
      geolocation: null,
      document: null,
      onPosition: vi.fn(),
    });

    session.start();

    expect(session.getState()).toEqual({
      status: "error",
      error: "unsupported",
    });
  });

  it("stops the watcher when the page becomes hidden", () => {
    const location = geolocationHarness();
    const visibility = visibilityHarness();
    const session = createLocationSession({
      geolocation: location.geolocation,
      document: visibility.document,
      onPosition: vi.fn(),
    });

    session.start();
    location.succeed(41.7, -71.5, 9);
    visibility.hide();

    expect(session.getState()).toEqual({ status: "stopped" });
    expect(location.geolocation.clearWatch).toHaveBeenCalledWith(17);
  });

  it("removes listeners and clears the watcher when destroyed", () => {
    const location = geolocationHarness();
    const visibility = visibilityHarness();
    const session = createLocationSession({
      geolocation: location.geolocation,
      document: visibility.document,
      onPosition: vi.fn(),
    });

    session.start();
    session.destroy();

    expect(location.geolocation.clearWatch).toHaveBeenCalledWith(17);
    expect(visibility.document.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});
