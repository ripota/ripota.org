import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import references from "../../src/data/ri-references.json" with { type: "json" };

const rootDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataDirectory = join(rootDirectory, "src/data");
const boundaryDirectory = join(dataDirectory, "boundaries");

const sources = {
  fws: {
    name: "U.S. Fish and Wildlife Service National Wildlife Refuge System Boundaries",
    url: "https://services.arcgis.com/QVENGdaPbd4LUkLV/arcgis/rest/services/National_Wildlife_Refuge_System_Boundaries/FeatureServer/0",
    idField: "OBJECTID",
  },
  nps: {
    name: "National Park Service Land Resources Division Boundary and Tract Data Service",
    url: "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2",
    idField: "OBJECTID",
  },
  ridem: {
    name: "Rhode Island DEM State Conservation Land",
    url: "https://risegis.ri.gov/hosting/rest/services/RIDEM/State_Conservation_Land/MapServer/0",
    idField: "OBJECTID",
  },
  waroRoute: {
    name: "Washington Rochambeau National Historic Trail Route",
    url: "https://services.arcgis.com/hRUr1F8lE8Jq2uJo/arcgis/rest/services/Washington_Rochambeau_National_Historic_Trail_Route/FeatureServer/2",
    idField: "OBJECTID",
  },
  potaReferenceCoordinate: {
    name: "Parks on the Air reference coordinate",
    url: "https://pota.app/#/park",
    idField: "reference",
  },
};

const potaTrailActivationRule = {
  bufferDistanceFeet: 100,
  bufferDistanceMeters: 30.48,
  sourceUrl:
    "https://docs.pota.app/docs/activator_reference/activator_guide-english.html#special-considerations-for-trails",
};

const availableBoundaryQueries = [
  ["US-0513", "fws", "ORGNAME = 'BLOCK ISLAND NATIONAL WILDLIFE REFUGE'"],
  ["US-0514", "fws", "ORGNAME = 'JOHN H. CHAFEE NATIONAL WILDLIFE REFUGE'"],
  ["US-0515", "fws", "ORGNAME = 'NINIGRET NATIONAL WILDLIFE REFUGE'"],
  ["US-0516", "fws", "ORGNAME = 'SACHUEST POINT NATIONAL WILDLIFE REFUGE'"],
  ["US-0517", "fws", "ORGNAME = 'TRUSTOM POND NATIONAL WILDLIFE REFUGE'"],
  ["US-0789", "nps", "UNIT_CODE = 'ROWI'"],
  ["US-10541", "ridem", "DEM_AREA = 'Gull Cove Fishing Access'"],
  ["US-10542", "ridem", "DEM_AREA = 'Camp Cronin Fishing Access'"],
  ["US-10543", "ridem", "DEM_AREA = 'Patriot Park'"],
  ["US-10544", "ridem", "DEM_AREA = 'Jerimoth Hill'"],
  ["US-10545", "ridem", "DEM_AREA = 'Hillsdale'"],
  ["US-10546", "ridem", "DEM_AREA = 'Eight Rod Farm Management Area'"],
  [
    "US-10547",
    "ridem",
    "DEM_AREA = 'Spring Lake Fishing Access' OR DEM_AREA = 'Silver Spring Management Area'",
  ],
  ["US-10548", "ridem", "DEM_AREA = 'Barber Pond Fishing Access'"],
  ["US-2868", "ridem", "DEM_AREA = 'Beavertail State Park'"],
  ["US-2870", "ridem", "DEM_AREA = 'Brenton Point State Park'"],
  [
    "US-2871",
    "ridem",
    "DEM_AREA LIKE 'Burlingame State Park%' OR DEM_AREA = 'Burlingame Management Area'",
  ],
  ["US-2872", "ridem", "DEM_AREA = 'Colt State Park'"],
  ["US-2873", "ridem", "DEM_AREA = 'Fishermans Memorial State Park Campground'"],
  ["US-2874", "ridem", "DEM_AREA = 'Fort Adams State Park'"],
  ["US-2875", "ridem", "DEM_AREA = 'Fort Wetherill'"],
  ["US-2876", "ridem", "DEM_AREA = 'Goddard State Park'"],
  [
    "US-2877",
    "ridem",
    "DEM_AREA = 'Haines Memorial Park' OR DEM_AREA = 'Haines Memorial State Park Boat Ramp'",
  ],
  ["US-2878", "ridem", "DEM_AREA = 'Lincoln Woods State Park'"],
  ["US-2879", "ridem", "DEM_AREA = 'Rocky Point State Park'"],
  ["US-2880", "ridem", "DEM_AREA = 'Snake Den State Park'"],
  ["US-2881", "ridem", "DEM_AREA = 'World War II Veterans Memorial State Park'"],
  ["US-5482", "ridem", "DEM_AREA = 'Wickaboxet Management Area'"],
  ["US-5483", "ridem", "DEM_AREA = 'Lincoln Woods State Park'"],
  ["US-5484", "ridem", "DEM_AREA = 'George Washington Management Area'"],
  ["US-6979", "ridem", "DEM_AREA = 'Arcadia Management Area'"],
  ["US-6981", "ridem", "DEM_AREA = 'Great Swamp Management Area'"],
  ["US-6982", "ridem", "DEM_AREA = 'Big River Management Area'"],
  ["US-6983", "ridem", "DEM_AREA = 'Woody Hill Management Area'"],
  ["US-6984", "ridem", "DEM_AREA = 'Black Hut Management Area'"],
  ["US-6985", "ridem", "DEM_AREA = 'Round Top Management Area'"],
  ["US-6986", "ridem", "DEM_AREA = 'Simmons Mill Management Area'"],
  ["US-6987", "ridem", "DEM_AREA = 'Cocumcussoc'"],
  ["US-6988", "ridem", "DEM_AREA = 'Grills Preserve'"],
  ["US-6989", "ridem", "DEM_AREA = 'Black Farm Management Area'"],
  ["US-6990", "ridem", "DEM_AREA = 'Nicholas Farm Management Area'"],
  ["US-6991", "ridem", "DEM_AREA = 'Rockville Management Area'"],
  ["US-6992", "ridem", "DEM_AREA = 'J.L. Curran'"],
  ["US-7508", "ridem", "NAME = 'Pulaski State Park'"],
  ["US-7518", "ridem", "NAME = 'Kimball Refuge'"],
  ["US-7714", "ridem", "DEM_AREA = 'Buck Hill Management Area' OR DEM_AREA = 'Buck HIll'"],
  ["US-7715", "ridem", "DEM_AREA = 'Durfee Hill Management Area'"],
  ["US-7716", "ridem", "DEM_AREA = 'Carolina Management Area'"],
  ["US-7717", "ridem", "DEM_AREA = 'Charlestown Breachway State Park Campground'"],
  ["US-7718", "ridem", "NAME = 'East Matunuck State Beach'"],
  ["US-7719", "ridem", "NAME = 'Misquamicut State Beach'"],
  ["US-7720", "ridem", "DEM_AREA = 'Roger Wheeler Beach State Park'"],
  ["US-7721", "ridem", "DEM_AREA = 'Salty Brine Beach State Park'"],
  ["US-7722", "ridem", "DEM_AREA = 'Scarborough Beach State Park'"],
  ["US-7723", "ridem", "DEM_AREA = 'John H. Chafee Rome Point Preserve'"],
  ["US-7865", "ridem", "DEM_AREA = 'East Beach State Park'"],
  ["US-7971", "nps", "UNIT_CODE = 'BLRV'"],
  ["US-8293", "ridem", "DEM_AREA = 'Seapowet Marsh Management Area'"],
];

const bufferedTrailQueries = new Map([
  [
    "US-4582",
    {
      sourceKey: "waroRoute",
      where: "Name = 'Trail in RI'",
    },
  ],
]);

const pointOnlyReferences = new Set(["US-6980"]);

const researchNeeded = new Map([
  [
    "US-2869",
    "RI DEM has many Blackstone River conservation and bikeway parcels, but no clear Blackstone River State Park boundary match in the State Conservation Land layer.",
  ],
  [
    "US-6980",
    "No reviewed Beach Pond Wildlife Management Area polygon was found in RI DEM State Conservation Land. RI Parks lists Beach Pond as a DEM site managed from the Arcadia Management Area context, and the POTA coordinate is 41.5739, -71.7864.",
  ],
]);

const referenceById = new Map(references.map((reference) => [reference.reference, reference]));
const queryByReference = new Map(
  availableBoundaryQueries.map(([reference, sourceKey, where]) => [
    reference,
    { sourceKey, where },
  ]),
);

function queryUrl(source, where) {
  const url = new URL(`${source.url}/query`);
  url.search = new URLSearchParams({
    where,
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  }).toString();
  return url;
}

function featureFilePath(reference) {
  return `./boundaries/${reference.toLowerCase()}.geojson`;
}

function sortFeatureProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

async function fetchBoundary(reference, query) {
  const source = sources[query.sourceKey];
  const url = queryUrl(source, query.where);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${reference}: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();

  if (geojson.type !== "FeatureCollection" || geojson.features.length === 0) {
    throw new Error(`No GeoJSON features returned for ${reference}`);
  }

  geojson.properties = {
    geometryKind: "boundary",
    potaReference: reference,
    potaName: referenceById.get(reference)?.name,
    sourceName: source.name,
    sourceUrl: source.url,
    sourceQuery: query.where,
  };
  geojson.features = geojson.features
    .map((feature) => ({
      ...feature,
      properties: sortFeatureProperties(feature.properties),
    }))
    .sort((left, right) =>
      String(left.properties[source.idField]).localeCompare(
        String(right.properties[source.idField]),
        undefined,
        { numeric: true },
      ),
    );

  const sourceFeatureIds = geojson.features.map(
    (feature) => feature.properties[source.idField],
  );

  return {
    geojson,
    manifestEntry: {
      reference,
      status: "available",
      geometryKind: "boundary",
      sourceName: source.name,
      sourceUrl: source.url,
      sourceQuery: query.where,
      sourceFeatureIds,
      localGeojson: featureFilePath(reference),
    },
  };
}

function getLineStrings(geometry) {
  if (geometry.type === "LineString") {
    return [geometry.coordinates];
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates;
  }

  throw new Error(`Unsupported trail geometry type: ${geometry.type}`);
}

function projectionFor(coordinates) {
  const allPoints = coordinates.flat();
  const centerLongitude =
    allPoints.reduce((total, point) => total + point[0], 0) / allPoints.length;
  const centerLatitude =
    allPoints.reduce((total, point) => total + point[1], 0) / allPoints.length;
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude =
    metersPerDegreeLatitude * Math.cos((centerLatitude * Math.PI) / 180);

  return {
    project([longitude, latitude]) {
      return [
        (longitude - centerLongitude) * metersPerDegreeLongitude,
        (latitude - centerLatitude) * metersPerDegreeLatitude,
      ];
    },
    unproject([x, y]) {
      return [
        x / metersPerDegreeLongitude + centerLongitude,
        y / metersPerDegreeLatitude + centerLatitude,
      ];
    },
  };
}

function circleRing(center, radiusMeters, projection, steps = 24) {
  const projectedCenter = projection.project(center);
  const ring = [];

  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    ring.push(
      projection.unproject([
        projectedCenter[0] + Math.cos(angle) * radiusMeters,
        projectedCenter[1] + Math.sin(angle) * radiusMeters,
      ]),
    );
  }

  return ring;
}

function segmentRing(start, end, radiusMeters, projection) {
  const [startX, startY] = projection.project(start);
  const [endX, endY] = projection.project(end);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const length = Math.hypot(deltaX, deltaY);

  if (length === 0) {
    return null;
  }

  const normalX = (-deltaY / length) * radiusMeters;
  const normalY = (deltaX / length) * radiusMeters;

  return [
    projection.unproject([startX + normalX, startY + normalY]),
    projection.unproject([endX + normalX, endY + normalY]),
    projection.unproject([endX - normalX, endY - normalY]),
    projection.unproject([startX - normalX, startY - normalY]),
    projection.unproject([startX + normalX, startY + normalY]),
  ];
}

function bufferLineStrings(lineStrings, radiusMeters) {
  const projection = projectionFor(lineStrings);
  const features = [];

  for (const lineString of lineStrings) {
    for (let index = 0; index < lineString.length - 1; index += 1) {
      const ring = segmentRing(
        lineString[index],
        lineString[index + 1],
        radiusMeters,
        projection,
      );

      if (ring) {
        features.push({
          type: "Feature",
          properties: { bufferPart: "segment", segmentIndex: index },
          geometry: {
            type: "Polygon",
            coordinates: [ring],
          },
        });
      }
    }

    for (let index = 0; index < lineString.length; index += 1) {
      features.push({
        type: "Feature",
        properties: { bufferPart: "vertex-cap", vertexIndex: index },
        geometry: {
          type: "Polygon",
          coordinates: [circleRing(lineString[index], radiusMeters, projection)],
        },
      });
    }
  }

  return features;
}

async function fetchBufferedTrail(reference, query) {
  const source = sources[query.sourceKey];
  const url = queryUrl(source, query.where);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${reference}: ${response.status} ${response.statusText}`);
  }

  const routeGeojson = await response.json();

  if (routeGeojson.type !== "FeatureCollection" || routeGeojson.features.length === 0) {
    throw new Error(`No route features returned for ${reference}`);
  }

  const routeFeatures = routeGeojson.features;
  const sourceFeatureIds = routeFeatures.map(
    (feature) => feature.properties[source.idField],
  );
  const lineStrings = routeFeatures.flatMap((feature) =>
    getLineStrings(feature.geometry),
  );

  return {
    geojson: {
      type: "FeatureCollection",
      properties: {
        geometryKind: "activation-zone",
        potaReference: reference,
        potaName: referenceById.get(reference)?.name,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceQuery: query.where,
        sourceFeatureIds,
        sourceGeometryType: routeGeojson.features[0].geometry.type,
        bufferDistanceFeet: potaTrailActivationRule.bufferDistanceFeet,
        bufferDistanceMeters: potaTrailActivationRule.bufferDistanceMeters,
        bufferRuleSourceUrl: potaTrailActivationRule.sourceUrl,
      },
      features: bufferLineStrings(
        lineStrings,
        potaTrailActivationRule.bufferDistanceMeters,
      ),
    },
    manifestEntry: {
      reference,
      status: "available",
      geometryKind: "activation-zone",
      sourceName: source.name,
      sourceUrl: source.url,
      sourceQuery: query.where,
      sourceFeatureIds,
      localGeojson: featureFilePath(reference),
      notes:
        "Buffered from the NPS Rhode Island route segment using POTA's 100-foot trail activation-zone rule.",
    },
  };
}

function pointOnlyGeojson(reference) {
  const potaReference = referenceById.get(reference);

  if (!potaReference) {
    throw new Error(`Unknown POTA reference: ${reference}`);
  }

  const source = sources.potaReferenceCoordinate;

  return {
    geojson: {
      type: "FeatureCollection",
      properties: {
        geometryKind: "point",
        potaReference: reference,
        potaName: potaReference.name,
        sourceName: source.name,
        sourceUrl: `${source.url}/${reference}`,
        notes: researchNeeded.get(reference),
      },
      features: [
        {
          type: "Feature",
          properties: {
            reference,
            name: potaReference.name,
            grid: potaReference.grid,
          },
          geometry: {
            type: "Point",
            coordinates: [potaReference.longitude, potaReference.latitude],
          },
        },
      ],
    },
    manifestEntry: {
      reference,
      status: "point-only",
      geometryKind: "point",
      sourceName: source.name,
      sourceUrl: `${source.url}/${reference}`,
      sourceFeatureIds: [reference],
      localGeojson: featureFilePath(reference),
      notes: researchNeeded.get(reference),
    },
  };
}

await mkdir(boundaryDirectory, { recursive: true });

const manifest = [];

for (const reference of references) {
  const query = queryByReference.get(reference.reference);

  if (query) {
    const { geojson, manifestEntry } = await fetchBoundary(reference.reference, query);
    await writeFile(
      join(boundaryDirectory, `${reference.reference.toLowerCase()}.geojson`),
      `${JSON.stringify(geojson, null, 2)}\n`,
    );
    manifest.push(manifestEntry);
    continue;
  }

  const bufferedTrailQuery = bufferedTrailQueries.get(reference.reference);

  if (bufferedTrailQuery) {
    const { geojson, manifestEntry } = await fetchBufferedTrail(
      reference.reference,
      bufferedTrailQuery,
    );
    await writeFile(
      join(boundaryDirectory, `${reference.reference.toLowerCase()}.geojson`),
      `${JSON.stringify(geojson, null, 2)}\n`,
    );
    manifest.push(manifestEntry);
    continue;
  }

  if (pointOnlyReferences.has(reference.reference)) {
    const { geojson, manifestEntry } = pointOnlyGeojson(reference.reference);
    await writeFile(
      join(boundaryDirectory, `${reference.reference.toLowerCase()}.geojson`),
      `${JSON.stringify(geojson, null, 2)}\n`,
    );
    manifest.push(manifestEntry);
    continue;
  }

  manifest.push({
    reference: reference.reference,
    status: "research-needed",
    sourceName: "Not yet matched to an authoritative boundary source",
    sourceUrl: "https://docs.pota.app/",
    notes: researchNeeded.get(reference.reference) ?? "No authoritative boundary source has been reviewed for this reference yet.",
  });
}

await writeFile(
  join(dataDirectory, "ri-reference-boundaries.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Wrote ${manifest.filter((entry) => entry.status === "available").length} available boundary records.`);
