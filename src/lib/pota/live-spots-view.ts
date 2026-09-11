import type { LivePotaSpot } from "./spots";

export type LiveSpotsSortColumn = "park" | "activator" | "frequency" | "mode" | "spotted" | "source";
export type LiveSpotsSortDirection = "asc" | "desc";
export type LiveSpotsSort = {
  column: LiveSpotsSortColumn;
  direction: LiveSpotsSortDirection;
};

export const defaultLiveSpotsSort: LiveSpotsSort = {
  column: "spotted",
  direction: "desc",
};

const textCollator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

export function readLiveSpotsSort(params: URLSearchParams): LiveSpotsSort {
  const column = params.get("sort");
  const direction = params.get("direction");
  return {
    column: isSortColumn(column) ? column : defaultLiveSpotsSort.column,
    direction: direction === "asc" || direction === "desc" ? direction : defaultLiveSpotsSort.direction,
  };
}

export function writeLiveSpotsSort(url: URL, sort: LiveSpotsSort): URL {
  const next = new URL(url);
  next.searchParams.delete("sort");
  next.searchParams.delete("direction");
  if (isSortColumn(sort.column) && sort.column !== defaultLiveSpotsSort.column) {
    next.searchParams.set("sort", sort.column);
  }
  if (sort.direction === "asc") {
    next.searchParams.set("direction", sort.direction);
  }
  return next;
}

export function sortLiveSpots(spots: readonly LivePotaSpot[], sort: LiveSpotsSort): LivePotaSpot[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return spots
    .map((spot) => ({ spot, value: sortValue(spot, sort.column) }))
    .sort((left, right) => {
      if (left.value === null) return right.value === null ? 0 : 1;
      if (right.value === null) return -1;
      const compared = typeof left.value === "number" && typeof right.value === "number"
        ? left.value - right.value
        : textCollator.compare(String(left.value), String(right.value));
      return compared * direction;
    })
    .map(({ spot }) => spot);
}

export function formatSpotSource(spot: LivePotaSpot): string {
  const callsign = spot.spotterCallsign.trim();
  const source = spot.sourceLabel.trim();
  return [callsign ? `by ${callsign}` : "", source ? `via ${source}` : ""].filter(Boolean).join(" ");
}

function isSortColumn(value: string | null): value is LiveSpotsSortColumn {
  return value === "park" || value === "activator" || value === "frequency" ||
    value === "mode" || value === "spotted" || value === "source";
}

function sortValue(spot: LivePotaSpot, column: LiveSpotsSortColumn): string | number | null {
  switch (column) {
    case "park":
      return [spot.parkReference.trim(), spot.parkName.trim()].filter(Boolean).join(" · ") || null;
    case "activator":
      return spot.activatorCallsign.trim() || null;
    case "frequency": {
      const value = spot.frequency.trim();
      const frequency = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
      return Number.isFinite(frequency) && frequency > 0 ? frequency : null;
    }
    case "mode":
      return spot.mode.trim() || null;
    case "spotted": {
      const value = spot.spotTime.trim();
      const timestamp = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    case "source":
      return formatSpotSource(spot) || null;
  }
}
