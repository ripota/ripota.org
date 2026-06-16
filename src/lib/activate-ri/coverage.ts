import type { ParkCoverage, PublicActivationStop, PublicParkSummary } from "./types";

const activeStatuses = new Set(["scheduled", "delayed", "completed"]);

export function deriveParkCoverage(
  parks: PublicParkSummary[],
  stops: PublicActivationStop[],
): ParkCoverage[] {
  return parks.map((park) => {
    const parkStops = sortStops(
      stops.filter((stop) => stop.parkReference === park.reference),
    );
    const scheduledStops = parkStops.filter((stop) => activeStatuses.has(stop.status));
    const cancelledStops = parkStops.filter((stop) => stop.status === "cancelled");

    return {
      reference: park.reference,
      name: park.name,
      status: coverageStatus(scheduledStops.length, cancelledStops.length),
      scheduledStopCount: scheduledStops.length,
      cancelledStopCount: cancelledStops.length,
      nextStop: scheduledStops[0] ?? null,
      stops: parkStops,
    };
  });
}

function coverageStatus(
  scheduledStopCount: number,
  cancelledStopCount: number,
): ParkCoverage["status"] {
  if (scheduledStopCount > 1) {
    return "multiple-scheduled";
  }

  if (scheduledStopCount === 1) {
    return "scheduled";
  }

  if (cancelledStopCount > 0) {
    return "cancelled-needs-replacement";
  }

  return "uncovered";
}

function sortStops(stops: PublicActivationStop[]): PublicActivationStop[] {
  return [...stops].sort((left, right) => {
    const leftKey = `${left.plannedDate}T${left.startTime}`;
    const rightKey = `${right.plannedDate}T${right.startTime}`;
    return leftKey.localeCompare(rightKey);
  });
}
