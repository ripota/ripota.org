import { describe, expect, it } from "vitest";
import {
  buildReferenceMapItems,
  coverageStatusLabels,
  referenceMapFitBoundsOptions,
  referenceMapLeafletOptions,
  referenceMapStatusColors,
  type ReferenceBoundaryRecord,
} from "./reference-map";
import type { PublicActivationStop, PublicParkSummary } from "./activate-ri/types";

const references = [
  {
    reference: "US-0001",
    name: "Boundary Park",
    latitude: 41.5,
    longitude: -71.4,
    grid: "FN41",
    counties: ["Kent County"],
    locationDesc: "US-RI",
    potaUrl: "https://pota.app/#/park/US-0001",
  },
  {
    reference: "US-0002",
    name: "Point Park",
    latitude: 41.6,
    longitude: -71.5,
    grid: "FN41",
    counties: ["Washington County"],
    locationDesc: "US-RI",
    potaUrl: "https://pota.app/#/park/US-0002",
  },
];

const boundaries: ReferenceBoundaryRecord[] = [
  {
    reference: "US-0001",
    status: "available",
    geometryKind: "boundary",
    sourceName: "Local source",
    sourceUrl: "https://example.com/boundary",
    sourceFeatureIds: [1],
    localGeojson: "./boundaries/us-0001.geojson",
  },
  {
    reference: "US-0002",
    status: "point-only",
    geometryKind: "point",
    sourceName: "POTA coordinate",
    sourceUrl: "https://pota.app/#/park/US-0002",
    sourceFeatureIds: ["US-0002"],
    localGeojson: "./boundaries/us-0002.geojson",
  },
];

const geojsonByPath = {
  "./boundaries/us-0001.geojson": JSON.stringify({
    type: "FeatureCollection",
    properties: { potaReference: "US-0001" },
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-71.41, 41.49],
              [-71.39, 41.49],
              [-71.39, 41.51],
              [-71.41, 41.51],
              [-71.41, 41.49],
            ],
          ],
        },
      },
    ],
  }),
  "./boundaries/us-0002.geojson": JSON.stringify({
    type: "FeatureCollection",
    properties: { potaReference: "US-0002" },
    features: [],
  }),
};

describe("buildReferenceMapItems", () => {
  it("adds boundaries and centroid markers for every reference", () => {
    const items = buildReferenceMapItems({
      references,
      boundaries,
      geojsonByPath,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      reference: "US-0001",
      name: "Boundary Park",
      marker: { latitude: 41.5, longitude: -71.4 },
      geometryKind: "boundary",
    });
    expect(items[0].geojson?.type).toBe("FeatureCollection");
    expect(items[1]).toMatchObject({
      reference: "US-0002",
      geometryKind: "point",
      geojson: null,
    });
  });

  it("uses GeoJSON bounds for available boundary markers before reference coordinates", () => {
    const items = buildReferenceMapItems({
      references: [
        {
          ...references[0],
          latitude: 38.9,
          longitude: -77,
        },
      ],
      boundaries: [boundaries[0]],
      geojsonByPath,
    });

    expect(items[0].marker).toEqual({
      latitude: 41.5,
      longitude: -71.4,
    });
  });

  it("attaches derived coverage and sorted stops when event data is provided", () => {
    const parks: PublicParkSummary[] = references.map((reference) => ({
      reference: reference.reference,
      name: reference.name,
      counties: reference.counties,
      latitude: reference.latitude,
      longitude: reference.longitude,
      grid: reference.grid,
      potaUrl: reference.potaUrl,
    }));
    const stops: PublicActivationStop[] = [
      {
        id: "late",
        parkReference: "US-0001",
        plannedDate: "2026-09-12",
        startTime: "15:00",
        endTime: "18:00",
        activatorCallsign: "K1LATE",
        bands: ["20m"],
        modes: ["SSB"],
        publicNotes: "Afternoon",
        status: "scheduled",
      },
      {
        id: "early",
        parkReference: "US-0001",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "12:00",
        activatorCallsign: "K1EARLY",
        bands: ["40m"],
        modes: ["CW"],
        publicNotes: "",
        status: "scheduled",
      },
    ];

    const [item] = buildReferenceMapItems({
      references,
      boundaries,
      geojsonByPath,
      parks,
      stops,
    });

    expect(item.coverage?.status).toBe("multiple-scheduled");
    expect(item.coverage?.label).toBe(coverageStatusLabels["multiple-scheduled"]);
    expect(item.coverage?.color).toBe(referenceMapStatusColors["multiple-scheduled"]);
    expect(item.coverage?.stops.map((stop) => stop.activatorCallsign)).toEqual([
      "K1EARLY",
      "K1LATE",
    ]);
  });
});

describe("reference map viewport configuration", () => {
  it("allows fitBounds to choose a tighter fractional zoom without clipping points", () => {
    expect(referenceMapLeafletOptions.zoomSnap).toBeLessThan(1);
    expect(referenceMapFitBoundsOptions.padding).toEqual([16, 16]);
    expect(referenceMapFitBoundsOptions.maxZoom).toBe(10);
  });
});
