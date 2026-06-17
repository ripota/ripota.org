# Activate RI 2026 Park Row Volunteer CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a focused row-level volunteer CTA to actionable Activate RI park coverage gaps and preselect the park on the volunteer form.

**Architecture:** Add one small coverage helper that defines which coverage statuses can receive volunteer action. Use that helper in the Astro table's server-rendered fallback and in the client live-render path. Reuse the existing volunteer form `addParkReferenceToForm` path for `?park=US-XXXX` links so map and row CTA behavior stay consistent.

**Tech Stack:** Astro components, browser TypeScript in Astro scripts, TypeScript utilities, Vitest, existing CSS.

---

## File Structure

- Modify `src/lib/activate-ri/coverage.ts`: export `isParkVolunteerActionable(status)` so server and client code share the status policy.
- Modify `src/lib/activate-ri/coverage.test.ts`: add helper coverage for actionable and non-actionable statuses.
- Modify `src/components/activate-ri/ParkCoverageTable.astro`: render compact `Volunteer` links only for `uncovered` and `cancelled-needs-replacement` rows in both fallback and live rows.
- Modify `src/components/activate-ri/VolunteerForm.astro`: read `park` from the URL on load and reuse `addParkReferenceToForm`.
- Modify `src/styles/global.css`: add compact `.event-table-action` styling for table-cell links.

## Task 1: Add Coverage Action Helper

**Files:**
- Modify: `src/lib/activate-ri/coverage.ts`
- Test: `src/lib/activate-ri/coverage.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these imports and tests in `src/lib/activate-ri/coverage.test.ts`:

```ts
import { deriveParkCoverage, isParkVolunteerActionable, summarizeParkCoverage } from "./coverage";
```

```ts
describe("isParkVolunteerActionable", () => {
  it("returns true for park coverage gaps that need activators", () => {
    expect(isParkVolunteerActionable("uncovered")).toBe(true);
    expect(isParkVolunteerActionable("cancelled-needs-replacement")).toBe(true);
  });

  it("returns false for parks that already have coverage", () => {
    expect(isParkVolunteerActionable("scheduled")).toBe(false);
    expect(isParkVolunteerActionable("multiple-scheduled")).toBe(false);
    expect(isParkVolunteerActionable("completed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
rtk npm test -- src/lib/activate-ri/coverage.test.ts
```

Expected: FAIL because `isParkVolunteerActionable` is not exported.

- [ ] **Step 3: Implement the helper**

Add this export near the top of `src/lib/activate-ri/coverage.ts`:

```ts
const volunteerActionableStatuses = new Set<ParkCoverage["status"]>([
  "uncovered",
  "cancelled-needs-replacement",
]);

export function isParkVolunteerActionable(status: ParkCoverage["status"]): boolean {
  return volunteerActionableStatuses.has(status);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
rtk npm test -- src/lib/activate-ri/coverage.test.ts
```

Expected: PASS.

## Task 2: Render Row CTA in Park Coverage Table

**Files:**
- Modify: `src/components/activate-ri/ParkCoverageTable.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Import and use the helper in fallback rows**

Update the import in `src/components/activate-ri/ParkCoverageTable.astro`:

```ts
import { deriveParkCoverage, isParkVolunteerActionable } from "../../lib/activate-ri/coverage";
```

Add this helper near the existing formatting helpers:

```ts
function volunteerHref(reference: string) {
  return `/activate-ri-2026/volunteer/?park=${encodeURIComponent(reference)}`;
}
```

Replace the fallback status cell with:

```astro
<td data-label="Status">
  {statusLabels[park.status] ?? park.status}
  {isParkVolunteerActionable(park.status) && (
    <a class="button event-table-action" href={volunteerHref(park.reference)}>
      Volunteer
    </a>
  )}
</td>
```

- [ ] **Step 2: Add the client-side status policy and link helper**

Inside the `<script>` in `ParkCoverageTable.astro`, add:

```ts
  const volunteerActionableStatuses = new Set(["uncovered", "cancelled-needs-replacement"]);
```

Add these functions near the status label helpers:

```ts
  function isParkVolunteerActionable(status: string): boolean {
    return volunteerActionableStatuses.has(status);
  }

  function volunteerHref(reference: string): string {
    return `/activate-ri-2026/volunteer/?park=${encodeURIComponent(reference)}`;
  }
```

- [ ] **Step 3: Render the client-side live row action**

Replace the live status cell call in `createCoverageRow`:

```ts
appendCell(row, "Status", coverageStatusLabel(park.status));
```

with:

```ts
appendStatusCell(row, park);
```

Then add this function before `appendCell`:

```ts
  function appendStatusCell(row: HTMLTableRowElement, park: CoverageRow): void {
    const cell = document.createElement("td");
    cell.dataset.label = "Status";
    cell.append(coverageStatusLabel(park.status));

    if (isParkVolunteerActionable(park.status)) {
      const link = document.createElement("a");
      link.className = "button event-table-action";
      link.href = volunteerHref(park.reference);
      link.textContent = "Volunteer";
      cell.appendChild(link);
    }

    row.appendChild(cell);
  }
```

- [ ] **Step 4: Add compact table-action styling**

Add this after `.event-stop-list__item span` in `src/styles/global.css`:

```css
.event-table-action {
  align-self: start;
  min-height: 36px;
  margin-top: 0.55rem;
  padding: 0.48rem 0.72rem;
  font-size: 0.9rem;
}
```

- [ ] **Step 5: Run build verification**

Run:

```bash
rtk npm run build:local
```

Expected: PASS.

## Task 3: Prefill Volunteer Form from URL

**Files:**
- Modify: `src/components/activate-ri/VolunteerForm.astro`

- [ ] **Step 1: Write the implementation using the existing selection path**

After `setupStopCards();` in the script startup section, add:

```ts
  prefillParkFromUrl();
```

Add this function near `addParkReferenceToForm`:

```ts
  function prefillParkFromUrl(): void {
    const reference = new URLSearchParams(window.location.search).get("park");
    if (!reference) {
      return;
    }

    addParkReferenceToForm(reference.toUpperCase());
  }
```

- [ ] **Step 2: Confirm invalid park parameters are ignored**

Check that `addParkReferenceToForm` already calls `selectParkReference`, shows `Could not find ${reference} in the park list.`, and returns without blocking the form. Because the design requires invalid values to be ignored without an error, update that function so the invalid message is optional:

```ts
  function addParkReferenceToForm(reference: string, options: { silentInvalid?: boolean } = {}): void {
    const targetStop = firstEmptyStopCard() ?? appendBlankStop();
    if (!targetStop) {
      return;
    }

    const selected = selectParkReference(targetStop, reference);
    if (!selected) {
      if (!options.silentInvalid) {
        status?.replaceChildren(`Could not find ${reference} in the park list.`);
      }
      return;
    }

    setupStopCards();
    targetStop.scrollIntoView({ behavior: "smooth", block: "center" });
    (targetStop.querySelector("[data-planned-date]") as HTMLSelectElement | null)?.focus();
    status?.replaceChildren(`${reference} added to the activation plan. Choose the date, time, bands, and modes before submitting.`);
  }
```

Then update `prefillParkFromUrl` to call:

```ts
    addParkReferenceToForm(reference.toUpperCase(), { silentInvalid: true });
```

- [ ] **Step 3: Run type/build verification**

Run:

```bash
rtk npm run build:local
```

Expected: PASS.

## Task 4: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
rtk npm test -- src/lib/activate-ri/coverage.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full build**

Run:

```bash
rtk npm run build:local
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
rtk jj diff
```

Expected: diff only includes the coverage helper/test, parks table CTA, volunteer form prefill, compact CSS, and this plan file.
