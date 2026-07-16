import { deriveParkCoverage } from "./activate-ri/coverage";
import type {
  ParkCoverageStatus,
  PublicActivationStop,
  PublicParkSummary,
} from "./activate-ri/types";

export type ReferenceMapVariant = "home" | "coverage" | "volunteer";

export type ReferenceMapGeometryKind = "boundary" | "activation-zone" | "point";

export type ReferenceMapGeoJson = {
  type: "FeatureCollection";
  features: unknown[];
  properties?: Record<string, unknown>;
};

export type ReferenceMapReference = {
  reference: string;
  name: string;
  latitude?: number;
  longitude?: number;
  grid?: string;
  counties?: string[];
  locationDesc?: string;
  potaUrl?: string;
};

export type ReferenceBoundaryRecord = {
  reference: string;
  status: "available" | "point-only" | "research-needed";
  geometryKind?: ReferenceMapGeometryKind;
  sourceName: string;
  sourceUrl: string;
  sourceFeatureIds?: Array<string | number>;
  localGeojson?: string;
  notes?: string;
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
  counties: string[];
  grid: string;
  locationDesc: string;
  potaUrl: string;
  marker: {
    latitude: number;
    longitude: number;
  } | null;
  geometryKind: ReferenceMapGeometryKind;
  boundaryStatus: ReferenceBoundaryRecord["status"] | "unknown";
  sourceName: string;
  sourceUrl: string;
  geojson: ReferenceMapGeoJson | null;
  coverage: ReferenceMapCoverage | null;
};

export type BuildReferenceMapItemsInput = {
  references: ReferenceMapReference[];
  boundaries: ReferenceBoundaryRecord[];
  geojsonByPath: Record<string, string>;
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
  zoomControl: false,
  zoomSnap: 0.25,
} as const;

export const referenceMapFitBoundsOptions = {
  padding: [16, 16] as [number, number],
  maxZoom: 10,
} as const;

export function buildReferenceMapItems({
  references,
  boundaries,
  geojsonByPath,
  parks,
  stops,
}: BuildReferenceMapItemsInput): ReferenceMapItem[] {
  const boundariesByReference = new Map(
    boundaries.map((boundary) => [boundary.reference, boundary]),
  );
  const coverageByReference = new Map(
    parks && stops
      ? deriveParkCoverage(parks, stops).map((coverage) => [coverage.reference, coverage])
      : [],
  );

  return references.map((reference) => {
    const boundary = boundariesByReference.get(reference.reference);
    const coverage = coverageByReference.get(reference.reference);
    const geojson = geojsonForBoundary(boundary, geojsonByPath);

    return {
      reference: reference.reference,
      name: reference.name,
      counties: reference.counties ?? [],
      grid: reference.grid ?? "",
      locationDesc: reference.locationDesc ?? "",
      potaUrl: reference.potaUrl ?? "",
      marker:
        markerForGeojson(geojson, boundary?.geometryKind) ?? markerForReference(reference),
      geometryKind: boundary?.geometryKind ?? "point",
      boundaryStatus: boundary?.status ?? "unknown",
      sourceName: boundary?.sourceName ?? "Parks on the Air reference coordinate",
      sourceUrl: boundary?.sourceUrl ?? reference.potaUrl ?? "",
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

function markerForGeojson(
  geojson: ReferenceMapGeoJson | null,
  geometryKind?: ReferenceMapGeometryKind,
): ReferenceMapItem["marker"] {
  if (!geojson) {
    return null;
  }

  if (geometryKind === "activation-zone") {
    const trailMarker = markerForTrailActivationZone(geojson.features);
    if (trailMarker) {
      return trailMarker;
    }
  }

  const bounds = coordinateBounds(geojson.features);
  if (!bounds) {
    return null;
  }

  return {
    latitude: (bounds.minLatitude + bounds.maxLatitude) / 2,
    longitude: (bounds.minLongitude + bounds.maxLongitude) / 2,
  };
}

function markerForTrailActivationZone(features: unknown[]): ReferenceMapItem["marker"] {
  const trailPoints = features
    .flatMap((feature) => {
      if (typeof feature !== "object" || feature === null) {
        return [];
      }

      const properties = "properties" in feature ? feature.properties : null;
      const geometry = "geometry" in feature ? feature.geometry : null;
      if (
        typeof properties !== "object" ||
        properties === null ||
        !("bufferPart" in properties) ||
        properties.bufferPart !== "vertex-cap" ||
        !("vertexIndex" in properties) ||
        typeof properties.vertexIndex !== "number"
      ) {
        return [];
      }

      const bounds = coordinateBounds(geometry);
      if (!bounds) {
        return [];
      }

      return [{
        index: properties.vertexIndex,
        latitude: (bounds.minLatitude + bounds.maxLatitude) / 2,
        longitude: (bounds.minLongitude + bounds.maxLongitude) / 2,
      }];
    })
    .sort((left, right) => left.index - right.index);

  if (trailPoints.length === 0) {
    return null;
  }
  if (trailPoints.length === 1) {
    return trailPoints[0];
  }

  const segmentLengths = trailPoints.slice(1).map((point, index) => {
    const previous = trailPoints[index];
    const latitudeRadians = ((previous.latitude + point.latitude) / 2) * Math.PI / 180;
    const longitudeDistance =
      (point.longitude - previous.longitude) * Math.cos(latitudeRadians);
    return Math.hypot(longitudeDistance, point.latitude - previous.latitude);
  });
  const midpointDistance = segmentLengths.reduce((sum, length) => sum + length, 0) / 2;
  let traveled = 0;

  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (traveled + segmentLength >= midpointDistance) {
      const start = trailPoints[index];
      const end = trailPoints[index + 1];
      const progress = segmentLength === 0 ? 0 : (midpointDistance - traveled) / segmentLength;
      return {
        latitude: start.latitude + (end.latitude - start.latitude) * progress,
        longitude: start.longitude + (end.longitude - start.longitude) * progress,
      };
    }
    traveled += segmentLength;
  }

  return trailPoints.at(-1) ?? null;
}

function coordinateBounds(value: unknown): {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
} | null {
  const bounds = {
    minLatitude: Infinity,
    maxLatitude: -Infinity,
    minLongitude: Infinity,
    maxLongitude: -Infinity,
  };

  visitCoordinates(value, (longitude, latitude) => {
    bounds.minLatitude = Math.min(bounds.minLatitude, latitude);
    bounds.maxLatitude = Math.max(bounds.maxLatitude, latitude);
    bounds.minLongitude = Math.min(bounds.minLongitude, longitude);
    bounds.maxLongitude = Math.max(bounds.maxLongitude, longitude);
  });

  if (!Number.isFinite(bounds.minLatitude) || !Number.isFinite(bounds.minLongitude)) {
    return null;
  }

  return bounds;
}

function visitCoordinates(
  value: unknown,
  visit: (longitude: number, latitude: number) => void,
): void {
  if (!Array.isArray(value)) {
    if (typeof value === "object" && value !== null) {
      Object.values(value).forEach((nested) => visitCoordinates(nested, visit));
    }
    return;
  }

  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    visit(value[0], value[1]);
    return;
  }

  value.forEach((nested) => visitCoordinates(nested, visit));
}

function geojsonForBoundary(
  boundary: ReferenceBoundaryRecord | undefined,
  geojsonByPath: Record<string, string>,
): ReferenceMapGeoJson | null {
  if (!boundary?.localGeojson || boundary.status !== "available") {
    return null;
  }

  const rawGeojson = geojsonByPath[boundary.localGeojson];
  if (!rawGeojson) {
    return null;
  }

  return JSON.parse(rawGeojson) as ReferenceMapGeoJson;
}
