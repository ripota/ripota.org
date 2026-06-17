# Activate RI 2026 Reference Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared boundary-first Rhode Island POTA reference map for the homepage, Activate RI overview, and volunteer signup flow.

**Architecture:** Add a tested TypeScript adapter that joins reference metadata, boundary metadata, GeoJSON, and optional event coverage into serializable map items. Render those items through one Astro/Leaflet component with `home`, `coverage`, and `volunteer` variants. Use a browser custom event so the volunteer map can immediately add a selected park to the existing form without submitting it.

**Tech Stack:** Astro, TypeScript, Leaflet, Vitest, existing public Activate RI JSON exports.

---

### Task 1: Map Data Adapter

**Files:**
- Create: `src/lib/reference-map.ts`
- Test: `src/lib/reference-map.test.ts`

- [ ] **Step 1: Write failing tests for geometry fallback and coverage state**

Create `src/lib/reference-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildReferenceMapItems,
  coverageStatusLabels,
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

const boundaries = [
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
          coordinates: [[
            [-71.41, 41.49],
            [-71.39, 41.49],
            [-71.39, 41.51],
            [-71.41, 41.51],
            [-71.41, 41.49],
          ]],
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/reference-map.test.ts`

Expected: FAIL because `src/lib/reference-map.ts` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `src/lib/reference-map.ts` with exported types, `coverageStatusLabels`,
`referenceMapStatusColors`, and `buildReferenceMapItems`. The function should:

- Index boundaries by POTA reference.
- Parse raw GeoJSON only for records with `status === "available"`.
- Always add `marker` from reference latitude/longitude when present.
- Use `deriveParkCoverage` when parks and stops are supplied.
- Sort popup stops by planned date and start time through existing coverage logic.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- src/lib/reference-map.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit only `src/lib/reference-map.ts` and `src/lib/reference-map.test.ts` with message:

```bash
jj commit src/lib/reference-map.ts src/lib/reference-map.test.ts -m "Add reference map data adapter"
```

### Task 2: Shared Leaflet Map Component

**Files:**
- Create: `src/components/ReferenceMap.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add the component shell**

Create `ReferenceMap.astro` with props:

```ts
type Props = {
  id: string;
  variant: "home" | "coverage" | "volunteer";
  title: string;
  caption: string;
  phaseFocus?: "volunteer" | "hunter";
};
```

The component imports Leaflet CSS, reference JSON, boundary metadata, local
GeoJSON via `import.meta.glob("../data/boundaries/*.geojson", { eager: true, query: "?raw", import: "default" })`, and for event variants imports parks/schedule JSON. It serializes `buildReferenceMapItems(...)` into an inline JSON script next to a map root.

- [ ] **Step 2: Add browser map initialization**

In the same component, add a script that imports Leaflet and:

- Creates the map with scroll wheel zoom disabled.
- Adds the OpenStreetMap tile layer.
- Renders GeoJSON layers when present.
- Renders a circle marker for every item with a marker coordinate.
- Fits bounds to all rendered layers, falling back to Rhode Island view.
- Builds variant-specific popup HTML.
- Adds `data-map-add-activation` buttons for the volunteer variant.
- Dispatches `new CustomEvent("activate-ri:add-park", { detail: { reference } })` when the popup button is clicked.
- Fetches `/api/activate-ri-2026/public/stops` for event variants and redraws coverage state if live stops are returned.

- [ ] **Step 3: Add map styles**

In `src/styles/global.css`, update the existing map classes so they work for the shared component:

- Keep `.map-preview` and `.ri-reference-map`.
- Add `.map-legend`, `.map-legend__item`, `.map-popup__stops`, `.map-popup__stop`, and `.map-popup__action`.
- Keep popup text compact and ensure the legend uses text labels as well as color swatches.

- [ ] **Step 4: Run Astro check**

Run: `npm run check`

Expected: PASS with no TypeScript errors from the new component.

- [ ] **Step 5: Commit**

Commit only `src/components/ReferenceMap.astro` and `src/styles/global.css` with message:

```bash
jj commit src/components/ReferenceMap.astro src/styles/global.css -m "Add shared RI reference map component"
```

### Task 3: Replace Homepage Map

**Files:**
- Modify: `src/components/ResourceMapPreview.astro`

- [ ] **Step 1: Replace inline Leaflet code with the shared component**

Update `ResourceMapPreview.astro` so it imports `ReferenceMap` and renders:

```astro
<ReferenceMap
  id="ri-reference-map"
  variant="home"
  title="Map of Rhode Island POTA references"
  caption="Reference data generated from official POTA park data and reviewed public boundary sources. Verify operating details in the POTA app before activating."
/>
```

Keep the existing copy, layout, and official-source caption semantics.

- [ ] **Step 2: Run checks**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 3: Commit**

Commit only `src/components/ResourceMapPreview.astro` with message:

```bash
jj commit src/components/ResourceMapPreview.astro -m "Use shared map on homepage"
```

### Task 4: Add Event Overview Map

**Files:**
- Modify: `src/pages/activate-ri-2026/index.astro`

- [ ] **Step 1: Render the coverage map near the coverage summary**

Import `ReferenceMap` and add it after `<CoverageSummary />`:

```astro
<ReferenceMap
  id="activate-ri-coverage-map"
  variant="coverage"
  title="Map of Activate All RI 2026 coverage"
  caption="Coverage means a planned activation window for community coordination. Official Parks on the Air resources remain authoritative for rules, spots, logs, awards, and activation validity."
  phaseFocus="volunteer"
/>
```

- [ ] **Step 2: Run checks**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 3: Commit**

Commit only `src/pages/activate-ri-2026/index.astro` with message:

```bash
jj commit src/pages/activate-ri-2026/index.astro -m "Add Activate RI coverage map"
```

### Task 5: Add Volunteer Map Form Action

**Files:**
- Modify: `src/pages/activate-ri-2026/volunteer.astro`
- Modify: `src/components/activate-ri/VolunteerForm.astro`

- [ ] **Step 1: Render the volunteer map above the form**

Import `ReferenceMap` in `volunteer.astro` and render after the "Before you submit" guidance:

```astro
<ReferenceMap
  id="activate-ri-volunteer-map"
  variant="volunteer"
  title="Choose a park from the map"
  caption="Use the map to start a stop in the form below. Adding a park only edits this form; it does not submit a plan or reserve coverage."
  phaseFocus="volunteer"
/>
```

- [ ] **Step 2: Add the form event hook**

In `VolunteerForm.astro`, listen for `activate-ri:add-park` and implement:

```ts
document.addEventListener("activate-ri:add-park", (event) => {
  const reference = (event as CustomEvent<{ reference?: string }>).detail?.reference;
  if (!reference) {
    return;
  }
  addParkReferenceToForm(reference);
});
```

Add `addParkReferenceToForm(reference)` so it finds the first stop with an empty hidden `data-park-reference`, or clones a stop using the existing clone path, then selects the matching park option, scrolls the stop into view, focuses the date field, and writes a confirmation to `data-form-status`.

- [ ] **Step 3: Run checks**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 4: Commit**

Commit only `src/pages/activate-ri-2026/volunteer.astro` and `src/components/activate-ri/VolunteerForm.astro` with message:

```bash
jj commit src/pages/activate-ri-2026/volunteer.astro src/components/activate-ri/VolunteerForm.astro -m "Add map-driven volunteer park selection"
```

### Task 6: Final Verification

**Files:**
- No direct edits unless verification finds a defect.

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run Astro checks**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 3: Build locally**

Run: `npm run build:local`

Expected: PASS.

- [ ] **Step 4: Manual browser check**

Start the dev server with `npm run dev -- --host 127.0.0.1`, open:

- `http://127.0.0.1:4321/`
- `http://127.0.0.1:4321/activate-ri-2026/`
- `http://127.0.0.1:4321/activate-ri-2026/volunteer/`

Verify the maps render, popups open, legends are visible, and the volunteer popup `Add activation` action fills or appends a stop.

- [ ] **Step 5: Final status**

Run `jj status` and report the feature commits plus any unrelated dirty files that remain.
