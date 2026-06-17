# Activate RI 2026 Activator Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add layered public guidance so Activate RI activators understand the event goal, volunteer form fields, magic links, and self-service edits.

**Architecture:** Keep the existing Astro page structure and event components. Add one static help route, expand existing overview and volunteer content, add accessible label-adjacent help in the volunteer form, and add narrowly scoped CSS for guidance blocks and help affordances.

**Tech Stack:** Astro, TypeScript-in-Astro scripts, CSS, mise tasks, Astro check/build verification.

---

### Task 1: Add Event-Level Guidance

**Files:**
- Modify: `src/components/activate-ri/EventNav.astro`
- Modify: `src/pages/activate-ri-2026/index.astro`
- Create: `src/pages/activate-ri-2026/help.astro`

- [ ] **Step 1: Add Help to the event nav**

Add `["Help", "/activate-ri-2026/help/"]` to the existing `links` array in `EventNav.astro`.

- [ ] **Step 2: Add overview prose**

Add a "How this works" section on `index.astro` between `<EventNav />` and the current coverage section header. Use compact cards for goal, coverage, time blocks, and official POTA source-of-truth copy.

- [ ] **Step 3: Add help page**

Create `help.astro` using the same `BaseLayout`, `SiteHeader`, `EventNav`, `Notice`, and `Footer` pattern as the other event pages. Cover event purpose, coverage meaning, time blocks, public notes, magic links, edits, approval, resend behavior, mistyped email recovery, and official POTA authority.

- [ ] **Step 4: Verify the route builds**

Run: `npm run check`

Expected: Astro reports no type or content errors for the new route.

### Task 2: Add Volunteer Page And Form Guidance

**Files:**
- Modify: `src/pages/activate-ri-2026/volunteer.astro`
- Modify: `src/components/activate-ri/VolunteerForm.astro`

- [ ] **Step 1: Add volunteer page prose**

Add a "Before you submit" guidance block above `<VolunteerForm />`. Add a "What happens next" guidance block between `<VolunteerForm />` and `<EditLinkResendForm />`.

- [ ] **Step 2: Add field help text**

Add concise `.form-help` text under identity fields, park, time block, bands, modes, public notes, and organizer notes. Connect the help text to relevant controls with `aria-describedby` where the control has an explicit id.

- [ ] **Step 3: Add compact question-mark help affordances**

Add label-adjacent help buttons/spans for Park, Time block, Bands, Modes, Public notes, and Organizer notes. Use focusable controls with `aria-label` so keyboard users can reach the help.

- [ ] **Step 4: Verify the form still checks**

Run: `npm run check`

Expected: Astro reports no type errors from added attributes or markup.

### Task 3: Style Guidance And Verify

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add guidance block styles**

Add CSS for `.event-guidance`, `.event-guidance__grid`, `.event-guidance__item`, and `.event-help-list` using existing colors, 8px-or-less radii, and responsive grid behavior.

- [ ] **Step 2: Add field help affordance styles**

Add CSS for `.field-label-row`, `.help-popover`, `.help-popover__button`, and `.help-popover__bubble`. Support hover and focus-within. Keep bubbles above form controls without overlapping combobox or multi-select menus.

- [ ] **Step 3: Run full verification**

Run: `mise run check`

Expected: `astro check` completes successfully.

Run: `mise run build`

Expected: Static build completes successfully.

- [ ] **Step 4: Review diff**

Run: `jj diff`

Expected: Diff includes only the planned guidance page, content, form markup, nav, styles, and plan file.
