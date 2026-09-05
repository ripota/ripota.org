export type CoverageStop = {
  parkReference: string;
  activatorCallsign: string;
  startAt: string;
  endAt: string;
  status: string;
};

export type SpotCoverage = {
  status: "confirmed" | "spotted" | "scheduled_now" | "scheduled_later" | "window_passed" | "unscheduled";
  stop: CoverageStop | null;
};

export function deriveSpotCoverage(
  spotted: boolean,
  confirmed: boolean,
  stops: readonly CoverageStop[],
  now: Date,
): SpotCoverage {
  const current = now.valueOf();
  const approved = stops.filter(stop => ["scheduled", "delayed", "completed"].includes(stop.status))
    .filter(stop => Number.isFinite(Date.parse(stop.startAt)) && Number.isFinite(Date.parse(stop.endAt)));
  const remaining = approved.filter(stop => stop.status !== "completed" && Date.parse(stop.endAt) > current)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const next = remaining[0] ?? null;
  if (confirmed) return { status: "confirmed", stop: next };
  if (spotted) return { status: "spotted", stop: next };
  if (next) return { status: Date.parse(next.startAt) <= current ? "scheduled_now" : "scheduled_later", stop: next };
  const previous = approved.filter(stop => Date.parse(stop.endAt) <= current)
    .sort((a, b) => b.endAt.localeCompare(a.endAt))[0];
  return previous
    ? { status: "window_passed", stop: previous }
    : { status: "unscheduled", stop: null };
}

export const spotCoverageLabels: Record<SpotCoverage["status"], string> = {
  confirmed: "POTA confirmed",
  spotted: "Activity spotted",
  scheduled_now: "Scheduled now",
  scheduled_later: "Scheduled later",
  window_passed: "Scheduled window passed — check with activator",
  unscheduled: "No remaining scheduled coverage",
};

export const spotCoveragePriority: Record<SpotCoverage["status"], number> = {
  unscheduled: 0, window_passed: 1, scheduled_now: 2, scheduled_later: 3, spotted: 4, confirmed: 5,
};
