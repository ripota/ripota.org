# Activate RI Map Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Activate All RI 2026 coverage map into the landing-page hero, add recruiting-phase coverage stats, and replace the lower duplicate map with a volunteer CTA band.

**Architecture:** Add one shared coverage summary helper in `src/lib/activate-ri/coverage.ts`, then have `EventHero.astro` own the new two-column recruiting hero by composing `ReferenceMap` and the helper output. Keep the lower page section focused on guidance and a single volunteer action band, with CSS contained in `src/styles/global.css`.

**Tech Stack:** Astro components, TypeScript, Leaflet via the existing `ReferenceMap` component, Vitest, jj.

---

## File Map

- `src/lib/activate-ri/coverage.ts`: add `summarizeParkCoverage(parks, stops)` to centralize scheduled and gap counts.
- `src/lib/activate-ri/coverage.test.ts`: add failing tests for the new summary helper before implementation.
- `src/components/activate-ri/CoverageSummary.astro`: consume the shared helper so old summary semantics remain centralized.
- `src/components/activate-ri/EventHero.astro`: render the new two-column hero, coverage stat blocks, and hero map.
- `src/components/activate-ri/VolunteerCtaBand.astro`: add a focused reusable CTA band for the overview section.
- `src/pages/activate-ri-2026/index.astro`: remove the lower `CoverageSummary` and `ReferenceMap`, then render `VolunteerCtaBand`.
- `src/styles/global.css`: add responsive hero, hero stat, hero map, and CTA band styles.

## Task 1: Shared Coverage Summary Helper

**Files:**
- Modify: `src/lib/activate-ri/coverage.test.ts`
- Modify: `src/lib/activate-ri/coverage.ts`
- Modify: `src/components/activate-ri/CoverageSummary.astro`

- [ ] **Step 1: Write the failing tests**

Add `summarizeParkCoverage` to the import in `src/lib/activate-ri/coverage.test.ts`:

```ts
import { deriveParkCoverage, summarizeParkCoverage } from "./coverage";
```

Append these tests inside the existing `describe("deriveParkCoverage", () => { ... })` block:

```ts
  it("summarizes scheduled parks and coverage gaps", () => {
    const parks = [
      park,
      {
        reference: "US-2869",
        name: "Brenton Point State Park",
        counties: ["Newport County"],
      },
      {
        reference: "US-2870",
        name: "Colt State Park",
        counties: ["Bristol County"],
      },
      {
        reference: "US-2871",
        name: "Fort Adams State Park",
        counties: ["Newport County"],
      },
    ];
    const stops: PublicActivationStop[] = [
      {
        id: "scheduled",
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
      {
        id: "completed",
        parkReference: "US-2869",
        plannedDate: "2026-09-11",
        startTime: "12:00",
        endTime: "14:00",
        activatorCallsign: "K1ABC",
        bands: ["20m"],
        modes: ["SSB"],
        publicNotes: "",
        status: "completed",
      },
      {
        id: "cancelled",
        parkReference: "US-2870",
        plannedDate: "2026-09-12",
        startTime: "09:00",
        endTime: "11:00",
        activatorCallsign: "W1POTA",
        bands: ["15m"],
        modes: ["FT8"],
        publicNotes: "Cancelled.",
        status: "cancelled",
      },
    ];

    expect(summarizeParkCoverage(parks, stops)).toEqual({
      scheduled: 2,
      gaps: 2,
      total: 4,
    });
  });

  it("ignores sample stops when summarizing coverage", () => {
    const stops: PublicActivationStop[] = [
      {
        id: "sample-demo",
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

    expect(summarizeParkCoverage([park], stops)).toEqual({
      scheduled: 0,
      gaps: 1,
      total: 1,
    });
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
rtk npm test -- src/lib/activate-ri/coverage.test.ts
```

Expected: FAIL because `summarizeParkCoverage` is not exported.

- [ ] **Step 3: Implement the helper**

Add this export to `src/lib/activate-ri/coverage.ts` after `deriveParkCoverage`:

```ts
export type CoverageSummaryCounts = {
  scheduled: number;
  gaps: number;
  total: number;
};

export function summarizeParkCoverage(
  parks: PublicParkSummary[],
  stops: PublicActivationStop[],
): CoverageSummaryCounts {
  const visibleStops = stops.filter((stop) => !stop.id.startsWith("sample-"));
  const coverage = deriveParkCoverage(parks, visibleStops);

  return {
    scheduled: coverage.filter((park) =>
      ["scheduled", "multiple-scheduled", "completed"].includes(park.status),
    ).length,
    gaps: coverage.filter((park) =>
      ["uncovered", "cancelled-needs-replacement"].includes(park.status),
    ).length,
    total: coverage.length,
  };
}
```

- [ ] **Step 4: Update `CoverageSummary.astro` to use the helper**

Replace its current `deriveParkCoverage` import and count logic with:

```astro
---
import parks from "../../../public/data/activate-ri-2026/parks.json";
import schedule from "../../../public/data/activate-ri-2026/schedule.json";
import { summarizeParkCoverage } from "../../lib/activate-ri/coverage";
import type { PublicActivationStop, PublicParkSummary } from "../../lib/activate-ri/types";

const summary = summarizeParkCoverage(
  parks as PublicParkSummary[],
  schedule as PublicActivationStop[],
);
---

<dl class="coverage-summary" aria-label="Activate All RI coverage summary">
  <div>
    <dt>Parks scheduled</dt>
    <dd>{summary.scheduled} / {summary.total}</dd>
  </div>
  <div>
    <dt>Coverage gaps</dt>
    <dd>{summary.gaps}</dd>
  </div>
</dl>
```

- [ ] **Step 5: Run the tests and verify they pass**

Run:

```bash
rtk npm test -- src/lib/activate-ri/coverage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit only this task's files**

Run:

```bash
rtk jj diff src/lib/activate-ri/coverage.ts src/lib/activate-ri/coverage.test.ts src/components/activate-ri/CoverageSummary.astro
rtk jj commit src/lib/activate-ri/coverage.ts src/lib/activate-ri/coverage.test.ts src/components/activate-ri/CoverageSummary.astro -m "Add Activate RI coverage summary helper"
```

## Task 2: Map-Forward Recruiting Hero

**Files:**
- Modify: `src/components/activate-ri/EventHero.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add hero data imports and summary counts**

In `src/components/activate-ri/EventHero.astro`, add imports for the existing map, event JSON, schedule JSON, coverage helper, and public types:

```astro
import parks from "../../../public/data/activate-ri-2026/parks.json";
import schedule from "../../../public/data/activate-ri-2026/schedule.json";
import ReferenceMap from "../ReferenceMap.astro";
import { activateRi2026Event } from "../../data/activate-ri-2026/event";
import { summarizeParkCoverage } from "../../lib/activate-ri/coverage";
import type { PublicActivationStop, PublicParkSummary } from "../../lib/activate-ri/types";
```

Add this summary constant near the existing date and CTA constants:

```ts
const coverageSummary = summarizeParkCoverage(
  parks as PublicParkSummary[],
  schedule as PublicActivationStop[],
);
```

- [ ] **Step 2: Replace hero markup**

Replace the existing `<section class="event-hero" ...>` block with:

```astro
<section class="event-hero" aria-labelledby="event-title">
  <div class="container event-hero__inner">
    <div class="event-hero__content">
      <p class="eyebrow">{dateRangeLabel}</p>
      <h1 id="event-title">Activate All RI</h1>
      <p class="event-hero__copy">
        Help the Rhode Island POTA community cover all {activateRi2026Event.goalParkCount}
        Rhode Island references during one coordinated weekend. A soft start is
        planned for {softStartLabel}.
      </p>
      <dl class="event-hero__stats" aria-label="Activate All RI coverage progress">
        <div>
          <dt>Parks scheduled</dt>
          <dd>{coverageSummary.scheduled} / {coverageSummary.total}</dd>
        </div>
        <div>
          <dt>Coverage gaps</dt>
          <dd>{coverageSummary.gaps}</dd>
        </div>
      </dl>
      <div class="button-row" aria-label="Event actions">
        <a class="button" data-variant="primary" href={ctas.primary.href}>
          {ctas.primary.label}
        </a>
        <a class="button" data-variant="light" href={ctas.secondary.href}>
          {ctas.secondary.label}
        </a>
      </div>
    </div>
    <div class="event-hero__map">
      <ReferenceMap
        id="activate-ri-hero-coverage-map"
        variant="coverage"
        title="Map of Activate All RI 2026 coverage"
        caption="Coverage means a planned activation window for community coordination. Official Parks on the Air resources remain authoritative for rules, spots, logs, awards, and activation validity."
        phaseFocus="volunteer"
        legendPlacement="overlay"
        legendTitle="Volunteer coverage"
      />
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add responsive hero CSS**

In `src/styles/global.css`, replace the existing `.event-hero`, `.event-hero h1`, and `.event-hero__copy` rules with:

```css
.event-hero {
  padding: calc(var(--header-height) + 3rem) 0 clamp(3rem, 6vw, 5rem);
  overflow: hidden;
  background:
    radial-gradient(circle at 85% 15%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 24rem),
    linear-gradient(135deg, var(--surface-brand), color-mix(in srgb, var(--surface-brand) 82%, #000 18%));
  color: var(--text-on-hero);
}

.event-hero__inner {
  display: grid;
  grid-template-columns: minmax(0, 0.86fr) minmax(340px, 1.08fr);
  gap: clamp(1.5rem, 4vw, 3rem);
  align-items: center;
}

.event-hero__content {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.event-hero h1 {
  max-width: 7.5ch;
  color: var(--text-on-hero);
  font-size: clamp(3.25rem, 7vw, 5.8rem);
}

.event-hero__copy {
  max-width: 660px;
  color: color-mix(in srgb, var(--text-on-hero) 86%, transparent);
  font-size: 1.2rem;
}

.event-hero__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 11rem));
  gap: 0.75rem;
  margin: 0.35rem 0 0.15rem;
}

.event-hero__stats div {
  border: 1px solid color-mix(in srgb, var(--text-on-hero) 22%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-on-hero) 10%, transparent);
  padding: 0.85rem;
}

.event-hero__stats dt {
  color: color-mix(in srgb, var(--text-on-hero) 72%, transparent);
  font-size: 0.82rem;
  font-weight: 900;
}

.event-hero__stats dd {
  margin: 0.15rem 0 0;
  color: var(--text-on-hero);
  font-size: clamp(1.65rem, 4vw, 2.25rem);
  font-weight: 950;
  line-height: 1;
}

.event-hero__map {
  min-width: 0;
}

.event-hero__map .map-preview {
  min-height: clamp(360px, 42vw, 520px);
  border-color: color-mix(in srgb, var(--text-on-hero) 22%, transparent);
  background: var(--map-water);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
}

.event-hero__map .ri-reference-map {
  height: clamp(360px, 42vw, 520px);
}

.event-hero__map .map-preview__caption {
  font-size: 0.78rem;
}
```

Add this media query near the existing responsive rules:

```css
@media (max-width: 860px) {
  .event-hero__inner {
    grid-template-columns: 1fr;
  }

  .event-hero__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .event-hero__stats {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run Astro check**

Run:

```bash
rtk npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit only this task's files**

Run:

```bash
rtk jj diff src/components/activate-ri/EventHero.astro src/styles/global.css
rtk jj commit src/components/activate-ri/EventHero.astro src/styles/global.css -m "Move Activate RI coverage map into hero"
```

## Task 3: Lower Volunteer CTA Band

**Files:**
- Create: `src/components/activate-ri/VolunteerCtaBand.astro`
- Modify: `src/pages/activate-ri-2026/index.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create the CTA component**

Create `src/components/activate-ri/VolunteerCtaBand.astro`:

```astro
---
import { eventRoute } from "../../lib/activate-ri/paths";
---

<section class="volunteer-cta-band" aria-labelledby="volunteer-cta-title">
  <div class="volunteer-cta-band__copy">
    <p class="eyebrow">Activator signups</p>
    <h2 id="volunteer-cta-title">Help fill the Rhode Island map</h2>
    <p>
      Submit one park or a multi-park route for organizer review, then update
      your plan if timing or access changes.
    </p>
  </div>
  <div class="button-row volunteer-cta-band__actions" aria-label="Volunteer actions">
    <a class="button" data-variant="primary" href={eventRoute("volunteer")}>
      Volunteer to Activate
    </a>
    <a class="button" data-variant="light" href={eventRoute("schedule")}>
      See the schedule
    </a>
  </div>
</section>
```

- [ ] **Step 2: Update the overview page**

In `src/pages/activate-ri-2026/index.astro`:

- Remove `CoverageSummary` import.
- Remove `ReferenceMap` import.
- Add:

```astro
import VolunteerCtaBand from "../../components/activate-ri/VolunteerCtaBand.astro";
```

Remove this lower map block:

```astro
        <CoverageSummary />
        <ReferenceMap
          id="activate-ri-coverage-map"
          variant="coverage"
          title="Map of Activate All RI 2026 coverage"
          caption="Coverage means a planned activation window for community coordination. Official Parks on the Air resources remain authoritative for rules, spots, logs, awards, and activation validity."
          phaseFocus="volunteer"
          legendPlacement="below"
          legendTitle="Volunteer coverage legend"
        />
```

Replace it with:

```astro
        <VolunteerCtaBand />
```

- [ ] **Step 3: Add CTA band CSS**

Append these rules near the other Activate RI styles in `src/styles/global.css`:

```css
.volunteer-cta-band {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: clamp(1rem, 4vw, 2rem);
  align-items: center;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--surface-brand) 94%, var(--accent)), var(--surface-brand));
  color: var(--text-on-hero);
  padding: clamp(1.25rem, 4vw, 2rem);
  box-shadow: var(--shadow-soft);
}

.volunteer-cta-band h2 {
  color: var(--text-on-hero);
  font-size: clamp(2rem, 4vw, 3rem);
}

.volunteer-cta-band p:not(.eyebrow) {
  max-width: 640px;
  color: color-mix(in srgb, var(--text-on-hero) 84%, transparent);
  font-size: 1.05rem;
}

.volunteer-cta-band .eyebrow {
  color: #f1c883;
}

.volunteer-cta-band__copy {
  display: grid;
  gap: 0.65rem;
}

.volunteer-cta-band__actions {
  justify-content: flex-end;
}

.volunteer-cta-band .button[data-variant="light"] {
  border-color: rgba(255, 250, 240, 0.62);
  background: rgba(255, 250, 240, 0.1);
  color: var(--text-on-hero);
}
```

Add this to the `@media (max-width: 860px)` rule:

```css
  .volunteer-cta-band {
    grid-template-columns: 1fr;
  }

  .volunteer-cta-band__actions {
    justify-content: flex-start;
  }
```

- [ ] **Step 4: Run Astro check**

Run:

```bash
rtk npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit only this task's files**

Run:

```bash
rtk jj diff src/components/activate-ri/VolunteerCtaBand.astro src/pages/activate-ri-2026/index.astro src/styles/global.css
rtk jj commit src/components/activate-ri/VolunteerCtaBand.astro src/pages/activate-ri-2026/index.astro src/styles/global.css -m "Add Activate RI volunteer CTA band"
```

## Task 4: Final Verification

**Files:**
- No planned source edits. Fix only defects found in verification.

- [ ] **Step 1: Run focused tests**

Run:

```bash
rtk npm test -- src/lib/activate-ri/coverage.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full project check**

Run:

```bash
rtk npm run check
```

Expected: PASS.

- [ ] **Step 3: Run the local build**

Run:

```bash
rtk npm run build:local
```

Expected: PASS.

- [ ] **Step 4: Browser verify the landing page**

Start the dev server:

```bash
rtk npm run dev -- --host 127.0.0.1
```

Open `/activate-ri-2026/` and verify:

- The first viewport has the `Activate All RI` hero copy, coverage stats, and
  two CTAs.
- The coverage map appears inside the hero and is nonblank.
- The map legend and caption are visible.
- A map marker or boundary popup can open.
- The overview section no longer has a second full coverage map.
- The lower CTA band has `Volunteer to Activate` and `See the schedule` links.
- At a mobile viewport, the hero stacks without text or button overflow.

- [ ] **Step 5: Commit verification fixes only if needed**

If verification required fixes, inspect the changed file list and commit only
the files changed for those fixes. For example, if the fix was limited to hero
CSS and the CTA component, run:

```bash
rtk jj diff src/styles/global.css src/components/activate-ri/VolunteerCtaBand.astro
rtk jj commit src/styles/global.css src/components/activate-ri/VolunteerCtaBand.astro -m "Fix Activate RI map hero verification issues"
```

If no source fixes were needed, do not create an empty commit.
