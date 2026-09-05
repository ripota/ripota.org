import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { ReportedLocation } from "./classify";

export type CanonicalGeometry = ReadonlyMap<string, FeatureCollection>;

/** Fetch detailed geometry only when a location calculation needs it. */
export function createCanonicalGeometryLoader(
  url: string,
  {
    expectedReferences = [],
    fetchGeometry = globalThis.fetch,
  }: {
    expectedReferences?: readonly string[];
    fetchGeometry?: typeof fetch;
  } = {},
): () => Promise<CanonicalGeometry> {
  let pending: Promise<CanonicalGeometry> | undefined;

  return () => {
    pending ??= fetchGeometry(url, { credentials: "omit" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Canonical geometry could not load");
        const geometry = groupCanonicalGeometry(await response.json());
        // Validate completeness before caching success, so an incomplete HTTP
        // 200 response can recover on the next location-button retry.
        for (const reference of expectedReferences) {
          requireCanonicalGeometry(geometry, reference);
        }
        return geometry;
      })
      .catch((error: unknown) => {
        // A transient failure must not poison subsequent explicit retries.
        pending = undefined;
        throw error;
      });
    return pending;
  };
}

function groupCanonicalGeometry(value: unknown): CanonicalGeometry {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    value.type !== "FeatureCollection" ||
    !("features" in value) ||
    !Array.isArray(value.features) ||
    value.features.length === 0
  ) {
    throw new Error("Invalid canonical geometry collection");
  }
  rejectWebGeometry(value);

  const grouped = new Map<string, FeatureCollection>();
  for (const valueFeature of value.features) {
    rejectWebGeometry(valueFeature);
    const feature = valueFeature as Feature;
    const reference = feature?.properties?.potaReference;
    if (
      feature?.type !== "Feature" ||
      typeof reference !== "string" ||
      !/^US-\d+$/.test(reference) ||
      !validGeometry(feature.geometry)
    ) {
      throw new Error("Invalid canonical park geometry");
    }
    let collection = grouped.get(reference);
    if (!collection) {
      collection = { type: "FeatureCollection", features: [] };
      grouped.set(reference, collection);
    }
    collection.features.push(feature);
  }
  return grouped;
}

function rejectWebGeometry(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const candidate = value as { $schema?: unknown; properties?: { fidelity?: unknown } };
  if (
    candidate.properties?.fidelity === "web" ||
    (typeof candidate.$schema === "string" && candidate.$schema.includes("/schemas/web/"))
  ) {
    throw new Error("Web geometry cannot be used for location classification");
  }
}

function validGeometry(geometry: Geometry | null | undefined): boolean {
  if (!geometry) return false;
  switch (geometry.type) {
    case "Point":
      return coordinatesAtDepth(geometry.coordinates, 0);
    case "Polygon":
      return coordinatesAtDepth(geometry.coordinates, 2);
    case "MultiPolygon":
      return coordinatesAtDepth(geometry.coordinates, 3);
    default:
      return false;
  }
}

function coordinatesAtDepth(value: unknown, depth: number): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (depth === 0) return value.length >= 2 && value.every(Number.isFinite);
  if (depth === 1) {
    if (value.length < 4 || !value.every((point) => coordinatesAtDepth(point, 0))) return false;
    const first = value[0] as number[];
    const last = value[value.length - 1] as number[];
    return first.length === last.length && first.every((coordinate, index) => coordinate === last[index]);
  }
  return value.every((coordinate) => coordinatesAtDepth(coordinate, depth - 1));
}

export function requireCanonicalGeometry(
  geometry: CanonicalGeometry,
  reference: string,
): FeatureCollection {
  const collection = geometry.get(reference);
  if (!collection) throw new Error(`Missing canonical geometry for ${reference}`);
  return collection;
}

/** Keep async loading from publishing a stale fix or a stopped session. */
export function createGeometryClassificationRequest<TGeometry>(options: {
  load: () => Promise<TGeometry>;
  onLoading: () => void;
  onReady: (geometry: TGeometry, location: ReportedLocation) => void;
  onError: () => void;
}): {
  request: (location: ReportedLocation) => void;
  invalidate: () => void;
} {
  let generation = 0;
  let loaded: { geometry: TGeometry } | undefined;

  return {
    request(location) {
      const current = ++generation;
      if (loaded) {
        options.onReady(loaded.geometry, location);
        return;
      }
      options.onLoading();
      void options.load().then(
        (geometry) => {
          loaded = { geometry };
          if (current === generation) options.onReady(geometry, location);
        },
        () => {
          if (current === generation) options.onError();
        },
      );
    },
    invalidate() {
      generation += 1;
    },
  };
}
