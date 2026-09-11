import { matchesTimeline, parkCounties } from "./listing";
import { isStopDone } from "./stop-status";
import { stopTimeRangeToInstants } from "./time";
import type { PublicActivationStop, PublicParkSummary } from "./types";

export type PlanningSort = "activators" | "slots" | "name";

export type ParkPlanSummary = {
  reference: string;
  name: string;
  counties: string[];
  activatorCount: number;
  timeSlotCount: number;
  completedStopCount: number;
  stops: PublicActivationStop[];
};

type PlanningFilters = {
  timeline?: string;
  county?: string;
  myParkReferences?: ReadonlySet<string>;
  sort?: PlanningSort;
};

export function deriveParkPlans(
  parks: readonly PublicParkSummary[],
  stops: readonly PublicActivationStop[],
  filters: PlanningFilters = {},
): ParkPlanSummary[] {
  const stopsByPark = new Map<string, PublicActivationStop[]>();

  for (const stop of stops) {
    if (!isPlanStop(stop) || !matchesTimeline(stop.plannedDate, filters.timeline ?? "all")) {
      continue;
    }

    const parkStops = stopsByPark.get(stop.parkReference) ?? [];
    parkStops.push(stop);
    stopsByPark.set(stop.parkReference, parkStops);
  }

  const county = filters.county === "all" ? "" : filters.county;
  const summaries = parks
    .filter((park) =>
      (!county || parkCounties(park).includes(county)) &&
      (!filters.myParkReferences || filters.myParkReferences.has(park.reference)),
    )
    .map((park): ParkPlanSummary => {
      const parkStops = (stopsByPark.get(park.reference) ?? []).sort(compareStops);
      const scheduledStops = parkStops.filter(isScheduledStop);

      return {
        reference: park.reference,
        name: park.name,
        counties: park.counties,
        activatorCount: new Set(scheduledStops.map((stop) => normalizeCallsign(stop.activatorCallsign))).size,
        timeSlotCount: new Set(scheduledStops.map((stop) =>
          `${stop.plannedDate}/${stop.startTime}/${stop.endTime}`,
        )).size,
        completedStopCount: parkStops.filter(isStopDone).length,
        stops: parkStops,
      };
    });

  return summaries.sort((left, right) => {
    if (filters.sort === "name") {
      return compareParks(left, right);
    }

    if (filters.sort === "slots") {
      return left.timeSlotCount - right.timeSlotCount ||
        left.activatorCount - right.activatorCount ||
        compareParks(left, right);
    }

    return left.activatorCount - right.activatorCount ||
      left.timeSlotCount - right.timeSlotCount ||
      compareParks(left, right);
  });
}

export function myPlannedParkReferences(
  stops: readonly PublicActivationStop[],
  callsign: string,
): Set<string> {
  const normalizedCallsign = normalizeCallsign(callsign);
  if (!normalizedCallsign) {
    return new Set();
  }

  return new Set(stops
    .filter((stop) => isPlanStop(stop) && normalizeCallsign(stop.activatorCallsign) === normalizedCallsign)
    .map((stop) => stop.parkReference));
}

function isScheduledStop(stop: PublicActivationStop): boolean {
  return !stop.id.startsWith("sample-") &&
    (stop.status === "scheduled" || stop.status === "delayed") && !isStopDone(stop);
}

function isPlanStop(stop: PublicActivationStop): boolean {
  return !stop.id.startsWith("sample-") && (isScheduledStop(stop) || isStopDone(stop));
}

function normalizeCallsign(callsign: string): string {
  return callsign.trim().toUpperCase();
}

function compareParks(left: ParkPlanSummary, right: ParkPlanSummary): number {
  return left.name.localeCompare(right.name) || left.reference.localeCompare(right.reference);
}

function compareStops(left: PublicActivationStop, right: PublicActivationStop): number {
  const leftTimes = stopInstants(left);
  const rightTimes = stopInstants(right);

  return leftTimes.startAt.localeCompare(rightTimes.startAt) ||
    leftTimes.endAt.localeCompare(rightTimes.endAt) ||
    normalizeCallsign(left.activatorCallsign).localeCompare(normalizeCallsign(right.activatorCallsign)) ||
    left.id.localeCompare(right.id);
}

function stopInstants(stop: PublicActivationStop): { startAt: string; endAt: string } {
  // Public stops pair a Rhode Island calendar date with UTC clock times.
  // During this September event, 00:00–03:59 UTC is the local evening.
  return stopTimeRangeToInstants(stop.plannedDate, stop.startTime, stop.endTime, {
    utcDateOffset: stop.startTime < "04:00" ? 1 : 0,
  });
}
