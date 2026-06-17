# Activate RI 2026 Unified Edit Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the activator edit page use the same form fields, map, Turnstile protection, and visual treatment as the public volunteer page.

**Architecture:** Extract the shared Activate RI identity and stop-card markup into Astro components consumed by both forms. Keep submit/edit scripts separate, but make edit mode adapt the shared controls into the existing PATCH payload by deriving `startTime` and `endTime` from `timeBlock`.

**Tech Stack:** Astro components, TypeScript in Astro scripts, Vitest raw component tests, existing Activate RI validation helpers, Cloudflare Turnstile.

---

### Task 1: Pin Edit Form Parity With Failing Tests

**Files:**
- Create: `src/components/activate-ri/ActivatorEditForm.test.ts`
- Modify: `src/components/activate-ri/VolunteerForm.test.ts`
- Create: `src/pages/activate-ri-2026/edit/token-page.test.ts`

- [ ] **Step 1: Write failing component tests**

```ts
import { describe, expect, it } from "vitest";
import editFormSource from "./ActivatorEditForm.astro?raw";

describe("ActivatorEditForm shared volunteer controls", () => {
  it("uses the same required-field indicators as the volunteer form", () => {
    expect(editFormSource).toContain("form-required-note");
    expect(editFormSource).toContain('aria-label="Required field"');
  });

  it("uses the volunteer park, band, mode, notes, and organizer controls", () => {
    expect(editFormSource).toContain("data-park-combobox");
    expect(editFormSource).toContain("data-bands");
    expect(editFormSource).toContain("data-modes");
    expect(editFormSource).toContain("data-public-notes");
    expect(editFormSource).toContain('name="organizerNotes"');
  });

  it("protects edit saves and cancellation with Turnstile", () => {
    expect(editFormSource).toContain("cf-turnstile");
    expect(editFormSource).toContain("turnstileToken");
    expect(editFormSource).toContain('data.get("cf-turnstile-response")');
  });

  it("derives edit start and end times from the shared time block control", () => {
    expect(editFormSource).toContain("timeBlockToRange");
    expect(editFormSource).toContain("startTime: timeRange.startTime");
    expect(editFormSource).toContain("endTime: timeRange.endTime");
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import editPageSource from "./[token].astro?raw";

describe("activate-ri edit token page", () => {
  it("shows the reference map and does not show the edit link resend form", () => {
    expect(editPageSource).toContain("ReferenceMap");
    expect(editPageSource).not.toContain("EditLinkResendForm");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk npm test -- ActivatorEditForm.test.ts token-page.test.ts`

Expected: FAIL because the edit form lacks shared controls and Turnstile, and the edit page lacks `ReferenceMap`.

### Task 2: Extract Shared Form Markup

**Files:**
- Create: `src/components/activate-ri/ActivateRiIdentityFields.astro`
- Create: `src/components/activate-ri/ActivateRiStopCard.astro`
- Modify: `src/components/activate-ri/VolunteerForm.astro`
- Modify: `src/components/activate-ri/ActivatorEditForm.astro`

- [ ] **Step 1: Create identity fields component**

Move the identity field markup from `VolunteerForm.astro` into `ActivateRiIdentityFields.astro`. Accept a `clubDatalistId` prop so the public and edit forms can use distinct datalist IDs.

- [ ] **Step 2: Create stop card component**

Move the activation stop fieldset markup from `VolunteerForm.astro` into `ActivateRiStopCard.astro`. Accept props for `includeStopId`, `title`, and `removeHidden` so the same card works for public initial render and edit templates.

- [ ] **Step 3: Update public volunteer form**

Render `ActivateRiIdentityFields clubDatalistId="activate-ri-clubs"` and `ActivateRiStopCard title="Activation stop 1" removeHidden={true}`. Keep the existing public submit script behavior unchanged.

- [ ] **Step 4: Update edit form template**

Render `ActivateRiIdentityFields clubDatalistId="activate-ri-edit-clubs"` inside the hidden edit fields container. Replace the edit stop template with `ActivateRiStopCard includeStopId={true} title="Activation stop" removeHidden={false}`.

- [ ] **Step 5: Run parity tests**

Run: `rtk npm test -- ActivatorEditForm.test.ts VolunteerForm.test.ts`

Expected: PASS for required controls once the shared markup is present.

### Task 3: Adapt Edit Script To Shared Controls

**Files:**
- Modify: `src/components/activate-ri/ActivatorEditForm.astro`

- [ ] **Step 1: Import shared options and time-block helper**

Add imports for `activateRiBandOptions`, `activateRiModeOptions`, and `timeBlockToRange`.

- [ ] **Step 2: Replace datalist park matching with combobox matching**

Use the same `data-park-option`, `data-label`, and `data-search` attributes as the public form. Set the visible park input to the option label and the hidden park reference to the actual POTA reference.

- [ ] **Step 3: Populate multi-selects from existing arrays**

When rendering a plan, check matching `data-multi-option` inputs for each stop's bands and modes, then update the button label.

- [ ] **Step 4: Build PATCH payload from shared controls**

In `formToPayload`, read selected bands and modes from checked multi-select options. Read `timeBlock`, call `timeBlockToRange(timeBlock)`, and emit `startTime` and `endTime` from that range.

- [ ] **Step 5: Include organizer notes**

Populate `organizerNotes` from loaded plan data and include `organizerNotes: data.get("organizerNotes")` in PATCH payloads.

- [ ] **Step 6: Run tests**

Run: `rtk npm test -- ActivatorEditForm.test.ts`

Expected: PASS for edit payload and shared-control tests.

### Task 4: Add Turnstile To Edit Save And Cancel

**Files:**
- Modify: `src/components/activate-ri/ActivatorEditForm.astro`
- Modify: `src/worker/routes/activate-ri.ts`
- Modify: `src/worker/routes/activate-ri.test.ts`

- [ ] **Step 1: Write failing route tests**

Add tests showing edit PATCH and cancel reject missing or invalid Turnstile tokens when Turnstile is configured.

- [ ] **Step 2: Run route tests to verify failure**

Run: `rtk npm test -- src/worker/routes/activate-ri.test.ts`

Expected: FAIL because edit PATCH and cancel do not yet verify Turnstile.

- [ ] **Step 3: Include Turnstile widget in edit form**

Render the same Cloudflare Turnstile script and `.cf-turnstile` widget in `ActivatorEditForm.astro`.

- [ ] **Step 4: Include Turnstile token in save and cancel requests**

Add `turnstileToken: data.get("cf-turnstile-response")` to PATCH payloads and add the same token to cancel request bodies.

- [ ] **Step 5: Verify Turnstile in edit API routes**

Call the existing Turnstile verification helper before processing edit PATCH and cancel mutations.

- [ ] **Step 6: Reset Turnstile after state-changing requests**

Call the same `resetTurnstile()` helper after successful or failed save/cancel attempts.

- [ ] **Step 7: Run route and component tests**

Run: `rtk npm test -- src/worker/routes/activate-ri.test.ts ActivatorEditForm.test.ts`

Expected: PASS.

### Task 5: Add Map To Edit Page

**Files:**
- Modify: `src/pages/activate-ri-2026/edit/[token].astro`

- [ ] **Step 1: Import and render `ReferenceMap`**

Render `ReferenceMap` above `ActivatorEditForm` with the same volunteer-oriented copy as the public volunteer page, adjusted only where necessary for edit context.

- [ ] **Step 2: Ensure edit form listens for map park events**

Make `ActivatorEditForm.astro` handle `activate-ri:add-park` by adding the selected park to the first empty stop or a new stop, matching the volunteer form behavior.

- [ ] **Step 3: Run page/component tests**

Run: `rtk npm test -- token-page.test.ts ActivatorEditForm.test.ts`

Expected: PASS.

### Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run: `rtk npm test -- ActivatorEditForm.test.ts VolunteerForm.test.ts token-page.test.ts src/worker/routes/activate-ri.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `rtk npm test`

Expected: PASS.

- [ ] **Step 3: Run Astro check**

Run: `rtk npm run check`

Expected: PASS.
