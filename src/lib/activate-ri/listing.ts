import type { PublicActivationStop, PublicParkSummary } from "./types";

export type TimelineFilter =
  | "all"
  | "soft-start"
  | "main"
  | "2026-09-10"
  | "2026-09-11"
  | "2026-09-12"
  | "2026-09-13";

export type StopFilters = {
  mode?: string;
  band?: string;
  timeline?: string;
  county?: string;
};

export const timelineOptions: { value: TimelineFilter; label: string }[] = [
  { value: "all", label: "All dates" },
  { value: "soft-start", label: "Soft start" },
  { value: "main", label: "Main event" },
  { value: "2026-09-10", label: "Thu Sep 10" },
  { value: "2026-09-11", label: "Fri Sep 11" },
  { value: "2026-09-12", label: "Sat Sep 12" },
  { value: "2026-09-13", label: "Sun Sep 13" },
];

const mainEventDates = new Set(["2026-09-11", "2026-09-12", "2026-09-13"]);

export function formatActivatorModes(stop: PublicActivationStop): string {
  const modes = stop.modes.length > 0 ? ` (${stop.modes.join(", ")})` : "";

  return `${stop.activatorCallsign}${modes}`;
}

export function uniqueSortedValues(values: string[][]): string[] {
  return [...new Set(values.flat().filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function scheduleVisibleStops(
  stops: PublicActivationStop[],
): PublicActivationStop[] {
  return stops.filter(
    (stop) => !stop.id.startsWith("sample-") && stop.status !== "cancelled",
  );
}

export function parkCounties(park: PublicParkSummary | undefined): string[] {
  return park?.counties.length ? park.counties : ["Unknown county"];
}

export function filterPublicStops(
  stops: PublicActivationStop[],
  parks: PublicParkSummary[],
  filters: StopFilters,
): PublicActivationStop[] {
  const parksByReference = new Map(parks.map((park) => [park.reference, park]));
  const mode = normalizeFilter(filters.mode);
  const band = normalizeFilter(filters.band);
  const timeline = normalizeFilter(filters.timeline);
  const county = normalizeFilter(filters.county);

  return stops.filter((stop) => {
    const park = parksByReference.get(stop.parkReference);

    return (
      matchesList(stop.modes, mode) &&
      matchesList(stop.bands, band) &&
      matchesTimeline(stop.plannedDate, timeline) &&
      matchesList(parkCounties(park), county)
    );
  });
}

export function hasActiveStopFilters(filters: StopFilters): boolean {
  return Boolean(
    normalizeFilter(filters.mode) ||
      normalizeFilter(filters.band) ||
      normalizeTimelineFilter(filters.timeline) ||
      normalizeFilter(filters.county),
  );
}

export function matchesTimeline(date: string, timeline: string): boolean {
  const normalized = normalizeTimelineFilter(timeline);
  if (!normalized) {
    return true;
  }

  if (normalized === "soft-start") {
    return date === "2026-09-10";
  }

  if (normalized === "main") {
    return mainEventDates.has(date);
  }

  return date === normalized;
}

function matchesList(values: string[], filter: string): boolean {
  return filter.length === 0 || values.includes(filter);
}

function normalizeFilter(value: string | undefined): string {
  if (!value || value === "all") {
    return "";
  }

  return value;
}

function normalizeTimelineFilter(value: string | undefined): string {
  const normalized = normalizeFilter(value);

  return normalized === "all" ? "" : normalized;
}
