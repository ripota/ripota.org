import type { DisplayReference, GeoJsonFeatureCollection } from "@ripota/parks/types";
import { describe, expect, it } from "vitest";
import {
  buildReferenceMapItems,
  coverageStatusLabels,
  displayedReferenceMapLegendItems,
  referenceMapFitBoundsOptions,
  referenceMapLeafletOptions,
  referenceMapLegendItems,
  referenceMapStatusColors,
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

const displayReferences: readonly DisplayReference[] = [
  {
    reference: "US-0001",
    status: "available",
    geometryKind: "boundary",
    displayPoint: { latitude: 41.5, longitude: -71.4, source: "official" },
    bbox: [-71.41, 41.49, -71.39, 41.51],
    artifact: "@ripota/parks/boundaries/us-0001.geojson",
  },
  {
    reference: "US-0002",
    status: "point-only",
    geometryKind: "point",
    displayPoint: { latitude: 41.6, longitude: -71.5, source: "official" },
  },
];

const geojsonByReference: Readonly<Record<string, GeoJsonFeatureCollection>> = {
  "US-0001": {
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
  },
  "US-0002": {
    type: "FeatureCollection",
    properties: { potaReference: "US-0002" },
    features: [],
  },
};

describe("buildReferenceMapItems", () => {
  it("adds boundaries and centroid markers for every reference", () => {
    const items = buildReferenceMapItems({
      references,
      displayReferences,
      geojsonByReference,
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

  it("uses published display bounds for available boundary markers before reference coordinates", () => {
    const items = buildReferenceMapItems({
      references: [
        {
          ...references[0],
          latitude: 38.9,
          longitude: -77,
        },
      ],
      displayReferences: [displayReferences[0]],
      geojsonByReference,
    });

    expect(items[0].marker).toEqual({
      latitude: 41.5,
      longitude: -71.4,
    });
  });

  it("can use the official reference coordinate for directory markers", () => {
    const items = buildReferenceMapItems({
      references: [
        {
          ...references[0],
          latitude: 38.9,
          longitude: -77,
        },
      ],
      displayReferences: [displayReferences[0]],
      geojsonByReference,
      markerPlacement: "reference-coordinate",
    });

    expect(items[0].marker).toEqual({
      latitude: 41.5,
      longitude: -71.4,
    });
  });

  it("uses a reviewed map point without modifying official coordinates", () => {
    const official = { ...references[0], latitude: 41.312, longitude: -73.9709 };
    const [item] = buildReferenceMapItems({
      references: [official],
      displayReferences: [{ ...displayReferences[0], displayPoint: {
        latitude: 41.7445710002769, longitude: -71.594458000176, source: "reviewed",
      } }],
      markerPlacement: "reference-coordinate",
    });
    expect(item.marker).toMatchObject({ latitude: 41.7445710002769, longitude: -71.594458000176 });
    expect(official).toMatchObject({ latitude: 41.312, longitude: -73.9709 });
    expect(item.geojson).toBeNull();
  });

  it("centers activation-zone markers using metadata even without geometry", () => {
    const [item] = buildReferenceMapItems({
      references,
      displayReferences: [{ ...displayReferences[0], geometryKind: "activation-zone", bbox: [-71.6, 41.4, -71.4, 41.5] }],
    });
    expect(item.marker).toEqual({ latitude: 41.45, longitude: -71.5 });
    expect(item.geojson).toBeNull();
  });

  it("never traverses coordinate payloads to place markers", () => {
    const [item] = buildReferenceMapItems({
      references,
      displayReferences,
      geojsonByReference: { "US-0001": {
        type: "FeatureCollection",
        get features(): never { throw new Error("Coordinates must stay opt-in"); },
      } },
    });
    expect(item.marker).toEqual({ latitude: 41.5, longitude: -71.4 });
    expect(item.bbox).toEqual(displayReferences[0].bbox);
  });

  it("keeps unknown, unreviewed fallback, and reviewed point-only states distinct", () => {
    const [unknown] = buildReferenceMapItems({ references, displayReferences: [] });
    expect(unknown).toMatchObject({ boundaryStatus: "unknown", geometryKind: "point", geojson: null });
    const [fallback, point] = buildReferenceMapItems({
      references,
      displayReferences: [{ ...displayReferences[0], status: "research-needed", geometryKind: "point" }, displayReferences[1]],
      geojsonByReference,
    });
    expect(fallback).toMatchObject({ boundaryStatus: "research-needed", geometryKind: "point", geojson: null });
    expect(point).toMatchObject({ boundaryStatus: "point-only", geometryKind: "point", geojson: null });
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
      displayReferences,
      geojsonByReference,
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
    expect(referenceMapLeafletOptions.scrollWheelZoom).toBe(false);
    expect(referenceMapLeafletOptions.wheelPxPerZoomLevel).toBe(120);
    expect(referenceMapFitBoundsOptions.padding).toEqual([16, 16]);
    expect(referenceMapFitBoundsOptions.maxZoom).toBe(10);
  });
});

describe("reference map legend", () => {
  it("groups related event coverage states into concise labels", () => {
    expect(referenceMapLegendItems).toEqual([
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
    ]);
  });

  it("shows completed only when completed coverage is present", () => {
    expect(displayedReferenceMapLegendItems(["uncovered", "scheduled"]).map((item) => item.label)).toEqual([
      "Help wanted",
      "Scheduled",
    ]);
    expect(displayedReferenceMapLegendItems(["completed"]).map((item) => item.label)).toEqual([
      "Help wanted",
      "Scheduled",
      "Completed",
    ]);
  });
});
