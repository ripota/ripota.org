import type { FeatureCollection } from "geojson";
import {
  classifyLocation,
  type LocationClassificationStatus,
  type LocationGeometryKind,
  type ReportedLocation,
} from "./classify";

export type GlobalLocationPark = {
  reference: string;
  name: string;
  geometryKind: LocationGeometryKind;
  geojson: FeatureCollection | null;
  marker: {
    latitude: number;
    longitude: number;
  } | null;
};

export type GlobalLocationMatch = {
  reference: string;
  name: string;
  geometryKind: LocationGeometryKind;
  status: LocationClassificationStatus;
  distanceMeters: number;
};

export type GlobalLocationResults = {
  inside: GlobalLocationMatch[];
  uncertain: GlobalLocationMatch[];
  nearby: GlobalLocationMatch[];
};

const emptyGeojson: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export function findGlobalLocationMatches(
  location: ReportedLocation,
  parks: GlobalLocationPark[],
  nearbyLimit = 3,
): GlobalLocationResults {
  const matches = parks.map((park): GlobalLocationMatch => {
    const result = classifyLocation(
      location,
      park.geojson ?? emptyGeojson,
      park.geometryKind,
    );
    const markerDistance = park.marker
      ? distanceBetweenMeters(location, park.marker)
      : Number.POSITIVE_INFINITY;
    const distanceMeters =
      result.signedDistanceMeters === null
        ? markerDistance
        : Math.abs(result.signedDistanceMeters);

    return {
      reference: park.reference,
      name: park.name,
      geometryKind: park.geometryKind,
      status: result.status,
      distanceMeters,
    };
  });

  const inside = matches
    .filter((match) => match.status === "inside")
    .sort(byReference);
  const uncertain = matches
    .filter((match) => match.status === "near-boundary")
    .sort(byDistanceThenReference);
  const nearby = matches
    .filter(
      (match) =>
        match.status !== "inside" &&
        match.status !== "near-boundary" &&
        Number.isFinite(match.distanceMeters),
    )
    .sort(byDistanceThenReference)
    .slice(0, Math.max(0, nearbyLimit));

  return { inside, uncertain, nearby };
}

export function globalLocationSummary(
  results: GlobalLocationResults,
  accuracyMeters: number,
): { primary: string; secondary: string; tone: "inside" | "uncertain" | "neutral" } {
  const accuracy = `Accuracy ±${Math.round(Math.max(0, accuracyMeters))} m`;

  if (results.inside.length > 0) {
    return {
      primary: `Inside ${results.inside.length} mapped ${results.inside.length === 1 ? "area" : "areas"}`,
      secondary: accuracy,
      tone: "inside",
    };
  }

  if (results.uncertain.length > 0) {
    return {
      primary: `Near ${results.uncertain.length} mapped ${results.uncertain.length === 1 ? "boundary" : "boundaries"}`,
      secondary: `Your ${accuracy.toLowerCase()} crosses the mapped edge.`,
      tone: "uncertain",
    };
  }

  return {
    primary: "No mapped RI park contains this location",
    secondary: accuracy,
    tone: "neutral",
  };
}

export function formatLocationDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) {
    return `${Math.max(0, Math.round(distanceMeters))} m away`;
  }

  return `${(distanceMeters / 1_000).toFixed(distanceMeters < 10_000 ? 1 : 0)} km away`;
}

function byReference(left: GlobalLocationMatch, right: GlobalLocationMatch): number {
  return left.reference.localeCompare(right.reference);
}

function byDistanceThenReference(
  left: GlobalLocationMatch,
  right: GlobalLocationMatch,
): number {
  return (
    left.distanceMeters - right.distanceMeters ||
    left.reference.localeCompare(right.reference)
  );
}

function distanceBetweenMeters(
  left: Pick<ReportedLocation, "latitude" | "longitude">,
  right: { latitude: number; longitude: number },
): number {
  const earthRadiusMeters = 6_371_008.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));

  return (
    earthRadiusMeters *
    2 *
    Math.atan2(
      Math.sqrt(boundedHaversine),
      Math.sqrt(1 - boundedHaversine),
    )
  );
}
