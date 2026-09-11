import { isStopDone } from "./stop-status";
import { stopTimeRangeToInstants } from "./time";
import type { PublicActivationStop } from "./types";

/** Keep current and future windows even when another activator has completed the park. */
export function upcomingMapStops(stops: PublicActivationStop[], now = new Date()): PublicActivationStop[] {
  return stops
    .filter((stop) => !stop.id.startsWith("sample-") &&
      (stop.status === "scheduled" || stop.status === "delayed") && !isStopDone(stop))
    .map((stop) => ({
      stop,
      // Public stops use the RI calendar date with UTC clock times.
      ...stopTimeRangeToInstants(stop.plannedDate, stop.startTime, stop.endTime, {
        utcDateOffset: stop.startTime < "04:00" ? 1 : 0,
      }),
    }))
    .filter(({ endAt }) => Date.parse(endAt) > now.valueOf())
    .sort((left, right) => left.startAt.localeCompare(right.startAt) ||
      left.stop.activatorCallsign.localeCompare(right.stop.activatorCallsign) || left.stop.id.localeCompare(right.stop.id))
    .map(({ stop }) => stop);
}
