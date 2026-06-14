# Rhode Island POTA Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first static Astro landing page for `ripota.org`, with public-safe documentation, tests, mise tasks, and Cloudflare Workers Static Assets configuration.

**Architecture:** The site is a static-first Astro app. Typed content and link data live under `src/data/`, page sections are isolated Astro components under `src/components/`, global layout and theme tokens live under `src/layouts/` and `src/styles/`, and the homepage composes the pieces at `src/pages/index.astro`.

**Tech Stack:** Astro, TypeScript, Vitest, npm, mise file-based tasks, Cloudflare Workers Static Assets.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `astro.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/env.d.ts`

- [ ] **Step 1: Add npm package metadata and scripts**

Create `package.json` with Astro, Vitest, TypeScript, and Wrangler as dev dependencies. Define `dev`, `build`, `preview`, `check`, and `test` scripts.

- [ ] **Step 2: Add TypeScript, Astro, and Vitest config**

Create strict TypeScript config, Astro config with `site: "https://ripota.org"`, and Vitest config that includes `src/**/*.test.ts`.

- [ ] **Step 3: Install dependencies**

Run: `npm install`

Expected: dependencies install and `package-lock.json` is created.

### Task 2: Typed Content and Tests

**Files:**
- Create: `src/data/site.ts`
- Create: `src/data/site.test.ts`

- [ ] **Step 1: Write failing tests**

Test that the primary CTAs point to the RI Groups.io community and official POTA docs, external links use HTTPS, and no link claims official Rhode Island POTA status.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run src/data/site.test.ts`

Expected: FAIL because `src/data/site.ts` does not exist yet.

- [ ] **Step 3: Add typed site content**

Create the site identity, hero copy, CTA definitions, path-card content, resource copy, official links, image metadata, and unofficial disclaimer in `src/data/site.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --run src/data/site.test.ts`

Expected: PASS.

### Task 3: Theme, Layout, and Components

**Files:**
- Create: `src/styles/global.css`
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/SiteHeader.astro`
- Create: `src/components/Hero.astro`
- Create: `src/components/PathCard.astro`
- Create: `src/components/ResourceMapPreview.astro`
- Create: `src/components/OfficialLinks.astro`
- Create: `src/components/Notice.astro`
- Create: `src/components/Footer.astro`
- Create: `src/pages/index.astro`

- [ ] **Step 1: Add token-based global CSS**

Implement semantic CSS custom properties for surfaces, text, borders, links, accents, focus ring, notices, and map colors, with light and dark palettes via `prefers-color-scheme`.

- [ ] **Step 2: Add the base layout**

Implement metadata, global styles, skip link, page shell, and semantic document structure.

- [ ] **Step 3: Add section components**

Implement the header, hero, two-path cards, static Rhode Island map preview, official links, notice, and footer. Components consume `src/data/site.ts` and semantic CSS tokens.

- [ ] **Step 4: Compose the homepage**

Create `src/pages/index.astro` as the evergreen single-page launch flow from the design.

### Task 4: Deployment, Tasks, and Public Docs

**Files:**
- Create: `wrangler.jsonc`
- Create: `mise/tasks/dev`
- Create: `mise/tasks/build`
- Create: `mise/tasks/check`
- Create: `mise/tasks/test`
- Modify: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `AGENTS.md`

- [ ] **Step 1: Add Workers Static Assets config**

Create `wrangler.jsonc` with site name, compatibility date, and static assets directory set to `dist`. Do not add dynamic Worker routing.

- [ ] **Step 2: Add mise file tasks**

Create executable bash wrappers for `mise run dev`, `mise run build`, `mise run check`, and `mise run test`.

- [ ] **Step 3: Add public-safe docs**

Update README and add CONTRIBUTING and AGENTS guidance for local development, public-repo safety, POTA source-of-truth wording, stale-copy avoidance, and the unofficial community disclaimer.

### Task 5: Verification

**Files:**
- Read and verify all changed files.

- [ ] **Step 1: Run test suite**

Run: `npm test -- --run`

Expected: PASS.

- [ ] **Step 2: Run Astro checks**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS and `dist/` is created.

- [ ] **Step 4: Run mise wrappers**

Run: `mise run test`, `mise run check`, and `mise run build`.

Expected: each task exits 0.

- [ ] **Step 5: Browser QA**

Start the dev server, open the homepage in the in-app browser, and inspect desktop and mobile screenshots. Verify the hero is visible, text fits, external CTAs point to intended resources, focus styles are present, and the page does not use official POTA branding.
