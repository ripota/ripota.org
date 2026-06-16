# GitHub Issues Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a global footer link that sends site suggestions and corrections to a guided GitHub issue form.

**Architecture:** Keep official POTA links separate from site feedback by adding a standalone feedback link export in `src/data/site.ts`. Render that link from `Footer.astro`, and define one GitHub issue form for visitor suggestions and corrections.

**Tech Stack:** Astro, TypeScript, Vitest, GitHub issue forms YAML.

---

### Task 1: Site Feedback Link Data

**Files:**
- Modify: `src/data/site.ts`
- Modify: `src/data/site.test.ts`

- [x] **Step 1: Add the failing data test**

In `src/data/site.test.ts`, import `siteFeedbackLink` and add this test inside `describe("site content", ...)`:

```ts
it("routes site feedback to the GitHub issue form", () => {
  expect(siteFeedbackLink).toEqual(
    expect.objectContaining({
      label: "Suggest a site improvement",
      href: "https://github.com/ripota/ripota.org/issues/new?template=site-suggestion.yml",
    }),
  );
  expect(siteFeedbackLink.description).toMatch(/ripota\.org/i);
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/data/site.test.ts --run`
Expected: FAIL because `siteFeedbackLink` is not exported yet.

- [x] **Step 3: Add the feedback link export**

In `src/data/site.ts`, add this export near the other site-level link data:

```ts
export const siteFeedbackLink = {
  label: "Suggest a site improvement",
  href: "https://github.com/ripota/ripota.org/issues/new?template=site-suggestion.yml",
  description: "Suggest a correction, broken-link fix, or local-resource improvement for ripota.org.",
} satisfies ExternalLink;
```

- [x] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- src/data/site.test.ts --run`
Expected: PASS.

### Task 2: Footer Rendering

**Files:**
- Modify: `src/components/Footer.astro`

- [x] **Step 1: Render the feedback link in the footer**

Replace the footer import with:

```astro
import { officialLinks, siteFeedbackLink, siteIdentity } from "../data/site";
```

Add this anchor after the existing `Assets` link and before the mapped official links:

```astro
<a href={siteFeedbackLink.href} title={siteFeedbackLink.description}>{siteFeedbackLink.label}</a>
```

- [x] **Step 2: Run Astro check**

Run: `npm run check`
Expected: PASS.

### Task 3: GitHub Issue Form

**Files:**
- Create: `.github/ISSUE_TEMPLATE/site-suggestion.yml`

- [x] **Step 1: Create the issue form**

Create `.github/ISSUE_TEMPLATE/site-suggestion.yml` with:

```yaml
name: Site suggestion or correction
description: Suggest an improvement, correction, or broken-link fix for ripota.org.
title: "[Site]: "
body:
  - type: markdown
    attributes:
      value: |
        Thanks for helping improve ripota.org.

        Use this form for site content, broken links, local-resource notes, and page suggestions. Official Parks on the Air resources remain the source of truth for rules, accounts, spots, logs, awards, and current reference status.
  - type: input
    id: page-url
    attributes:
      label: Page URL
      description: Which ripota.org page is this about? Leave blank if the suggestion is not tied to one page.
      placeholder: https://ripota.org/
    validations:
      required: false
  - type: textarea
    id: requested-change
    attributes:
      label: What should change?
      description: Describe the correction, broken link, local-resource note, or site idea.
    validations:
      required: true
  - type: textarea
    id: reason
    attributes:
      label: Why would this help?
      description: Share the visitor problem, missing context, or local operating detail this would improve.
    validations:
      required: false
  - type: textarea
    id: source-context
    attributes:
      label: Supporting source or context
      description: Add public sources, firsthand local context, or links that help maintainers evaluate the suggestion.
    validations:
      required: false
  - type: input
    id: contact
    attributes:
      label: Optional contact or callsign
      description: Add a callsign, GitHub handle, or other contact detail if you want maintainers to follow up.
    validations:
      required: false
```

- [x] **Step 2: Run full verification**

Run:

```bash
npm test -- src/data/site.test.ts --run
npm run check
npm run build:local
```

Expected: all commands PASS.
