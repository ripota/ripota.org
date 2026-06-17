# Activate RI 2026 Signup Listing Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved Activate RI signup and listing review: multi-stop signup, fixed three-hour blocks, searchable park selection, private affiliation collection, county-aware public data, and table filters.

**Architecture:** Add small Activate RI helpers for event time blocks and public listing/filter formatting, then wire them into validation, public data generation, and Astro components. Preserve the existing D1/public JSON shape where possible by normalizing block selections to `startTime` and `endTime`.

**Tech Stack:** Astro components, TypeScript utility modules, Vitest, Cloudflare Worker route validation, generated static JSON.

---

## File Structure

- Create `src/lib/activate-ri/time-blocks.ts`: event block definitions, block validation, and conversion to start/end times.
- Create `src/lib/activate-ri/listing.ts`: formatting and filtering helpers for activator/modes, counties, timeline, bands, and modes.
- Modify `src/lib/activate-ri/types.ts`: add `counties` to public park summaries and allow optional stop `timeBlock`.
- Modify `src/lib/activate-ri/validation.ts`: accept either an allowed `timeBlock` or normalized start/end times, with block validation preferred for public signup.
- Modify `src/lib/activate-ri/validation.test.ts`: cover block normalization, invalid blocks, and multi-stop submissions.
- Modify `src/lib/activate-ri/public-export.test.ts`: assert affiliation remains private through public export.
- Modify `src/lib/activate-ri/coverage.test.ts`: assert multiple stops per park remain exposed in coverage rows.
- Modify `scripts/activate-ri-2026/publish-public-data.mjs`: include `counties` in generated `parks.json` and `coverage.json`.
- Modify `src/components/activate-ri/VolunteerForm.astro`: balanced 2x2 identity grid, repeatable stop cards, datalist-backed searchable park controls, block selector, multi-stop payload building.
- Modify `src/components/activate-ri/ScheduleTable.astro`: add filter controls, county-aware park metadata, and merged activator/modes display.
- Modify `src/components/activate-ri/ParkCoverageTable.astro`: add filter controls and render all matching stops per park.
- Modify `src/pages/activate-ri-2026/volunteer.astro`: update copy to mention one park or a multi-park route.
- Modify `src/styles/global.css`: add styles for stop cards, dynamic form actions, filter bars, and multi-stop cells.
- Regenerate `public/data/activate-ri-2026/parks.json` and `coverage.json` after `counties` are included.

### Task 1: Time Block Helper

**Files:**
- Create: `src/lib/activate-ri/time-blocks.ts`
- Modify: `src/lib/activate-ri/validation.test.ts`
- Modify: `src/lib/activate-ri/validation.ts`

- [x] **Step 1: Write failing tests for block normalization**

Add tests to `src/lib/activate-ri/validation.test.ts`:

```ts
it("normalizes allowed three-hour blocks to start and end times", () => {
  const result = validateRouteSubmission({
    ...validSubmission,
    stops: [
      {
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        timeBlock: "09:00-12:00",
        bands: ["40m", "20m"],
        modes: ["ssb", "cw"],
      },
      {
        parkReference: "US-2872",
        plannedDate: "2026-09-11",
        timeBlock: "12:00-15:00",
        bands: ["20m"],
        modes: ["SSB"],
      },
    ],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.stops).toEqual([
      expect.objectContaining({
        parkReference: "US-2868",
        startTime: "09:00",
        endTime: "12:00",
        modes: ["SSB", "CW"],
      }),
      expect.objectContaining({
        parkReference: "US-2872",
        startTime: "12:00",
        endTime: "15:00",
        modes: ["SSB"],
      }),
    ]);
  }
});

it("rejects invalid time block values", () => {
  const result = validateRouteSubmission({
    ...validSubmission,
    stops: [
      {
        ...validSubmission.stops[0],
        startTime: undefined,
        endTime: undefined,
        timeBlock: "10:00-13:00",
      },
    ],
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContain(
      "Stop 1 time block must be one of 06:00-09:00, 09:00-12:00, 12:00-15:00, 15:00-18:00, 18:00-21:00.",
    );
  }
});
```

- [x] **Step 2: Run tests to verify failure**

Run: `npm test -- src/lib/activate-ri/validation.test.ts`

Expected: FAIL because `timeBlock` is ignored and invalid block validation does not exist.

- [x] **Step 3: Implement the helper and validation wiring**

Create `src/lib/activate-ri/time-blocks.ts`:

```ts
export const activateRiTimeBlocks = [
  { value: "06:00-09:00", startTime: "06:00", endTime: "09:00" },
  { value: "09:00-12:00", startTime: "09:00", endTime: "12:00" },
  { value: "12:00-15:00", startTime: "12:00", endTime: "15:00" },
  { value: "15:00-18:00", startTime: "15:00", endTime: "18:00" },
  { value: "18:00-21:00", startTime: "18:00", endTime: "21:00" },
] as const;

export type ActivateRiTimeBlock = (typeof activateRiTimeBlocks)[number]["value"];

export const activateRiTimeBlockValues = activateRiTimeBlocks.map(
  (block) => block.value,
);

export function timeBlockToRange(
  value: string,
): { startTime: string; endTime: string } | null {
  const block = activateRiTimeBlocks.find((candidate) => candidate.value === value);
  return block ? { startTime: block.startTime, endTime: block.endTime } : null;
}

export function allowedTimeBlockMessage(label: string): string {
  return `${label} time block must be one of ${activateRiTimeBlockValues.join(", ")}.`;
}
```

In `src/lib/activate-ri/validation.ts`, read `stop.timeBlock` as optional text. If present, use `timeBlockToRange()` for `startTime` and `endTime`. If absent, retain the existing start/end validation path so edit/admin APIs remain compatible.

- [x] **Step 4: Run validation tests**

Run: `npm test -- src/lib/activate-ri/validation.test.ts`

Expected: PASS.

### Task 2: Public Park Counties and Privacy Tests

**Files:**
- Modify: `src/lib/activate-ri/types.ts`
- Modify: `scripts/activate-ri-2026/publish-public-data.mjs`
- Modify: `src/lib/activate-ri/public-export.test.ts`
- Modify: `src/data/ri-references.test.ts`

- [x] **Step 1: Write public export privacy assertion**

In `src/lib/activate-ri/public-export.test.ts`, add `club: "Private Club"` to `validRow` and update the privacy assertion:

```ts
expect(JSON.stringify(stops)).not.toMatch(/private|555|Organizer|Private Club/i);
```

- [x] **Step 2: Add `counties` to public park summaries**

In `src/lib/activate-ri/types.ts`, update `PublicParkSummary`:

```ts
export type PublicParkSummary = {
  reference: string;
  name: string;
  counties: string[];
  latitude?: number;
  longitude?: number;
  grid?: string;
  potaUrl?: string;
};
```

In `scripts/activate-ri-2026/publish-public-data.mjs`, include counties in `parks`:

```js
const parks = references.map((reference) => ({
  reference: reference.reference,
  name: reference.name,
  counties: reference.counties ?? [],
  latitude: reference.latitude,
  longitude: reference.longitude,
  grid: reference.grid,
  potaUrl: reference.potaUrl,
}));
```

- [x] **Step 3: Run focused tests**

Run: `npm test -- src/lib/activate-ri/public-export.test.ts src/data/ri-references.test.ts`

Expected: PASS.

### Task 3: Listing Helper Tests and Implementation

**Files:**
- Create: `src/lib/activate-ri/listing.ts`
- Create: `src/lib/activate-ri/listing.test.ts`

- [x] **Step 1: Write listing helper tests**

Create `src/lib/activate-ri/listing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  filterPublicStops,
  formatActivatorModes,
  timelineOptions,
  uniqueSortedValues,
} from "./listing";
import type { PublicActivationStop, PublicParkSummary } from "./types";

const parks: PublicParkSummary[] = [
  { reference: "US-2868", name: "Beavertail State Park", counties: ["Newport County"] },
  { reference: "US-2872", name: "Colt State Park", counties: ["Bristol County"] },
];

const stops: PublicActivationStop[] = [
  {
    id: "one",
    parkReference: "US-2868",
    plannedDate: "2026-09-10",
    startTime: "09:00",
    endTime: "12:00",
    activatorCallsign: "N1RWJ",
    bands: ["40m", "20m"],
    modes: ["CW", "SSB"],
    publicNotes: "",
    status: "scheduled",
  },
  {
    id: "two",
    parkReference: "US-2872",
    plannedDate: "2026-09-12",
    startTime: "12:00",
    endTime: "15:00",
    activatorCallsign: "K1ABC",
    bands: ["20m"],
    modes: ["SSB"],
    publicNotes: "",
    status: "scheduled",
  },
];

describe("listing helpers", () => {
  it("formats activator and modes together", () => {
    expect(formatActivatorModes(stops[0])).toBe("N1RWJ (CW, SSB)");
    expect(formatActivatorModes({ ...stops[0], modes: [] })).toBe("N1RWJ");
  });

  it("filters stops by mode, band, timeline, and county", () => {
    expect(
      filterPublicStops(stops, parks, {
        mode: "SSB",
        band: "20m",
        timeline: "main",
        county: "Bristol County",
      }).map((stop) => stop.id),
    ).toEqual(["two"]);
  });

  it("returns unique sorted option values", () => {
    expect(uniqueSortedValues([["SSB", "CW"], ["SSB"], []])).toEqual(["CW", "SSB"]);
  });

  it("defines the first-pass timeline options", () => {
    expect(timelineOptions.map((option) => option.value)).toEqual([
      "all",
      "soft-start",
      "main",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });
});
```

- [x] **Step 2: Run tests to verify failure**

Run: `npm test -- src/lib/activate-ri/listing.test.ts`

Expected: FAIL because `listing.ts` does not exist.

- [x] **Step 3: Implement listing helpers**

Create `src/lib/activate-ri/listing.ts` with exported `timelineOptions`, `formatActivatorModes`, `uniqueSortedValues`, and `filterPublicStops`. Filtering must treat empty filter values and `all` as no filter, `soft-start` as `2026-09-10`, and `main` as `2026-09-11` through `2026-09-13`.

- [x] **Step 4: Run listing helper tests**

Run: `npm test -- src/lib/activate-ri/listing.test.ts`

Expected: PASS.

### Task 4: Multi-Stop Volunteer Form

**Files:**
- Modify: `src/components/activate-ri/VolunteerForm.astro`
- Modify: `src/pages/activate-ri-2026/volunteer.astro`
- Modify: `src/styles/global.css`

- [x] **Step 1: Update form markup**

Change the identity grid to four fields: callsign, name, email, and `Club / group affiliation`. Render one stop card with `data-stop-card`, a datalist-backed park text input, hidden park reference input, planned date select, time block select, bands, modes, and notes. Add a button with `data-add-stop`.

- [x] **Step 2: Update form script**

Replace the single-stop `formToPayload()` with a loop over all `[data-stop-card]` elements. Each stop payload must include `parkReference`, `plannedDate`, `timeBlock`, `bands`, `modes`, and `publicNotes`. Add/remove buttons must reindex accessible headings and names.

- [x] **Step 3: Update volunteer copy**

In `src/pages/activate-ri-2026/volunteer.astro`, replace the lead with copy that says volunteers can submit one park or a multi-park route.

- [x] **Step 4: Add CSS**

Add styles for `.form-grid--identity`, `.activation-stops`, `.activation-stop-card`, `.activation-stop-card__header`, and `.form-actions`. Keep card radius at 8px or less.

- [x] **Step 5: Run type/build check**

Run: `npm run check`

Expected: PASS.

### Task 5: Filtered Schedule and Parks Tables

**Files:**
- Modify: `src/components/activate-ri/ScheduleTable.astro`
- Modify: `src/components/activate-ri/ParkCoverageTable.astro`
- Modify: `src/styles/global.css`

- [x] **Step 1: Wire schedule filters**

Use `listing.ts` helpers to derive mode, band, timeline, and county filter options. Render a compact filter bar and add client-side filtering with `data-mode`, `data-band`, `data-timeline`, and `data-county` attributes on rows. Change the activator cell to `formatActivatorModes(stop)`.

- [x] **Step 2: Wire parks filters**

Render the same filter controls for parks. Show all filtered stops for each park in the activation window cell. Hide park rows with no matching stops when any stop-level filter is active, while preserving all parks for the default view.

- [x] **Step 3: Add empty states**

Add table body empty-state rows that become visible when filters hide all rows.

- [x] **Step 4: Add filter CSS**

Add `.event-filters`, `.event-filter`, `.event-filter__control`, `.event-stop-list`, and `.event-stop-list__item` styles.

- [x] **Step 5: Run Astro check**

Run: `npm run check`

Expected: PASS.

### Task 6: Public Data Regeneration and Full Verification

**Files:**
- Modify generated files under `public/data/activate-ri-2026/`

- [x] **Step 1: Regenerate public data**

Run: `node scripts/activate-ri-2026/publish-public-data.mjs`

Expected: `parks.json` and `coverage.json` include `counties` arrays.

- [x] **Step 2: Run full tests**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Run build/check**

Run: `npm run check && npm run build:local`

Expected: PASS.

- [x] **Step 4: Inspect final diff**

Run: `jj diff`

Expected: Diff includes only the signup/listing implementation plus already-present county metadata changes that are required by this feature. Unrelated Cloudflare Access and worker changes remain outside this implementation scope.

