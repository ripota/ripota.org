# Activate All RI 2026 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 Activate All RI 2026 event section: activator recruitment, moderated submissions, public coverage views, and publishable static JSON.

**Architecture:** Keep the public site static-first with Astro pages reading generated JSON under `public/data/activate-ri-2026/`. Add a Cloudflare Worker entry point for `/api/activate-ri-2026/*` routes, backed by D1 for submissions and moderation, while serving existing static assets through the Workers Static Assets `ASSETS` binding. Use Cloudflare Access for admin auth and Turnstile for public form spam protection.

**Tech Stack:** Astro, TypeScript/ESM, Vitest, Leaflet, Cloudflare Workers Static Assets, Cloudflare D1, Cloudflare Access, Cloudflare Turnstile, mise file-based tasks.

---

## Scope

This plan implements Phase 1 only.

Included:

- `/activate-ri-2026`
- `/activate-ri-2026/volunteer`
- `/activate-ri-2026/schedule`
- `/activate-ri-2026/parks`
- `/activate-ri-2026/admin`
- Event domain model.
- Public JSON generation.
- Activator route submission.
- Organizer moderation.
- Magic-link activator edits.
- Cancellation coverage gaps.
- Manual public JSON rebuild.

Deferred to later plans:

- Hunter CSV import and all-time progress.
- Award claims.
- Activator log upload and Weekend Sweep verification.
- Real POTA spot integration.
- Email delivery for confirmations, edit links, and alerts.

## File Structure

Create these files:

- `src/data/activate-ri-2026/event.ts` - public event configuration and phase CTAs.
- `src/data/activate-ri-2026/sample-stops.ts` - development seed stops for static rendering before D1 has real data.
- `src/lib/activate-ri/types.ts` - shared event, route, stop, coverage, and public JSON types.
- `src/lib/activate-ri/validation.ts` - normalization and validation for public submissions and route edits.
- `src/lib/activate-ri/coverage.ts` - derive per-park coverage from public stops.
- `src/lib/activate-ri/public-export.ts` - convert internal records into public-safe JSON.
- `src/lib/activate-ri/paths.ts` - constants for event routes and JSON paths.
- `src/lib/activate-ri/*.test.ts` - Vitest coverage for the utility modules.
- `scripts/activate-ri-2026/publish-public-data.mjs` - local JSON rebuild script.
- `public/data/activate-ri-2026/event.json` - generated public event data.
- `public/data/activate-ri-2026/parks.json` - generated public park data.
- `public/data/activate-ri-2026/schedule.json` - generated public schedule data.
- `public/data/activate-ri-2026/coverage.json` - generated public coverage data.
- `src/components/activate-ri/EventHero.astro` - event hero and phase-aware CTAs.
- `src/components/activate-ri/EventNav.astro` - event section navigation.
- `src/components/activate-ri/CoverageSummary.astro` - static coverage numbers.
- `src/components/activate-ri/ParkCoverageTable.astro` - by-park table.
- `src/components/activate-ri/ScheduleTable.astro` - by-schedule table.
- `src/components/activate-ri/VolunteerForm.astro` - public activator route form.
- `src/components/activate-ri/AdminDashboard.astro` - lightweight admin UI shell.
- `src/components/activate-ri/ActivatorEditForm.astro` - magic-link edit UI.
- `src/components/activate-ri/EventMap.astro` - Leaflet map using public coverage data.
- `src/pages/activate-ri-2026/index.astro`
- `src/pages/activate-ri-2026/volunteer.astro`
- `src/pages/activate-ri-2026/schedule.astro`
- `src/pages/activate-ri-2026/parks.astro`
- `src/pages/activate-ri-2026/admin.astro`
- `src/pages/activate-ri-2026/edit/[token].astro`
- `src/worker/index.ts` - Worker router for API routes and static asset fallback.
- `src/worker/env.ts` - Worker environment type definitions.
- `src/worker/http.ts` - response helpers.
- `src/worker/db.ts` - D1 access helpers.
- `src/worker/turnstile.ts` - server-side Turnstile verification.
- `src/worker/access.ts` - Cloudflare Access identity validation.
- `src/worker/routes/activate-ri.ts` - API route handlers.
- `src/worker/routes/activate-ri.test.ts` - isolated handler tests where D1 is mocked.
- `migrations/0001_activate_ri_2026.sql` - D1 schema.
- `mise/tasks/activate-ri-2026/publish`
- `mise/tasks/activate-ri-2026/d1-apply-local`

Modify these files:

- `package.json` - add Worker type dependencies when TypeScript reports missing Worker globals.
- `wrangler.jsonc` - add Worker `main`, `ASSETS` binding, D1 binding, vars, and route-first API handling.
- `src/components/SiteHeader.astro` - add an event link without making the homepage event-specific.
- `src/styles/global.css` - add event, table, form, and admin styles.
- `src/env.d.ts` - add JSON module declarations only if TypeScript needs them.

## Task 1: Event Domain Types and Config

**Files:**

- Create: `src/lib/activate-ri/types.ts`
- Create: `src/lib/activate-ri/paths.ts`
- Create: `src/data/activate-ri-2026/event.ts`
- Create: `src/lib/activate-ri/event.test.ts`

- [ ] **Step 1: Write the failing event config tests**

Create `src/lib/activate-ri/event.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { activateRi2026Event } from "../../data/activate-ri-2026/event";
import { eventRoute, publicDataPath } from "./paths";

describe("Activate RI event config", () => {
  it("uses the approved 2026 event dates and planning phase", () => {
    expect(activateRi2026Event).toEqual(
      expect.objectContaining({
        id: "activate-ri-2026",
        name: "Activate All RI 2026",
        slug: "activate-ri-2026",
        phase: "planning",
        mainStartDate: "2026-09-11",
        mainEndDate: "2026-09-13",
        softStartDate: "2026-09-10",
        timezone: "America/New_York",
        goalParkCount: 61,
      }),
    );
  });

  it("keeps volunteer as the planning primary call to action", () => {
    expect(activateRi2026Event.phaseCtas.planning.primary.href).toBe(
      "/activate-ri-2026/volunteer/",
    );
    expect(activateRi2026Event.phaseCtas.planning.secondary.href).toBe(
      "/activate-ri-2026/schedule/",
    );
  });

  it("centralizes event routes and generated JSON paths", () => {
    expect(eventRoute("parks")).toBe("/activate-ri-2026/parks/");
    expect(publicDataPath("coverage")).toBe("/data/activate-ri-2026/coverage.json");
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
mise run test -- src/lib/activate-ri/event.test.ts
```

Expected: FAIL because `src/lib/activate-ri/types.ts`, `paths.ts`, and `src/data/activate-ri-2026/event.ts` do not exist.

- [ ] **Step 3: Add shared types**

Create `src/lib/activate-ri/types.ts`:

```ts
export type EventPhase = "planning" | "schedule-live" | "event-live" | "post-event";

export type EventCta = {
  label: string;
  href: string;
  description: string;
};

export type EventPhaseCtas = Record<
  EventPhase,
  {
    primary: EventCta;
    secondary: EventCta;
  }
>;

export type ActivateRiEvent = {
  id: "activate-ri-2026";
  name: string;
  slug: string;
  phase: EventPhase;
  mainStartDate: string;
  mainEndDate: string;
  softStartDate: string;
  timezone: "America/New_York";
  goalParkCount: number;
  publicSummary: string;
  phaseCtas: EventPhaseCtas;
};

export type ActivationStopStatus =
  | "pending-review"
  | "scheduled"
  | "delayed"
  | "cancelled"
  | "completed";

export type PublicActivationStop = {
  id: string;
  parkReference: string;
  plannedDate: string;
  startTime: string;
  endTime: string;
  activatorCallsign: string;
  bands: string[];
  modes: string[];
  publicNotes: string;
  status: ActivationStopStatus;
};

export type ParkCoverageStatus =
  | "uncovered"
  | "scheduled"
  | "multiple-scheduled"
  | "cancelled-needs-replacement"
  | "completed";

export type ParkCoverage = {
  reference: string;
  name: string;
  status: ParkCoverageStatus;
  scheduledStopCount: number;
  cancelledStopCount: number;
  nextStop: PublicActivationStop | null;
  stops: PublicActivationStop[];
};
```

- [ ] **Step 4: Add event route constants**

Create `src/lib/activate-ri/paths.ts`:

```ts
export type EventPageKey =
  | "home"
  | "volunteer"
  | "schedule"
  | "parks"
  | "hunters"
  | "awards"
  | "admin";

const routes: Record<EventPageKey, string> = {
  home: "/activate-ri-2026/",
  volunteer: "/activate-ri-2026/volunteer/",
  schedule: "/activate-ri-2026/schedule/",
  parks: "/activate-ri-2026/parks/",
  hunters: "/activate-ri-2026/hunters/",
  awards: "/activate-ri-2026/awards/",
  admin: "/activate-ri-2026/admin/",
};

export type PublicDataKey = "event" | "parks" | "schedule" | "coverage";

export function eventRoute(key: EventPageKey): string {
  return routes[key];
}

export function publicDataPath(key: PublicDataKey): string {
  return `/data/activate-ri-2026/${key}.json`;
}
```

- [ ] **Step 5: Add event config**

Create `src/data/activate-ri-2026/event.ts`:

```ts
import type { ActivateRiEvent } from "../../lib/activate-ri/types";

export const activateRi2026Event = {
  id: "activate-ri-2026",
  name: "Activate All RI 2026",
  slug: "activate-ri-2026",
  phase: "planning",
  mainStartDate: "2026-09-11",
  mainEndDate: "2026-09-13",
  softStartDate: "2026-09-10",
  timezone: "America/New_York",
  goalParkCount: 61,
  publicSummary:
    "A Rhode Island POTA community weekend to cover all 61 Rhode Island references.",
  phaseCtas: {
    planning: {
      primary: {
        label: "Volunteer to activate",
        href: "/activate-ri-2026/volunteer/",
        description: "Submit one park or a multi-park route for organizer review.",
      },
      secondary: {
        label: "See the schedule",
        href: "/activate-ri-2026/schedule/",
        description: "Review planned activation windows as they are approved.",
      },
    },
    "schedule-live": {
      primary: {
        label: "Find scheduled activations",
        href: "/activate-ri-2026/schedule/",
        description: "Browse approved activation windows by date and time.",
      },
      secondary: {
        label: "Fill a coverage gap",
        href: "/activate-ri-2026/parks/",
        description: "Find parks that still need activator coverage.",
      },
    },
    "event-live": {
      primary: {
        label: "Open event schedule",
        href: "/activate-ri-2026/schedule/",
        description: "Use the schedule and official POTA spots during the event.",
      },
      secondary: {
        label: "Update my activation",
        href: "/activate-ri-2026/volunteer/",
        description: "Use your private edit link to update or cancel a stop.",
      },
    },
    "post-event": {
      primary: {
        label: "Check recognition",
        href: "/activate-ri-2026/awards/",
        description: "Review community recognition details after the event.",
      },
      secondary: {
        label: "Submit corrections",
        href: "/activate-ri-2026/volunteer/",
        description: "Contact organizers about schedule or log corrections.",
      },
    },
  },
} as const satisfies ActivateRiEvent;
```

- [ ] **Step 6: Run tests**

Run:

```bash
mise run test -- src/lib/activate-ri/event.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Use jj and scope only the files from this task:

```bash
jj commit src/lib/activate-ri/types.ts src/lib/activate-ri/paths.ts src/data/activate-ri-2026/event.ts src/lib/activate-ri/event.test.ts -m "Add Activate RI event config"
```

## Task 2: Submission Validation

**Files:**

- Create: `src/lib/activate-ri/validation.ts`
- Create: `src/lib/activate-ri/validation.test.ts`
- Modify: `src/lib/activate-ri/types.ts`

- [ ] **Step 1: Add failing validation tests**

Create `src/lib/activate-ri/validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateRouteSubmission } from "./validation";

describe("validateRouteSubmission", () => {
  it("normalizes a valid single-stop submission", () => {
    const result = validateRouteSubmission({
      submitterCallsign: " n1rwj ",
      submitterName: "Rob Jackson",
      submitterEmail: "rob@example.com",
      submitterPhone: "",
      club: "Fidelity Amateur Radio Club",
      publicNotes: "Will spot through POTA.",
      organizerNotes: "Flexible by 30 minutes.",
      stops: [
        {
          parkReference: " us-2868 ",
          plannedDate: "2026-09-11",
          startTime: "09:00",
          endTime: "11:00",
          bands: ["40m", "20m"],
          modes: ["SSB", "CW"],
          publicNotes: "",
          organizerNotes: "",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.submitterCallsign).toBe("N1RWJ");
      expect(result.value.submitterEmail).toBe("rob@example.com");
      expect(result.value.stops[0]).toEqual(
        expect.objectContaining({
          parkReference: "US-2868",
          plannedDate: "2026-09-11",
          startTime: "09:00",
          endTime: "11:00",
          bands: ["40m", "20m"],
          modes: ["SSB", "CW"],
        }),
      );
    }
  });

  it("rejects invalid callsigns, emails, dates, times, and empty stops", () => {
    const result = validateRouteSubmission({
      submitterCallsign: "not a call sign!",
      submitterName: "",
      submitterEmail: "not-email",
      stops: [
        {
          parkReference: "US-999999",
          plannedDate: "2026-09-14",
          startTime: "14:00",
          endTime: "13:00",
          bands: [],
          modes: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "Enter a valid activator callsign.",
          "Enter the activator name.",
          "Enter a valid email address.",
          "Stop 1 must use a known Rhode Island POTA reference.",
          "Stop 1 date must be September 10-13, 2026.",
          "Stop 1 end time must be after start time.",
          "Stop 1 needs at least one planned band.",
          "Stop 1 needs at least one planned mode.",
        ]),
      );
    }
  });
});
```

- [ ] **Step 2: Run validation tests to verify failure**

Run:

```bash
mise run test -- src/lib/activate-ri/validation.test.ts
```

Expected: FAIL because `validation.ts` does not exist.

- [ ] **Step 3: Extend types for internal submissions**

Append these types to `src/lib/activate-ri/types.ts`:

```ts
export type ActivationStopInput = {
  parkReference: string;
  plannedDate: string;
  startTime: string;
  endTime: string;
  bands: string[];
  modes: string[];
  publicNotes?: string;
  organizerNotes?: string;
};

export type RouteSubmissionInput = {
  submitterCallsign: string;
  submitterName: string;
  submitterEmail: string;
  submitterPhone?: string;
  club?: string;
  publicNotes?: string;
  organizerNotes?: string;
  stops: ActivationStopInput[];
};

export type NormalizedRouteSubmission = {
  submitterCallsign: string;
  submitterName: string;
  submitterEmail: string;
  submitterPhone: string;
  club: string;
  publicNotes: string;
  organizerNotes: string;
  stops: Required<ActivationStopInput>[];
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
```

- [ ] **Step 4: Implement validation**

Create `src/lib/activate-ri/validation.ts`:

```ts
import references from "../../data/ri-references.json";
import { normalizePotaReference } from "../pota/references";
import type {
  ActivationStopInput,
  NormalizedRouteSubmission,
  RouteSubmissionInput,
  ValidationResult,
} from "./types";

const referenceIds = new Set(references.map((reference) => reference.reference));
const eventDatePattern = /^2026-09-(10|11|12|13)$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const callsignPattern = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{1,4}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRouteSubmission(
  input: Partial<RouteSubmissionInput>,
): ValidationResult<NormalizedRouteSubmission> {
  const errors: string[] = [];
  const submitterCallsign = String(input.submitterCallsign ?? "").trim().toUpperCase();
  const submitterName = String(input.submitterName ?? "").trim();
  const submitterEmail = String(input.submitterEmail ?? "").trim().toLowerCase();
  const stops = Array.isArray(input.stops) ? input.stops : [];

  if (!callsignPattern.test(submitterCallsign)) {
    errors.push("Enter a valid activator callsign.");
  }

  if (submitterName.length === 0) {
    errors.push("Enter the activator name.");
  }

  if (!emailPattern.test(submitterEmail)) {
    errors.push("Enter a valid email address.");
  }

  if (stops.length === 0) {
    errors.push("Add at least one activation stop.");
  }

  const normalizedStops = stops.map((stop, index) =>
    normalizeStop(stop, index, errors),
  );

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      submitterCallsign,
      submitterName,
      submitterEmail,
      submitterPhone: String(input.submitterPhone ?? "").trim(),
      club: String(input.club ?? "").trim(),
      publicNotes: String(input.publicNotes ?? "").trim(),
      organizerNotes: String(input.organizerNotes ?? "").trim(),
      stops: normalizedStops,
    },
  };
}

function normalizeStop(
  stop: Partial<ActivationStopInput>,
  index: number,
  errors: string[],
): Required<ActivationStopInput> {
  const label = `Stop ${index + 1}`;
  const parkReference = normalizePotaReference(String(stop.parkReference ?? ""));
  const plannedDate = String(stop.plannedDate ?? "").trim();
  const startTime = String(stop.startTime ?? "").trim();
  const endTime = String(stop.endTime ?? "").trim();
  const bands = cleanList(stop.bands);
  const modes = cleanList(stop.modes).map((mode) => mode.toUpperCase());

  if (!referenceIds.has(parkReference)) {
    errors.push(`${label} must use a known Rhode Island POTA reference.`);
  }

  if (!eventDatePattern.test(plannedDate)) {
    errors.push(`${label} date must be September 10-13, 2026.`);
  }

  if (!timePattern.test(startTime)) {
    errors.push(`${label} start time must use HH:MM 24-hour format.`);
  }

  if (!timePattern.test(endTime)) {
    errors.push(`${label} end time must use HH:MM 24-hour format.`);
  }

  if (timePattern.test(startTime) && timePattern.test(endTime) && endTime <= startTime) {
    errors.push(`${label} end time must be after start time.`);
  }

  if (bands.length === 0) {
    errors.push(`${label} needs at least one planned band.`);
  }

  if (modes.length === 0) {
    errors.push(`${label} needs at least one planned mode.`);
  }

  return {
    parkReference,
    plannedDate,
    startTime,
    endTime,
    bands,
    modes,
    publicNotes: String(stop.publicNotes ?? "").trim(),
    organizerNotes: String(stop.organizerNotes ?? "").trim(),
  };
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}
```

- [ ] **Step 5: Run validation tests**

Run:

```bash
mise run test -- src/lib/activate-ri/validation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run all existing tests**

Run:

```bash
mise run test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
jj commit src/lib/activate-ri/types.ts src/lib/activate-ri/validation.ts src/lib/activate-ri/validation.test.ts -m "Add Activate RI submission validation"
```

## Task 3: Coverage Derivation and Public Export

**Files:**

- Create: `src/lib/activate-ri/coverage.ts`
- Create: `src/lib/activate-ri/coverage.test.ts`
- Create: `src/lib/activate-ri/public-export.ts`
- Create: `src/lib/activate-ri/public-export.test.ts`
- Modify: `src/lib/activate-ri/types.ts`

- [ ] **Step 1: Write coverage tests**

Create `src/lib/activate-ri/coverage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveParkCoverage } from "./coverage";
import type { PublicActivationStop } from "./types";

const park = { reference: "US-2868", name: "Beavertail State Park" };

describe("deriveParkCoverage", () => {
  it("marks parks with no stops as uncovered", () => {
    expect(deriveParkCoverage([park], [])).toEqual([
      expect.objectContaining({
        reference: "US-2868",
        status: "uncovered",
        scheduledStopCount: 0,
        cancelledStopCount: 0,
        nextStop: null,
      }),
    ]);
  });

  it("marks multiple scheduled stops and picks the next chronological stop", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "late",
        parkReference: "US-2868",
        plannedDate: "2026-09-12",
        startTime: "14:00",
        endTime: "16:00",
        activatorCallsign: "K1ABC",
        bands: ["20m"],
        modes: ["SSB"],
        publicNotes: "",
        status: "scheduled",
      },
      {
        id: "early",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m"],
        modes: ["CW"],
        publicNotes: "",
        status: "scheduled",
      },
    ];

    expect(deriveParkCoverage([park], stops)).toEqual([
      expect.objectContaining({
        status: "multiple-scheduled",
        scheduledStopCount: 2,
        nextStop: expect.objectContaining({ id: "early" }),
      }),
    ]);
  });

  it("marks cancellation as a replacement gap when no scheduled stop remains", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "cancelled",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m"],
        modes: ["CW"],
        publicNotes: "Cancelled due to access.",
        status: "cancelled",
      },
    ];

    expect(deriveParkCoverage([park], stops)).toEqual([
      expect.objectContaining({
        status: "cancelled-needs-replacement",
        scheduledStopCount: 0,
        cancelledStopCount: 1,
      }),
    ]);
  });
});
```

- [ ] **Step 2: Write public export tests**

Create `src/lib/activate-ri/public-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { routeRowsToPublicStops } from "./public-export";

describe("routeRowsToPublicStops", () => {
  it("exports only public-safe scheduled stop fields", () => {
    const stops = routeRowsToPublicStops([
      {
        id: "stop-1",
        park_reference: "US-2868",
        planned_date: "2026-09-11",
        start_time: "09:00",
        end_time: "11:00",
        submitter_callsign: "N1RWJ",
        submitter_email: "private@example.com",
        submitter_phone: "555-0100",
        bands_json: "[\"40m\",\"20m\"]",
        modes_json: "[\"SSB\"]",
        public_notes: "Will spot through POTA.",
        organizer_notes: "Private note",
        status: "scheduled",
      },
    ]);

    expect(stops).toEqual([
      {
        id: "stop-1",
        parkReference: "US-2868",
        plannedDate: "2026-09-11",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "N1RWJ",
        bands: ["40m", "20m"],
        modes: ["SSB"],
        publicNotes: "Will spot through POTA.",
        status: "scheduled",
      },
    ]);
    expect(JSON.stringify(stops)).not.toMatch(/private|555|Organizer/i);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
mise run test -- src/lib/activate-ri/coverage.test.ts src/lib/activate-ri/public-export.test.ts
```

Expected: FAIL because the implementation files do not exist.

- [ ] **Step 4: Add export row types**

Append to `src/lib/activate-ri/types.ts`:

```ts
export type PublicParkSummary = {
  reference: string;
  name: string;
  latitude?: number;
  longitude?: number;
  grid?: string;
  potaUrl?: string;
};

export type StopExportRow = {
  id: string;
  park_reference: string;
  planned_date: string;
  start_time: string;
  end_time: string;
  submitter_callsign: string;
  submitter_email?: string;
  submitter_phone?: string;
  bands_json: string;
  modes_json: string;
  public_notes: string | null;
  organizer_notes?: string | null;
  status: ActivationStopStatus;
};
```

- [ ] **Step 5: Implement coverage**

Create `src/lib/activate-ri/coverage.ts`:

```ts
import type { ParkCoverage, PublicActivationStop, PublicParkSummary } from "./types";

const activeStatuses = new Set(["scheduled", "delayed", "completed"]);

export function deriveParkCoverage(
  parks: PublicParkSummary[],
  stops: PublicActivationStop[],
): ParkCoverage[] {
  return parks.map((park) => {
    const parkStops = sortStops(
      stops.filter((stop) => stop.parkReference === park.reference),
    );
    const scheduledStops = parkStops.filter((stop) => activeStatuses.has(stop.status));
    const cancelledStops = parkStops.filter((stop) => stop.status === "cancelled");

    return {
      reference: park.reference,
      name: park.name,
      status: coverageStatus(scheduledStops.length, cancelledStops.length),
      scheduledStopCount: scheduledStops.length,
      cancelledStopCount: cancelledStops.length,
      nextStop: scheduledStops[0] ?? null,
      stops: parkStops,
    };
  });
}

function coverageStatus(
  scheduledStopCount: number,
  cancelledStopCount: number,
): ParkCoverage["status"] {
  if (scheduledStopCount > 1) {
    return "multiple-scheduled";
  }

  if (scheduledStopCount === 1) {
    return "scheduled";
  }

  if (cancelledStopCount > 0) {
    return "cancelled-needs-replacement";
  }

  return "uncovered";
}

function sortStops(stops: PublicActivationStop[]): PublicActivationStop[] {
  return [...stops].sort((left, right) => {
    const leftKey = `${left.plannedDate}T${left.startTime}`;
    const rightKey = `${right.plannedDate}T${right.startTime}`;
    return leftKey.localeCompare(rightKey);
  });
}
```

- [ ] **Step 6: Implement public export**

Create `src/lib/activate-ri/public-export.ts`:

```ts
import type { PublicActivationStop, StopExportRow } from "./types";

export function routeRowsToPublicStops(rows: StopExportRow[]): PublicActivationStop[] {
  return rows.map((row) => ({
    id: row.id,
    parkReference: row.park_reference,
    plannedDate: row.planned_date,
    startTime: row.start_time,
    endTime: row.end_time,
    activatorCallsign: row.submitter_callsign,
    bands: parseStringArray(row.bands_json),
    modes: parseStringArray(row.modes_json),
    publicNotes: row.public_notes ?? "",
    status: row.status,
  }));
}

export function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((item) => String(item)).filter(Boolean);
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
mise run test -- src/lib/activate-ri/coverage.test.ts src/lib/activate-ri/public-export.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
jj commit src/lib/activate-ri/types.ts src/lib/activate-ri/coverage.ts src/lib/activate-ri/coverage.test.ts src/lib/activate-ri/public-export.ts src/lib/activate-ri/public-export.test.ts -m "Add Activate RI public coverage exports"
```

## Task 4: Generated Static Public JSON

**Files:**

- Create: `src/data/activate-ri-2026/sample-stops.ts`
- Create: `scripts/activate-ri-2026/publish-public-data.mjs`
- Create: `mise/tasks/activate-ri-2026/publish`
- Create generated files under `public/data/activate-ri-2026/`

- [ ] **Step 1: Create sample public stops**

Create `src/data/activate-ri-2026/sample-stops.ts`:

```ts
import type { PublicActivationStop } from "../../lib/activate-ri/types";

export const sampleActivationStops: PublicActivationStop[] = [
  {
    id: "sample-us-2868-n1rwj-2026-09-11-0900",
    parkReference: "US-2868",
    plannedDate: "2026-09-11",
    startTime: "09:00",
    endTime: "11:00",
    activatorCallsign: "N1RWJ",
    bands: ["40m", "20m"],
    modes: ["SSB"],
    publicNotes: "Sample planning record for development.",
    status: "scheduled",
  },
];
```

- [ ] **Step 2: Add the publish script**

Create `scripts/activate-ri-2026/publish-public-data.mjs`:

```js
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import references from "../../src/data/ri-references.json" with { type: "json" };
import { activateRi2026Event } from "../../src/data/activate-ri-2026/event.ts";
import { sampleActivationStops } from "../../src/data/activate-ri-2026/sample-stops.ts";
import { deriveParkCoverage } from "../../src/lib/activate-ri/coverage.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = resolve(root, "public/data/activate-ri-2026");

const parks = references.map((reference) => ({
  reference: reference.reference,
  name: reference.name,
  latitude: reference.latitude,
  longitude: reference.longitude,
  grid: reference.grid,
  potaUrl: reference.potaUrl,
}));

const coverage = deriveParkCoverage(parks, sampleActivationStops);

await mkdir(outputDir, { recursive: true });
await writeJson("event.json", activateRi2026Event);
await writeJson("parks.json", parks);
await writeJson("schedule.json", sampleActivationStops);
await writeJson("coverage.json", coverage);

console.log(`Wrote Activate RI public data to ${outputDir}`);

async function writeJson(filename, value) {
  await writeFile(
    resolve(outputDir, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}
```

- [ ] **Step 3: Add the mise publish task**

Create `mise/tasks/activate-ri-2026/publish`:

```bash
#!/usr/bin/env bash
# -*- mode: sh; sh-shell: bash; -*-
#MISE description="Regenerate Activate All RI 2026 public JSON data"

set -euo pipefail

node --experimental-strip-types scripts/activate-ri-2026/publish-public-data.mjs
```

Make it executable:

```bash
chmod +x mise/tasks/activate-ri-2026/publish
```

- [ ] **Step 4: Run the publish task**

Run:

```bash
mise run activate-ri-2026/publish
```

Expected: prints `Wrote Activate RI public data to .../public/data/activate-ri-2026` and creates four JSON files.

- [ ] **Step 5: Verify JSON content**

Run:

```bash
node -e 'for (const f of ["event","parks","schedule","coverage"]) { const data = require(`./public/data/activate-ri-2026/${f}.json`); console.log(f, Array.isArray(data) ? data.length : data.id); }'
```

Expected output includes:

```text
event activate-ri-2026
parks 61
schedule 1
coverage 61
```

- [ ] **Step 6: Run tests**

Run:

```bash
mise run test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
jj commit src/data/activate-ri-2026/sample-stops.ts scripts/activate-ri-2026/publish-public-data.mjs mise/tasks/activate-ri-2026/publish public/data/activate-ri-2026/event.json public/data/activate-ri-2026/parks.json public/data/activate-ri-2026/schedule.json public/data/activate-ri-2026/coverage.json -m "Generate Activate RI public data"
```

## Task 5: Static Event Pages

**Files:**

- Create: `src/components/activate-ri/EventNav.astro`
- Create: `src/components/activate-ri/EventHero.astro`
- Create: `src/components/activate-ri/CoverageSummary.astro`
- Create: `src/components/activate-ri/ParkCoverageTable.astro`
- Create: `src/components/activate-ri/ScheduleTable.astro`
- Create: `src/pages/activate-ri-2026/index.astro`
- Create: `src/pages/activate-ri-2026/schedule.astro`
- Create: `src/pages/activate-ri-2026/parks.astro`
- Modify: `src/components/SiteHeader.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create event navigation**

Create `src/components/activate-ri/EventNav.astro`:

```astro
---
const links = [
  ["Overview", "/activate-ri-2026/"],
  ["Volunteer", "/activate-ri-2026/volunteer/"],
  ["Schedule", "/activate-ri-2026/schedule/"],
  ["Parks", "/activate-ri-2026/parks/"],
];
---

<nav class="event-nav" aria-label="Activate All RI navigation">
  {links.map(([label, href]) => <a href={href}>{label}</a>)}
</nav>
```

- [ ] **Step 2: Create event hero**

Create `src/components/activate-ri/EventHero.astro`:

```astro
---
import { activateRi2026Event } from "../../data/activate-ri-2026/event";

const ctas = activateRi2026Event.phaseCtas[activateRi2026Event.phase];
---

<section class="event-hero" aria-labelledby="event-title">
  <div class="container event-hero__inner">
    <p class="eyebrow">September 11-13, 2026</p>
    <h1 id="event-title">{activateRi2026Event.name}</h1>
    <p class="event-hero__copy">
      Help the Rhode Island POTA community cover all 61 Rhode Island references
      during one coordinated weekend. A soft start is planned for September 10.
    </p>
    <div class="button-row" aria-label="Event actions">
      <a class="button" data-variant="primary" href={ctas.primary.href}>
        {ctas.primary.label}
      </a>
      <a class="button" data-variant="light" href={ctas.secondary.href}>
        {ctas.secondary.label}
      </a>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Create coverage summary**

Create `src/components/activate-ri/CoverageSummary.astro`:

```astro
---
import coverage from "../../../public/data/activate-ri-2026/coverage.json";

const scheduled = coverage.filter((park) =>
  ["scheduled", "multiple-scheduled", "completed"].includes(park.status),
).length;
const gaps = coverage.filter((park) =>
  ["uncovered", "cancelled-needs-replacement"].includes(park.status),
).length;
---

<dl class="coverage-summary" aria-label="Activate All RI coverage summary">
  <div>
    <dt>Parks scheduled</dt>
    <dd>{scheduled} / {coverage.length}</dd>
  </div>
  <div>
    <dt>Coverage gaps</dt>
    <dd>{gaps}</dd>
  </div>
</dl>
```

- [ ] **Step 4: Create tables**

Create `src/components/activate-ri/ParkCoverageTable.astro`:

```astro
---
import coverage from "../../../public/data/activate-ri-2026/coverage.json";
---

<table class="event-table">
  <thead>
    <tr>
      <th>Park</th>
      <th>Status</th>
      <th>Next activation</th>
      <th>Activator</th>
      <th>Bands / modes</th>
    </tr>
  </thead>
  <tbody>
    {
      coverage.map((park) => (
        <tr>
          <th scope="row">
            <strong>{park.reference}</strong>
            <span>{park.name}</span>
          </th>
          <td>{park.status}</td>
          <td>
            {park.nextStop
              ? `${park.nextStop.plannedDate} ${park.nextStop.startTime}-${park.nextStop.endTime}`
              : "Needs coverage"}
          </td>
          <td>{park.nextStop?.activatorCallsign ?? ""}</td>
          <td>
            {park.nextStop
              ? `${park.nextStop.bands.join(", ")} / ${park.nextStop.modes.join(", ")}`
              : ""}
          </td>
        </tr>
      ))
    }
  </tbody>
</table>
```

Create `src/components/activate-ri/ScheduleTable.astro`:

```astro
---
import schedule from "../../../public/data/activate-ri-2026/schedule.json";
import parks from "../../../public/data/activate-ri-2026/parks.json";

const parksByReference = new Map(parks.map((park) => [park.reference, park]));
const sortedStops = [...schedule].sort((left, right) =>
  `${left.plannedDate}T${left.startTime}`.localeCompare(
    `${right.plannedDate}T${right.startTime}`,
  ),
);
---

<table class="event-table">
  <thead>
    <tr>
      <th>Date</th>
      <th>Time</th>
      <th>Park</th>
      <th>Activator</th>
      <th>Bands</th>
      <th>Modes</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    {
      sortedStops.map((stop) => (
        <tr>
          <td>{stop.plannedDate}</td>
          <td>{stop.startTime}-{stop.endTime}</td>
          <th scope="row">
            <strong>{stop.parkReference}</strong>
            <span>{parksByReference.get(stop.parkReference)?.name}</span>
          </th>
          <td>{stop.activatorCallsign}</td>
          <td>{stop.bands.join(", ")}</td>
          <td>{stop.modes.join(", ")}</td>
          <td>{stop.status}</td>
        </tr>
      ))
    }
  </tbody>
</table>
```

- [ ] **Step 5: Create event pages**

Create `src/pages/activate-ri-2026/index.astro`:

```astro
---
import Footer from "../../components/Footer.astro";
import Notice from "../../components/Notice.astro";
import SiteHeader from "../../components/SiteHeader.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
import CoverageSummary from "../../components/activate-ri/CoverageSummary.astro";
import EventHero from "../../components/activate-ri/EventHero.astro";
import EventNav from "../../components/activate-ri/EventNav.astro";
---

<BaseLayout
  title="Activate All RI 2026"
  description="Volunteer and follow the Rhode Island POTA community effort to activate all 61 RI parks."
  canonicalPath="/activate-ri-2026/"
>
  <SiteHeader variant="solid" />
  <main id="main">
    <EventHero />
    <section class="section">
      <div class="container">
        <EventNav />
        <CoverageSummary />
      </div>
    </section>
    <Notice />
  </main>
  <Footer />
</BaseLayout>
```

Create `src/pages/activate-ri-2026/schedule.astro` and `src/pages/activate-ri-2026/parks.astro` using the same layout, with `ScheduleTable` and `ParkCoverageTable` respectively.

- [ ] **Step 6: Add header link**

In `src/components/SiteHeader.astro`, add this nav link:

```astro
<a href="/activate-ri-2026/">Activate All RI</a>
```

Keep the homepage itself evergreen; only the nav points to the event section.

- [ ] **Step 7: Add event CSS**

Append to `src/styles/global.css`:

```css
.event-hero {
  padding: calc(var(--header-height) + 4rem) 0 4rem;
  background: var(--surface-ink);
  color: var(--text-on-hero);
}

.event-hero h1 {
  max-width: 12ch;
  color: var(--text-on-hero);
  font-size: clamp(3.25rem, 8vw, 6rem);
}

.event-hero__copy {
  max-width: 720px;
  margin: 1rem 0 1.5rem;
  color: color-mix(in srgb, var(--text-on-hero) 86%, transparent);
  font-size: 1.2rem;
}

.event-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.event-nav a,
.button[data-variant="light"] {
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 0.7rem 0.9rem;
  text-decoration: none;
}

.coverage-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  margin: 0 0 2rem;
}

.coverage-summary div {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 1rem;
  background: var(--surface-raised);
}

.coverage-summary dt {
  color: var(--text-muted);
  font-weight: 800;
}

.coverage-summary dd {
  margin: 0.25rem 0 0;
  color: var(--surface-ink);
  font-size: 2rem;
  font-weight: 900;
}

.event-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface-raised);
}

.event-table th,
.event-table td {
  border-bottom: 1px solid var(--border-subtle);
  padding: 0.8rem;
  text-align: left;
  vertical-align: top;
}

.event-table th span {
  display: block;
  color: var(--text-muted);
  font-weight: 500;
}
```

- [ ] **Step 8: Run static checks**

Run:

```bash
mise run check
mise run build
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit**

```bash
jj commit src/components/activate-ri src/pages/activate-ri-2026 src/components/SiteHeader.astro src/styles/global.css -m "Add Activate RI public pages"
```

## Task 6: Volunteer Form UI

**Files:**

- Create: `src/components/activate-ri/VolunteerForm.astro`
- Create: `src/pages/activate-ri-2026/volunteer.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create form component**

Create `src/components/activate-ri/VolunteerForm.astro`:

```astro
---
import references from "../../data/ri-references.json";
---

<form class="event-form" method="post" action="/api/activate-ri-2026/routes" data-activate-ri-volunteer>
  <div class="form-grid">
    <label>
      Callsign
      <input name="submitterCallsign" autocomplete="nickname" required />
    </label>
    <label>
      Name
      <input name="submitterName" autocomplete="name" required />
    </label>
    <label>
      Email
      <input name="submitterEmail" type="email" autocomplete="email" required />
    </label>
    <label>
      Club or group
      <input name="club" autocomplete="organization" />
    </label>
  </div>

  <fieldset class="activation-stop-fieldset">
    <legend>Activation stop</legend>
    <div class="form-grid">
      <label>
        Park
        <select name="stops[0][parkReference]" required>
          <option value="">Choose a RI POTA park</option>
          {references.map((reference) => (
            <option value={reference.reference}>
              {reference.reference} - {reference.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <select name="stops[0][plannedDate]" required>
          <option value="2026-09-10">Thursday, September 10 soft start</option>
          <option value="2026-09-11">Friday, September 11</option>
          <option value="2026-09-12">Saturday, September 12</option>
          <option value="2026-09-13">Sunday, September 13</option>
        </select>
      </label>
      <label>
        Start time
        <input name="stops[0][startTime]" type="time" required />
      </label>
      <label>
        End time
        <input name="stops[0][endTime]" type="time" required />
      </label>
      <label>
        Bands
        <input name="stops[0][bands]" aria-label="Bands such as 40m, 20m, 15m" required />
      </label>
      <label>
        Modes
        <input name="stops[0][modes]" aria-label="Modes such as SSB, CW, FT8" required />
      </label>
    </div>
    <label>
      Public notes for hunters
      <textarea name="stops[0][publicNotes]" rows="3"></textarea>
    </label>
  </fieldset>

  <label>
    Notes for organizers
    <textarea name="organizerNotes" rows="3"></textarea>
  </label>

  <p class="form-help">
    Frequencies are not collected here. Please use normal POTA spotting when
    your activation begins.
  </p>

  <button class="button" data-variant="primary" type="submit">Submit for review</button>
  <output class="form-status" data-form-status aria-live="polite"></output>
</form>

<script>
  const form = document.querySelector("[data-activate-ri-volunteer]") as HTMLFormElement | null;
  const status = document.querySelector("[data-form-status]");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    status?.replaceChildren("Submitting...");

    const response = await fetch(form.action, {
      method: "POST",
      body: JSON.stringify(formToPayload(new FormData(form))),
      headers: { "content-type": "application/json" },
    });
    const data = await response.json() as { ok: boolean; message?: string; errors?: string[] };

    if (response.ok && data.ok) {
      form.reset();
      status?.replaceChildren(data.message ?? "Submission received for organizer review.");
    } else {
      status?.replaceChildren(data.errors?.join(" ") ?? "Submission failed.");
    }
  });

  function formToPayload(data: FormData) {
    return {
      submitterCallsign: data.get("submitterCallsign"),
      submitterName: data.get("submitterName"),
      submitterEmail: data.get("submitterEmail"),
      club: data.get("club"),
      organizerNotes: data.get("organizerNotes"),
      stops: [
        {
          parkReference: data.get("stops[0][parkReference]"),
          plannedDate: data.get("stops[0][plannedDate]"),
          startTime: data.get("stops[0][startTime]"),
          endTime: data.get("stops[0][endTime]"),
          bands: splitList(data.get("stops[0][bands]")),
          modes: splitList(data.get("stops[0][modes]")),
          publicNotes: data.get("stops[0][publicNotes]"),
        },
      ],
    };
  }

  function splitList(value: FormDataEntryValue | null): string[] {
    return String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
</script>
```

- [ ] **Step 2: Create volunteer page**

Create `src/pages/activate-ri-2026/volunteer.astro`:

```astro
---
import Footer from "../../components/Footer.astro";
import Notice from "../../components/Notice.astro";
import SiteHeader from "../../components/SiteHeader.astro";
import EventNav from "../../components/activate-ri/EventNav.astro";
import VolunteerForm from "../../components/activate-ri/VolunteerForm.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
---

<BaseLayout
  title="Volunteer for Activate All RI 2026"
  description="Submit a Rhode Island POTA activation plan for organizer review."
  canonicalPath="/activate-ri-2026/volunteer/"
>
  <SiteHeader variant="solid" />
  <main id="main">
    <section class="section">
      <div class="container">
        <EventNav />
        <div class="section-header">
          <p class="eyebrow">Activator signup</p>
          <h1>Volunteer to activate</h1>
          <p class="lead">
            Submit one park now. Multi-park route editing will be added to this
            form after the API is in place.
          </p>
        </div>
        <VolunteerForm />
      </div>
    </section>
    <Notice />
  </main>
  <Footer />
</BaseLayout>
```

- [ ] **Step 3: Add form CSS**

Append to `src/styles/global.css`:

```css
.event-form {
  display: grid;
  gap: 1.2rem;
  max-width: 900px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.event-form label,
.activation-stop-fieldset {
  display: grid;
  gap: 0.35rem;
  color: var(--surface-ink);
  font-weight: 800;
}

.event-form input,
.event-form select,
.event-form textarea {
  width: 100%;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  padding: 0.7rem;
}

.activation-stop-fieldset {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 1rem;
}

.form-help,
.form-status {
  color: var(--text-muted);
}
```

- [ ] **Step 4: Build**

Run:

```bash
mise run check
mise run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj commit src/components/activate-ri/VolunteerForm.astro src/pages/activate-ri-2026/volunteer.astro src/styles/global.css -m "Add Activate RI volunteer form"
```

## Task 7: Worker API Foundation and D1 Schema

**Files:**

- Create: `src/worker/index.ts`
- Create: `src/worker/env.ts`
- Create: `src/worker/http.ts`
- Create: `migrations/0001_activate_ri_2026.sql`
- Create: `mise/tasks/activate-ri-2026/d1-apply-local`
- Modify: `wrangler.jsonc`
- Modify: `package.json` if `@cloudflare/workers-types` is not already available.

- [ ] **Step 1: Add D1 schema**

Create `migrations/0001_activate_ri_2026.sql`:

```sql
CREATE TABLE activate_ri_routes (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  submitter_callsign TEXT NOT NULL,
  submitter_name TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  submitter_phone TEXT NOT NULL DEFAULT '',
  club TEXT NOT NULL DEFAULT '',
  public_notes TEXT NOT NULL DEFAULT '',
  organizer_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  edit_token_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT
);

CREATE TABLE activate_ri_stops (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES activate_ri_routes(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  park_reference TEXT NOT NULL,
  planned_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  bands_json TEXT NOT NULL,
  modes_json TEXT NOT NULL,
  public_notes TEXT NOT NULL DEFAULT '',
  organizer_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending-review', 'scheduled', 'delayed', 'cancelled', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancel_reason TEXT
);

CREATE TABLE activate_ri_audit_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  route_id TEXT,
  stop_id TEXT,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX activate_ri_routes_status_idx ON activate_ri_routes(status);
CREATE INDEX activate_ri_stops_route_idx ON activate_ri_stops(route_id);
CREATE INDEX activate_ri_stops_status_idx ON activate_ri_stops(status);
CREATE INDEX activate_ri_stops_park_idx ON activate_ri_stops(park_reference);
```

- [ ] **Step 2: Create the D1 database**

Run:

```bash
npx wrangler d1 create ripota-org
```

Expected: Wrangler prints a `d1_databases` binding block. Copy the
`database_id` UUID from that command output into the config in the next step.
Do not commit account IDs, API tokens, or secrets.

- [ ] **Step 3: Update Wrangler config**

Modify `wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "ripota-org",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-06-14",
  "build": {
    "command": "npm run build"
  },
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ripota-org",
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "vars": {
    "ACTIVATE_RI_EVENT_ID": "activate-ri-2026",
    "TURNSTILE_REQUIRED": "false"
  },
  "observability": {
    "enabled": true
  }
}
```

Replace the all-zero `database_id` in the snippet with the UUID printed by
`npx wrangler d1 create ripota-org` before committing. `database_id` is not a
secret, but it must match the created database for deployment.

- [ ] **Step 4: Add Worker env types**

Create `src/worker/env.ts`:

```ts
export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  ACTIVATE_RI_EVENT_ID: "activate-ri-2026";
  TURNSTILE_REQUIRED: "true" | "false";
  TURNSTILE_SECRET_KEY?: string;
};
```

- [ ] **Step 5: Add HTTP helpers**

Create `src/worker/http.ts`:

```ts
export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Response("Expected application/json", { status: 415 });
  }

  return request.json();
}
```

- [ ] **Step 6: Add Worker router**

Create `src/worker/index.ts`:

```ts
import type { Env } from "./env";
import { json } from "./http";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/activate-ri-2026/health") {
      return json({ ok: true, eventId: env.ACTIVATE_RI_EVENT_ID });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 7: Add local D1 apply task**

Create `mise/tasks/activate-ri-2026/d1-apply-local`:

```bash
#!/usr/bin/env bash
# -*- mode: sh; sh-shell: bash; -*-
#MISE description="Apply Activate RI D1 migrations to local Wrangler D1"

set -euo pipefail

npx wrangler d1 migrations apply ripota-org --local
```

Make it executable:

```bash
chmod +x mise/tasks/activate-ri-2026/d1-apply-local
```

- [ ] **Step 8: Install Worker types when TypeScript reports missing Worker globals**

Run:

```bash
npm run check
```

If TypeScript cannot find `Fetcher`, `D1Database`, or Worker globals, install types:

```bash
npm install --save-dev @cloudflare/workers-types
```

Then add this line to `src/env.d.ts`:

```ts
/// <reference types="@cloudflare/workers-types" />
```

- [ ] **Step 9: Verify Worker health locally**

Run:

```bash
npx wrangler dev --local --port 8787
```

In another terminal:

```bash
curl -s http://localhost:8787/api/activate-ri-2026/health
```

Expected:

```json
{"ok":true,"eventId":"activate-ri-2026"}
```

Stop `wrangler dev` after the check.

- [ ] **Step 10: Commit**

```bash
jj commit wrangler.jsonc migrations/0001_activate_ri_2026.sql src/worker/index.ts src/worker/env.ts src/worker/http.ts mise/tasks/activate-ri-2026/d1-apply-local package.json package-lock.json src/env.d.ts -m "Add Activate RI Worker API foundation"
```

If `package.json`, `package-lock.json`, or `src/env.d.ts` did not change, omit them from the scoped commit.

## Task 8: Public Submission API

**Files:**

- Create: `src/worker/db.ts`
- Create: `src/worker/turnstile.ts`
- Create: `src/worker/routes/activate-ri.ts`
- Create: `src/worker/routes/activate-ri.test.ts`
- Modify: `src/worker/index.ts`

- [ ] **Step 1: Write handler test**

Create `src/worker/routes/activate-ri.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { handleActivateRiApi } from "./activate-ri";
import type { Env } from "../env";

function env(): Env {
  return {
    ACTIVATE_RI_EVENT_ID: "activate-ri-2026",
    TURNSTILE_REQUIRED: "false",
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(async () => ({ success: true })),
        all: vi.fn(),
        first: vi.fn(),
      })),
      batch: vi.fn(async () => []),
    } as unknown as D1Database,
  };
}

describe("handleActivateRiApi", () => {
  it("accepts a valid public route submission", async () => {
    const response = await handleActivateRiApi(
      new Request("https://ripota.org/api/activate-ri-2026/routes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submitterCallsign: "N1RWJ",
          submitterName: "Rob Jackson",
          submitterEmail: "rob@example.com",
          stops: [
            {
              parkReference: "US-2868",
              plannedDate: "2026-09-11",
              startTime: "09:00",
              endTime: "11:00",
              bands: ["40m"],
              modes: ["SSB"],
            },
          ],
        }),
      }),
      env(),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "Submission received for organizer review.",
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
mise run test -- src/worker/routes/activate-ri.test.ts
```

Expected: FAIL because `activate-ri.ts` does not exist.

- [ ] **Step 3: Add D1 insert helpers**

Create `src/worker/db.ts`:

```ts
import type { NormalizedRouteSubmission } from "../lib/activate-ri/types";
import type { Env } from "./env";

export async function insertPendingRoute(
  env: Env,
  submission: NormalizedRouteSubmission,
  now = new Date().toISOString(),
): Promise<void> {
  const routeId = crypto.randomUUID();

  const statements = [
    env.DB.prepare(
      `INSERT INTO activate_ri_routes (
        id, event_id, submitter_callsign, submitter_name, submitter_email,
        submitter_phone, club, public_notes, organizer_notes, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(
      routeId,
      env.ACTIVATE_RI_EVENT_ID,
      submission.submitterCallsign,
      submission.submitterName,
      submission.submitterEmail,
      submission.submitterPhone,
      submission.club,
      submission.publicNotes,
      submission.organizerNotes,
      now,
      now,
    ),
    ...submission.stops.map((stop) =>
      env.DB.prepare(
        `INSERT INTO activate_ri_stops (
          id, route_id, event_id, park_reference, planned_date, start_time,
          end_time, bands_json, modes_json, public_notes, organizer_notes,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending-review', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        routeId,
        env.ACTIVATE_RI_EVENT_ID,
        stop.parkReference,
        stop.plannedDate,
        stop.startTime,
        stop.endTime,
        JSON.stringify(stop.bands),
        JSON.stringify(stop.modes),
        stop.publicNotes,
        stop.organizerNotes,
        now,
        now,
      ),
    ),
  ];

  await env.DB.batch(statements);
}
```

- [ ] **Step 4: Add Turnstile helper**

Create `src/worker/turnstile.ts`:

```ts
import type { Env } from "./env";

export async function verifyTurnstile(
  request: Request,
  env: Env,
  token: string | undefined,
): Promise<boolean> {
  if (env.TURNSTILE_REQUIRED !== "true") {
    return true;
  }

  if (!token || !env.TURNSTILE_SECRET_KEY) {
    return false;
  }

  const formData = new FormData();
  formData.append("secret", env.TURNSTILE_SECRET_KEY);
  formData.append("response", token);
  formData.append("remoteip", request.headers.get("CF-Connecting-IP") ?? "");

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });
  const result = (await response.json()) as { success?: boolean };

  return result.success === true;
}
```

- [ ] **Step 5: Add API route handler**

Create `src/worker/routes/activate-ri.ts`:

```ts
import { validateRouteSubmission } from "../../lib/activate-ri/validation";
import { insertPendingRoute } from "../db";
import type { Env } from "../env";
import { json, readJson } from "../http";
import { verifyTurnstile } from "../turnstile";

export async function handleActivateRiApi(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/activate-ri-2026/routes" && request.method === "POST") {
    const payload = (await readJson(request)) as { turnstileToken?: string };
    const turnstileOk = await verifyTurnstile(request, env, payload.turnstileToken);

    if (!turnstileOk) {
      return json({ ok: false, errors: ["Bot check failed."] }, { status: 400 });
    }

    const result = validateRouteSubmission(payload);
    if (!result.ok) {
      return json({ ok: false, errors: result.errors }, { status: 400 });
    }

    await insertPendingRoute(env, result.value);
    return json(
      { ok: true, message: "Submission received for organizer review." },
      { status: 202 },
    );
  }

  return json({ ok: false, error: "Not found" }, { status: 404 });
}
```

- [ ] **Step 6: Wire the Worker router**

Modify `src/worker/index.ts`:

```ts
import type { Env } from "./env";
import { json } from "./http";
import { handleActivateRiApi } from "./routes/activate-ri";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/activate-ri-2026/health") {
      return json({ ok: true, eventId: env.ACTIVATE_RI_EVENT_ID });
    }

    if (url.pathname.startsWith("/api/activate-ri-2026/")) {
      return handleActivateRiApi(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 7: Run handler tests**

Run:

```bash
mise run test -- src/worker/routes/activate-ri.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
jj commit src/worker/db.ts src/worker/turnstile.ts src/worker/routes/activate-ri.ts src/worker/routes/activate-ri.test.ts src/worker/index.ts -m "Add Activate RI submission API"
```

## Task 9: Admin Moderation API and Access Guard

**Files:**

- Create: `src/worker/access.ts`
- Modify: `src/worker/routes/activate-ri.ts`
- Modify: `src/worker/routes/activate-ri.test.ts`
- Modify: `src/worker/db.ts`

- [ ] **Step 1: Add access helper**

Create `src/worker/access.ts`:

```ts
export type AccessIdentity = {
  email: string;
};

export function requireAccessIdentity(request: Request): AccessIdentity | Response {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");

  if (!email) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return { email };
}
```

- [ ] **Step 2: Add DB helpers for moderation**

Append to `src/worker/db.ts`:

```ts
export async function listPendingRoutes(env: Env): Promise<unknown[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM activate_ri_routes WHERE status = 'pending' ORDER BY created_at ASC`,
  ).all();

  return result.results ?? [];
}

export async function approveRoute(
  env: Env,
  routeId: string,
  actorEmail: string,
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE activate_ri_routes
       SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(now, actorEmail, now, routeId),
    env.DB.prepare(
      `UPDATE activate_ri_stops
       SET status = 'scheduled', updated_at = ?
       WHERE route_id = ? AND status = 'pending-review'`,
    ).bind(now, routeId),
    env.DB.prepare(
      `INSERT INTO activate_ri_audit_events
       (id, event_id, route_id, actor_email, action, details_json, created_at)
       VALUES (?, ?, ?, ?, 'approve-route', '{}', ?)`,
    ).bind(crypto.randomUUID(), env.ACTIVATE_RI_EVENT_ID, routeId, actorEmail, now),
  ]);
}
```

- [ ] **Step 3: Add admin tests**

Append to `src/worker/routes/activate-ri.test.ts`:

```ts
it("requires Cloudflare Access identity for admin routes", async () => {
  const response = await handleActivateRiApi(
    new Request("https://ripota.org/api/activate-ri-2026/admin/routes"),
    env(),
  );

  expect(response.status).toBe(401);
});
```

- [ ] **Step 4: Implement admin routes**

Modify `src/worker/routes/activate-ri.ts` to import access and DB helpers:

```ts
import { requireAccessIdentity } from "../access";
import { approveRoute, insertPendingRoute, listPendingRoutes } from "../db";
```

Then add these branches before the public route submission branch:

```ts
if (url.pathname === "/api/activate-ri-2026/admin/routes" && request.method === "GET") {
  const identity = requireAccessIdentity(request);
  if (identity instanceof Response) {
    return identity;
  }

  return json({ ok: true, routes: await listPendingRoutes(env) });
}

const approveMatch = url.pathname.match(
  /^\/api\/activate-ri-2026\/admin\/routes\/([^/]+)\/approve$/,
);
if (approveMatch && request.method === "POST") {
  const identity = requireAccessIdentity(request);
  if (identity instanceof Response) {
    return identity;
  }

  await approveRoute(env, approveMatch[1], identity.email);
  return json({ ok: true });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
mise run test -- src/worker/routes/activate-ri.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
jj commit src/worker/access.ts src/worker/db.ts src/worker/routes/activate-ri.ts src/worker/routes/activate-ri.test.ts -m "Add Activate RI admin moderation API"
```

## Task 10: Admin Dashboard UI

**Files:**

- Create: `src/components/activate-ri/AdminDashboard.astro`
- Create: `src/pages/activate-ri-2026/admin.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create admin dashboard shell**

Create `src/components/activate-ri/AdminDashboard.astro`:

```astro
<section class="admin-panel" data-admin-dashboard>
  <div class="section-header">
    <p class="eyebrow">Organizer tools</p>
    <h1>Activation review queue</h1>
    <p class="lead">Protected by Cloudflare Access in production.</p>
  </div>
  <button class="button" data-variant="primary" type="button" data-load-routes>
    Load pending submissions
  </button>
  <div class="admin-list" data-admin-list></div>
</section>

<script>
  const root = document.querySelector("[data-admin-dashboard]");
  const list = root?.querySelector("[data-admin-list]");
  const loadButton = root?.querySelector("[data-load-routes]");

  loadButton?.addEventListener("click", async () => {
    list?.replaceChildren("Loading...");
    const response = await fetch("/api/activate-ri-2026/admin/routes");
    const data = await response.json() as { ok: boolean; routes?: Array<Record<string, string>> };

    if (!response.ok || !data.ok) {
      list?.replaceChildren("Unable to load pending submissions.");
      return;
    }

    const routes = data.routes ?? [];
    if (routes.length === 0) {
      list?.replaceChildren("No pending submissions.");
      return;
    }

    list?.replaceChildren(...routes.map(renderRoute));
  });

  function renderRoute(route: Record<string, string>): HTMLElement {
    const article = document.createElement("article");
    article.className = "admin-card";
    article.innerHTML = `
      <h2>${escapeHtml(route.submitter_callsign ?? "")}</h2>
      <p>${escapeHtml(route.submitter_name ?? "")} · ${escapeHtml(route.submitter_email ?? "")}</p>
      <button class="button" data-variant="primary" type="button">Approve</button>
    `;
    article.querySelector("button")?.addEventListener("click", async () => {
      await fetch(`/api/activate-ri-2026/admin/routes/${route.id}/approve`, {
        method: "POST",
      });
      article.remove();
    });
    return article;
  }

  function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[char] ?? char;
    });
  }
</script>
```

- [ ] **Step 2: Create admin route**

Create `src/pages/activate-ri-2026/admin.astro`:

```astro
---
import Footer from "../../components/Footer.astro";
import Notice from "../../components/Notice.astro";
import SiteHeader from "../../components/SiteHeader.astro";
import AdminDashboard from "../../components/activate-ri/AdminDashboard.astro";
import EventNav from "../../components/activate-ri/EventNav.astro";
import BaseLayout from "../../layouts/BaseLayout.astro";
---

<BaseLayout
  title="Activate All RI Admin"
  description="Organizer tools for Activate All RI 2026."
  canonicalPath="/activate-ri-2026/admin/"
>
  <SiteHeader variant="solid" />
  <main id="main">
    <section class="section">
      <div class="container">
        <EventNav />
        <AdminDashboard />
      </div>
    </section>
    <Notice />
  </main>
  <Footer />
</BaseLayout>
```

- [ ] **Step 3: Add admin CSS**

Append to `src/styles/global.css`:

```css
.admin-panel {
  display: grid;
  gap: 1rem;
}

.admin-list {
  display: grid;
  gap: 1rem;
}

.admin-card {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-raised);
  padding: 1rem;
}

.admin-card h2 {
  font-size: 1.5rem;
}
```

- [ ] **Step 4: Build**

Run:

```bash
mise run check
mise run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj commit src/components/activate-ri/AdminDashboard.astro src/pages/activate-ri-2026/admin.astro src/styles/global.css -m "Add Activate RI admin dashboard"
```

## Task 11: Magic-Link Activator Edits and Cancellation

**Files:**

- Create: `src/components/activate-ri/ActivatorEditForm.astro`
- Create: `src/pages/activate-ri-2026/edit/[token].astro`
- Modify: `src/worker/db.ts`
- Modify: `src/worker/routes/activate-ri.ts`
- Modify: `src/worker/routes/activate-ri.test.ts`

- [ ] **Step 1: Add DB helpers for edit tokens and cancellation**

Append to `src/worker/db.ts`:

```ts
export async function cancelStopByToken(
  env: Env,
  tokenHash: string,
  stopId: string,
  cancelReason: string,
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.prepare(
    `UPDATE activate_ri_stops
     SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
     WHERE id = ?
       AND route_id IN (
         SELECT id FROM activate_ri_routes
         WHERE edit_token_hash = ? AND status = 'approved'
       )`,
  ).bind(now, cancelReason, now, stopId, tokenHash).run();
}

export async function updateStopByToken(
  env: Env,
  tokenHash: string,
  stopId: string,
  fields: {
    startTime: string;
    endTime: string;
    bands: string[];
    modes: string[];
    publicNotes: string;
  },
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.prepare(
    `UPDATE activate_ri_stops
     SET start_time = ?, end_time = ?, bands_json = ?, modes_json = ?,
         public_notes = ?, updated_at = ?
     WHERE id = ?
       AND route_id IN (
         SELECT id FROM activate_ri_routes
         WHERE edit_token_hash = ? AND status = 'approved'
       )`,
  ).bind(
    fields.startTime,
    fields.endTime,
    JSON.stringify(fields.bands),
    JSON.stringify(fields.modes),
    fields.publicNotes,
    now,
    stopId,
    tokenHash,
  ).run();
}
```

- [ ] **Step 2: Add token hash helper in API route**

In `src/worker/routes/activate-ri.ts`, add:

```ts
async function tokenHash(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 3: Add edit and cancel API branches**

In `src/worker/routes/activate-ri.ts`, import the new DB helpers and add:

```ts
const editStopMatch = url.pathname.match(
  /^\/api\/activate-ri-2026\/edit\/([^/]+)\/stops\/([^/]+)$/,
);
if (editStopMatch && request.method === "PATCH") {
  const [, token, stopId] = editStopMatch;
  const payload = (await readJson(request)) as {
    startTime: string;
    endTime: string;
    bands: string[];
    modes: string[];
    publicNotes?: string;
  };

  await updateStopByToken(env, await tokenHash(token), stopId, {
    startTime: payload.startTime,
    endTime: payload.endTime,
    bands: payload.bands,
    modes: payload.modes,
    publicNotes: payload.publicNotes ?? "",
  });
  return json({ ok: true });
}

const cancelStopMatch = url.pathname.match(
  /^\/api\/activate-ri-2026\/edit\/([^/]+)\/stops\/([^/]+)\/cancel$/,
);
if (cancelStopMatch && request.method === "POST") {
  const [, token, stopId] = cancelStopMatch;
  const payload = (await readJson(request)) as { cancelReason?: string };
  await cancelStopByToken(
    env,
    await tokenHash(token),
    stopId,
    String(payload.cancelReason ?? ""),
  );
  return json({ ok: true });
}
```

- [ ] **Step 4: Add edit page shell**

Create `src/components/activate-ri/ActivatorEditForm.astro`:

```astro
---
type Props = { token: string };
const { token } = Astro.props;
---

<section class="admin-panel" data-edit-token={token}>
  <div class="section-header">
    <p class="eyebrow">Activator updates</p>
    <h1>Update your activation</h1>
    <p class="lead">
      Use this private link to update approved schedule details or cancel a stop.
    </p>
  </div>
  <p class="form-help">
    Stop editing controls will load from the API after approved route lookup is added.
  </p>
</section>
```

Create `src/pages/activate-ri-2026/edit/[token].astro`:

```astro
---
import Footer from "../../../components/Footer.astro";
import Notice from "../../../components/Notice.astro";
import SiteHeader from "../../../components/SiteHeader.astro";
import ActivatorEditForm from "../../../components/activate-ri/ActivatorEditForm.astro";
import BaseLayout from "../../../layouts/BaseLayout.astro";

const { token } = Astro.params;
---

<BaseLayout
  title="Update Activation"
  description="Update an approved Activate All RI activation."
  canonicalPath={`/activate-ri-2026/edit/${token}/`}
>
  <SiteHeader variant="solid" />
  <main id="main">
    <section class="section">
      <div class="container">
        <ActivatorEditForm token={token ?? ""} />
      </div>
    </section>
    <Notice />
  </main>
  <Footer />
</BaseLayout>
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
mise run test -- src/worker/routes/activate-ri.test.ts
mise run check
mise run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
jj commit src/worker/db.ts src/worker/routes/activate-ri.ts src/worker/routes/activate-ri.test.ts src/components/activate-ri/ActivatorEditForm.astro src/pages/activate-ri-2026/edit -m "Add Activate RI activator edit endpoints"
```

## Task 12: Automatic and Manual Public Publish from D1

**Files:**

- Modify: `scripts/activate-ri-2026/publish-public-data.mjs`
- Modify: `src/worker/db.ts`
- Modify: `src/worker/routes/activate-ri.ts`
- Modify: `src/worker/routes/activate-ri.test.ts`

- [ ] **Step 1: Add DB export helper**

Append to `src/worker/db.ts`:

```ts
export async function listPublicStopRows(env: Env): Promise<unknown[]> {
  const result = await env.DB.prepare(
    `SELECT
       s.id,
       s.park_reference,
       s.planned_date,
       s.start_time,
       s.end_time,
       r.submitter_callsign,
       r.submitter_email,
       r.submitter_phone,
       s.bands_json,
       s.modes_json,
       s.public_notes,
       s.organizer_notes,
       s.status
     FROM activate_ri_stops s
     INNER JOIN activate_ri_routes r ON r.id = s.route_id
     WHERE r.status = 'approved'
       AND s.status IN ('scheduled', 'delayed', 'cancelled', 'completed')
     ORDER BY s.planned_date ASC, s.start_time ASC`,
  ).all();

  return result.results ?? [];
}
```

- [ ] **Step 2: Add manual rebuild endpoint**

In `src/worker/routes/activate-ri.ts`, add an admin-only endpoint:

```ts
if (url.pathname === "/api/activate-ri-2026/admin/publish" && request.method === "POST") {
  const identity = requireAccessIdentity(request);
  if (identity instanceof Response) {
    return identity;
  }

  const rows = await listPublicStopRows(env);
  return json({
    ok: true,
    message: "Public data can be regenerated from the returned rows.",
    rows,
  });
}
```

This endpoint is an operational fallback. The local task remains the source for writing files into `public/data/activate-ri-2026/` during development and checked-in static generation.

- [ ] **Step 3: Update publish script for optional DB export file**

Modify `scripts/activate-ri-2026/publish-public-data.mjs` so it reads `tmp/activate-ri-2026/public-stop-rows.json` if present, otherwise uses sample stops:

```js
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
```

Add:

```js
const dbRowsPath = resolve(root, "tmp/activate-ri-2026/public-stop-rows.json");
const stops = await loadStops();
const coverage = deriveParkCoverage(parks, stops);
```

Replace previous `sampleActivationStops` usage with `stops`, then add:

```js
async function loadStops() {
  try {
    await access(dbRowsPath);
    const { routeRowsToPublicStops } = await import(
      "../../src/lib/activate-ri/public-export.ts"
    );
    const rows = JSON.parse(await readFile(dbRowsPath, "utf8"));
    return routeRowsToPublicStops(rows);
  } catch {
    return sampleActivationStops;
  }
}
```

- [ ] **Step 4: Verify publish still works**

Run:

```bash
mise run activate-ri-2026/publish
```

Expected: the four public JSON files are regenerated.

- [ ] **Step 5: Run tests**

Run:

```bash
mise run test
mise run check
mise run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
jj commit scripts/activate-ri-2026/publish-public-data.mjs src/worker/db.ts src/worker/routes/activate-ri.ts src/worker/routes/activate-ri.test.ts public/data/activate-ri-2026 -m "Add Activate RI public data rebuild flow"
```

## Task 13: Turnstile Wiring

**Files:**

- Modify: `src/components/activate-ri/VolunteerForm.astro`
- Modify: `wrangler.jsonc`
- Configure Cloudflare Turnstile widget and `TURNSTILE_SECRET_KEY` outside the repository.

- [ ] **Step 1: Create or choose a Turnstile widget**

Use the Cloudflare dashboard or the Turnstile setup workflow. Register:

```text
localhost
127.0.0.1
ripota.org
```

Store the secret as a Worker secret:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Do not commit the secret.

- [ ] **Step 2: Add public site key var**

Modify `wrangler.jsonc` vars:

```jsonc
"vars": {
  "ACTIVATE_RI_EVENT_ID": "activate-ri-2026",
  "TURNSTILE_REQUIRED": "true",
  "PUBLIC_TURNSTILE_SITE_KEY": "1x00000000000000000000AA"
}
```

The value above is Cloudflare's visible test sitekey that always passes in
development. Before production deployment, replace it with the real public
sitekey from the Turnstile widget. The secret remains outside the repository.

- [ ] **Step 3: Add widget to volunteer form**

In `src/components/activate-ri/VolunteerForm.astro`, add before the submit button:

```astro
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div
  class="cf-turnstile"
  data-sitekey="1x00000000000000000000AA"
  data-action="activate-ri-volunteer"
></div>
```

Then include the token in `formToPayload`:

```ts
turnstileToken: data.get("cf-turnstile-response"),
```

- [ ] **Step 4: Verify local fallback**

For local development before real keys exist, set `TURNSTILE_REQUIRED` to `false` and verify submissions still reach the API.

Run:

```bash
npx wrangler dev --local --port 8787
```

Submit the volunteer form at `http://localhost:8787/activate-ri-2026/volunteer/`.

Expected: form shows `Submission received for organizer review.`

- [ ] **Step 5: Commit public wiring**

```bash
jj commit src/components/activate-ri/VolunteerForm.astro wrangler.jsonc -m "Add Turnstile to Activate RI volunteer form"
```

## Task 14: Final Verification

**Files:**

- No new files unless fixes are needed.

- [ ] **Step 1: Run unit tests**

Run:

```bash
mise run test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run Astro check**

Run:

```bash
mise run check
```

Expected: exits 0.

- [ ] **Step 3: Run production build**

Run:

```bash
mise run build
```

Expected: exits 0 and writes `dist/`.

- [ ] **Step 4: Run Worker locally**

Run:

```bash
npx wrangler dev --local --port 8787
```

Verify:

```bash
curl -s http://localhost:8787/api/activate-ri-2026/health
curl -I http://localhost:8787/activate-ri-2026/
curl -I http://localhost:8787/data/activate-ri-2026/coverage.json
```

Expected:

- Health returns `{"ok":true,"eventId":"activate-ri-2026"}`.
- Event page returns HTTP 200.
- Coverage JSON returns HTTP 200.

- [ ] **Step 5: Browser verification**

Open `http://localhost:8787/activate-ri-2026/`.

Check:

- The first screen is event-specific, not a generic landing page.
- Primary CTA is "Volunteer to activate" in planning phase.
- Unofficial community-site disclaimer appears.
- Navigation links to volunteer, schedule, and parks work.
- Tables do not overflow at mobile width.
- Form labels and controls are readable.
- No UI says a park is live or currently active without spot data.

- [ ] **Step 6: Final scoped commit if verification fixes were needed**

If Task 14 required fixes, commit only those files:

```bash
jj commit <fixed-files> -m "Verify Activate RI phase one"
```

If no files changed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: Phase 1 activator recruitment, moderation, public coverage, static JSON, admin auth shape, magic-link edits, cancellation, and manual rebuild are covered. Hunter tools and awards are intentionally deferred.
- Public/private boundary: public JSON export and table components exclude email, phone, edit tokens, organizer notes, raw logs, and audit history.
- Type consistency: event, route, stop, coverage, and public JSON names match between tasks.
- Cloudflare routing: this plan follows the current Workers Static Assets model with a Worker `main`, `ASSETS` binding, and `/api/*` worker-first routing.
