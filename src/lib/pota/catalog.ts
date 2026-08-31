import catalogData from "@ripota/parks/catalog.json";

import type {
  ReferenceBoundaryRecord,
  ReferenceMapGeoJson,
} from "../reference-map";
import type { PotaReference } from "./references";

export type ParksCatalogReference = PotaReference & {
  status: "available" | "point-only";
  geometryKind: "boundary" | "activation-zone" | "point";
  source: {
    name: string;
    url: string;
    query?: string;
    featureIds: Array<string | number>;
    notes?: string;
  };
  geojson: ReferenceMapGeoJson;
};

export type ParksCatalog = {
  schemaVersion: 1;
  referenceCount: number;
  featureCount: number;
  references: ParksCatalogReference[];
};

export const parksCatalog = catalogData as unknown as ParksCatalog;

export const riReferences: PotaReference[] = parksCatalog.references.map(
  ({ status: _status, geometryKind: _geometryKind, source: _source, geojson: _geojson, ...reference }) =>
    reference,
);

export const referenceBoundaries: ReferenceBoundaryRecord[] =
  parksCatalog.references.map((record) => ({
    reference: record.reference,
    status: record.status,
    geometryKind: record.geometryKind,
    sourceName: record.source.name,
    sourceUrl: record.source.url,
    sourceFeatureIds: record.source.featureIds,
    localGeojson: `./boundaries/${record.reference.toLowerCase()}.geojson`,
    ...(record.source.notes ? { notes: record.source.notes } : {}),
  }));

export const referenceGeojsonByPath: Record<string, ReferenceMapGeoJson> =
  Object.fromEntries(
    parksCatalog.references.map((record) => [
      `./boundaries/${record.reference.toLowerCase()}.geojson`,
      record.geojson,
    ]),
  );
