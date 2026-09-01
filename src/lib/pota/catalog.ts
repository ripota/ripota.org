import catalogData from "@ripota/parks/catalog.json";
import { type PotaReference } from "@ripota/parks";

import type {
  ReferenceBoundaryRecord,
  ReferenceMapGeoJson,
} from "../reference-map";

export type ParksCatalogReference = PotaReference & {
  status: "available" | "point-only";
  geometryKind: "boundary" | "activation-zone" | "point";
  source: {
    name: string;
    url: string;
    query?: string;
    featureIds: Array<string | number>;
    artifact: string;
    notes?: string;
  };
  geojson: ReferenceMapGeoJson & {
    $schema: string;
    properties: {
      schemaVersion: 2;
      geometryRole: "display";
      geometryKind: "boundary" | "activation-zone" | "point";
      potaReference: string;
      potaName: string;
      sourceName: string;
      sourceUrl: string;
      sourceFeatureIds: Array<string | number>;
      [key: string]: unknown;
    };
  };
};

export type ParksCatalog = {
  $schema: string;
  schemaVersion: 2;
  geometryRole: "display";
  referenceCount: number;
  featureCount: number;
  sourceFeatureCount: number;
  references: ParksCatalogReference[];
};

export const parksCatalog = catalogData as unknown as ParksCatalog;

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
