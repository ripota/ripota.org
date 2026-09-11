import type { EventPhase } from "../activate-ri/types";

/** Keep the everyday on-air view independent of an event's archived results. */
export function onAirViewForPhase(phase: EventPhase): {
  showEventProgress: boolean;
  mapMode: "event" | "live";
} {
  const showEventProgress = phase === "event-live";
  return { showEventProgress, mapMode: showEventProgress ? "event" : "live" };
}
