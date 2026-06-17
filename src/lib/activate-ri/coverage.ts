import type { ParkCoverage, PublicActivationStop, PublicParkSummary } from "./types";

const upcomingActiveStatuses = new Set(["scheduled", "delayed"]);

export function deriveParkCoverage(
  parks: PublicParkSummary[],
  stops: PublicActivationStop[],
): ParkCoverage[] {
  return parks.map((park) => {
    const parkStops = sortStops(
      stops.filter((stop) => stop.parkReference === park.reference),
    );
    const scheduledStops = parkStops.filter((stop) =>
      upcomingActiveStatuses.has(stop.status),
    );
    const completedStops = parkStops.filter((stop) => stop.status === "completed");
    const cancelledStops = parkStops.filter((stop) => stop.status === "cancelled");

    return {
      reference: park.reference,
      name: park.name,
      counties: park.counties,
      status: coverageStatus(
        scheduledStops.length,
        cancelledStops.length,
        completedStops.length,
      ),
      scheduledStopCount: scheduledStops.length,
      cancelledStopCount: cancelledStops.length,
      nextStop: scheduledStops[0] ?? null,
      stops: parkStops,
    };
  });
}

export type CoverageSummaryCounts = {
  scheduled: number;
  gaps: number;
  total: number;
};

export function summarizeParkCoverage(
  parks: PublicParkSummary[],
  stops: PublicActivationStop[],
): CoverageSummaryCounts {
  const visibleStops = stops.filter((stop) => !stop.id.startsWith("sample-"));
  const coverage = deriveParkCoverage(parks, visibleStops);

  return {
    scheduled: coverage.filter((park) =>
      ["scheduled", "multiple-scheduled", "completed"].includes(park.status),
    ).length,
    gaps: coverage.filter((park) =>
      ["uncovered", "cancelled-needs-replacement"].includes(park.status),
    ).length,
    total: coverage.length,
  };
}

function coverageStatus(
  scheduledStopCount: number,
  cancelledStopCount: number,
  completedStopCount: number,
): ParkCoverage["status"] {
  if (scheduledStopCount > 1) {
    return "multiple-scheduled";
  }

  if (scheduledStopCount === 1) {
    return "scheduled";
  }

  if (completedStopCount > 0) {
    return "completed";
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
