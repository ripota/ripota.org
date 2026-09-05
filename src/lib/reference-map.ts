import type { DisplayReference, GeoJsonFeatureCollection, GeometryKind } from "@ripota/parks/types";
import { deriveParkCoverage } from "./activate-ri/coverage";
import type {
  ParkCoverageStatus,
  PublicActivationStop,
  PublicParkSummary,
} from "./activate-ri/types";

export type ReferenceMapVariant = "home" | "directory" | "coverage" | "volunteer";

export type ReferenceMapReference = {
  reference: string;
  name: string;
  latitude?: number;
  longitude?: number;
  grid?: string;
  counties?: readonly string[];
  locationDesc?: string;
  potaUrl?: string;
};

export type ReferenceMapCoverage = {
  status: ParkCoverageStatus;
  label: string;
  color: string;
  stops: PublicActivationStop[];
};

export type ReferenceMapItem = {
  reference: string;
  name: string;
  counties: readonly string[];
  grid: string;
  locationDesc: string;
  potaUrl: string;
  marker: {
    latitude: number;
    longitude: number;
  } | null;
  geometryKind: GeometryKind;
  boundaryStatus: DisplayReference["status"] | "unknown";
  bbox?: DisplayReference["bbox"];
  geojson: GeoJsonFeatureCollection | null;
  coverage: ReferenceMapCoverage | null;
};

export type BuildReferenceMapItemsInput = {
  references: readonly ReferenceMapReference[];
  displayReferences: readonly DisplayReference[];
  geojsonByReference?: Readonly<Record<string, GeoJsonFeatureCollection>>;
  markerPlacement?: "geometry-center" | "reference-coordinate";
  parks?: PublicParkSummary[];
  stops?: PublicActivationStop[];
};

export const coverageStatusLabels: Record<ParkCoverageStatus, string> = {
  uncovered: "Needs coverage",
  scheduled: "Scheduled",
  "multiple-scheduled": "Multiple scheduled",
  "cancelled-needs-replacement": "Needs replacement",
  completed: "Completed",
};

export const referenceMapStatusColors: Record<ParkCoverageStatus, string> = {
  uncovered: "#b54708",
  scheduled: "#287c5b",
  "multiple-scheduled": "#1f5fbf",
  "cancelled-needs-replacement": "#9f1239",
  completed: "#5f6f76",
};

export const referenceMapLegendItems: Array<{
  label: string;
  statuses: ParkCoverageStatus[];
  color: string;
}> = [
  {
    label: "Help wanted",
    statuses: ["uncovered", "cancelled-needs-replacement"],
    color: referenceMapStatusColors.uncovered,
  },
  {
    label: "Scheduled",
    statuses: ["scheduled", "multiple-scheduled"],
    color: referenceMapStatusColors.scheduled,
  },
  {
    label: "Completed",
    statuses: ["completed"],
    color: referenceMapStatusColors.completed,
  },
];

export function displayedReferenceMapLegendItems(
  statuses: ParkCoverageStatus[],
): typeof referenceMapLegendItems {
  const visibleStatuses = new Set(statuses);

  return referenceMapLegendItems.filter(
    (item) =>
      !item.statuses.includes("completed") ||
      item.statuses.some((status) => visibleStatuses.has(status)),
  );
}

export const referenceMapLeafletOptions = {
  scrollWheelZoom: false,
  wheelPxPerZoomLevel: 120,
  zoomControl: false,
  zoomSnap: 0.25,
} as const;

export const referenceMapFitBoundsOptions = {
  padding: [16, 16] as [number, number],
  maxZoom: 10,
} as const;

export function buildReferenceMapItems({
  references,
  displayReferences,
  geojsonByReference = {},
  markerPlacement = "geometry-center",
  parks,
  stops,
}: BuildReferenceMapItemsInput): ReferenceMapItem[] {
  const displayByReference = new Map(
    displayReferences.map((display) => [display.reference, display]),
  );
  const coverageByReference = new Map(
    parks && stops
      ? deriveParkCoverage(parks, stops).map((coverage) => [coverage.reference, coverage])
      : [],
  );

  return references.map((reference) => {
    const display = displayByReference.get(reference.reference);
    const coverage = coverageByReference.get(reference.reference);
    const geojson = display?.status === "available"
      ? geojsonByReference[reference.reference] ?? null
      : null;
    const referencePoint = display
      ? { latitude: display.displayPoint.latitude, longitude: display.displayPoint.longitude }
      : markerForReference(reference);
    const center = markerForBounds(display?.bbox);

    return {
      reference: reference.reference,
      name: reference.name,
      counties: reference.counties ?? [],
      grid: reference.grid ?? "",
      locationDesc: reference.locationDesc ?? "",
      potaUrl: reference.potaUrl ?? "",
      marker: markerPlacement === "reference-coordinate"
        ? referencePoint ?? center
        : center ?? referencePoint,
      geometryKind: display?.geometryKind ?? "point",
      boundaryStatus: display?.status ?? "unknown",
      bbox: display?.bbox,
      geojson,
      coverage: coverage
        ? {
            status: coverage.status,
            label: coverageStatusLabels[coverage.status],
            color: referenceMapStatusColors[coverage.status],
            stops: coverage.stops,
          }
        : null,
    };
  });
}

function markerForReference(reference: ReferenceMapReference): ReferenceMapItem["marker"] {
  if (typeof reference.latitude !== "number" || typeof reference.longitude !== "number") {
    return null;
  }

  return {
    latitude: reference.latitude,
    longitude: reference.longitude,
  };
}

function markerForBounds(
  bbox: DisplayReference["bbox"],
): ReferenceMapItem["marker"] {
  if (!bbox || !bbox.every(Number.isFinite)) return null;
  const [west, south, east, north] = bbox;
  return { latitude: (south + north) / 2, longitude: (west + east) / 2 };
}
