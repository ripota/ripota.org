import pointToPolygonDistance from "@turf/point-to-polygon-distance";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";

export type LocationGeometryKind =
  | "boundary"
  | "activation-zone"
  | "point";

export type ReportedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export type LocationClassificationStatus =
  | "inside"
  | "outside"
  | "near-boundary"
  | "unavailable";

export type LocationClassification = {
  status: LocationClassificationStatus;
  geometryKind: LocationGeometryKind;
  accuracyMeters: number;
  signedDistanceMeters: number | null;
};

type AreaFeature = Feature<Polygon | MultiPolygon>;

const DISTANCE_EPSILON_METERS = 0.01;

function areaFeatures(geojson: FeatureCollection): AreaFeature[] {
  return geojson.features.filter(
    (feature): feature is AreaFeature =>
      feature.geometry?.type === "Polygon" ||
      feature.geometry?.type === "MultiPolygon",
  );
}

function distanceToArea(
  location: ReportedLocation,
  features: AreaFeature[],
): number {
  const distances = features.map((feature) =>
    pointToPolygonDistance(
      [location.longitude, location.latitude],
      feature,
      { units: "meters", method: "geodesic" },
    ),
  );

  const insideDistances = distances.filter((distance) => distance <= 0);

  return insideDistances.length > 0
    ? Math.min(...insideDistances)
    : Math.min(...distances);
}

/**
 * Classify a browser-reported position against mapped park geometry.
 *
 * The browser's accuracy value is the radius of uncertainty around the
 * reported point. A result is only definite when that whole uncertainty
 * circle is on one side of the mapped boundary.
 */
export function classifyLocation(
  location: ReportedLocation,
  geojson: FeatureCollection,
  geometryKind: LocationGeometryKind,
): LocationClassification {
  const accuracyMeters = Number.isFinite(location.accuracy)
    ? Math.max(0, location.accuracy)
    : 0;
  const features = areaFeatures(geojson);

  if (geometryKind === "point" || features.length === 0) {
    return {
      status: "unavailable",
      geometryKind,
      accuracyMeters,
      signedDistanceMeters: null,
    };
  }

  const signedDistanceMeters = distanceToArea(location, features);

  if (
    signedDistanceMeters <
    -(accuracyMeters + DISTANCE_EPSILON_METERS)
  ) {
    return {
      status: "inside",
      geometryKind,
      accuracyMeters,
      signedDistanceMeters,
    };
  }

  if (signedDistanceMeters > accuracyMeters + DISTANCE_EPSILON_METERS) {
    return {
      status: "outside",
      geometryKind,
      accuracyMeters,
      signedDistanceMeters,
    };
  }

  return {
    status: "near-boundary",
    geometryKind,
    accuracyMeters,
    signedDistanceMeters,
  };
}
