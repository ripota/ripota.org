# Rhode Island POTA Landing Page Design

Date: 2026-06-14

## Purpose

Build the first public version of `ripota.org` as a polished, static-first landing page for the Rhode Island POTA community. The site should welcome existing local activators and give POTA-curious Rhode Island hams a clear path to official POTA resources.

The launch should be inexpensive to host, visually durable, and ready to grow quickly into a small platform for event planning and interactive resources.

## Background

Rhode Island POTA should be a local community companion to Parks on the Air, not an official POTA property. Official POTA resources remain the source of truth for program rules, park references, spotting, accounts, and logs.

The site should leave a natural future path for an Activate All RI 2026 project page at `/activate`, based on community planning around activating all Rhode Island POTA references. The homepage should not launch as an event campaign and should avoid date-forward content that will become stale.

Useful source references:

- POTA documentation: https://docs.pota.app/
- POTA graphics/assets guidance: https://docs.pota.app/docs/resources_docs.html#graphics--assets
- RI POTA Groups.io community: https://groups.io/g/RI-POTA
- Cloudflare Workers Static Assets billing: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

## Scope

Launch scope:

- Astro static site foundation.
- One polished homepage at `/`.
- Cloudflare Workers Static Assets deployment configuration.
- Light and dark theme support.
- Public-safe README and project hygiene.
- Vitest-style utility test setup.
- Mise file-based local tasks for common commands.

Explicitly out of scope for launch:

- Dynamic API routes.
- Authenticated dashboards.
- Signup or scheduling workflows.
- Live Leaflet map on the homepage.
- Official POTA logo usage.
- Committing private Groups.io exports, local files, credentials, account IDs, or unpublished assets.

## Recommended Approach

Use a static-first, platform-ready Astro architecture.

The first release should behave like a static site: normal page requests are served as static assets, keeping hosting cost effectively equivalent to static Pages-style hosting. Cloudflare currently documents static asset requests as free and unlimited, with no additional asset storage cost. Worker/API requests can be added later and routed selectively.

The repo should still be structured as a small platform so `/activate`, Leaflet map pages, data generation, and `/api/*` routes can be added without redesigning the project.

## Architecture

Use Astro with ESM and TypeScript:

- `package.json` uses `"type": "module"`.
- TypeScript is strict for all actual code.
- Astro components handle page structure and presentation.
- Reusable logic lives in typed modules under `src/lib/` or `src/data/`.
- Future generated/static data can live under `src/data/` or a top-level `data/` directory if the generation pipeline needs cache/source separation.

Deployment target:

- Build static Astro output to `dist/`.
- Deploy with Cloudflare Workers Static Assets.
- Do not configure `run_worker_first` for launch pages.
- Add Worker or Astro Cloudflare endpoints later only for specific dynamic paths such as `/api/*`.

Future platform path:

- `/` remains the evergreen community landing page.
- `/activate` becomes the Activate All RI 2026 planning/project page when event planning content is ready.
- Dedicated interactive pages can use Leaflet and generated POTA-derived data.
- API-backed features can use Cloudflare bindings such as KV, D1, R2, or Durable Objects if a real need emerges.

## Homepage

The homepage is a single polished scroll using the "Coastal Field Journal" visual direction and "Two Path" content structure.

Primary name: `Rhode Island POTA`.

The page flow:

1. Hero with scenic Rhode Island outdoor/coastal imagery, title, short editorial copy, and two primary calls to action.
2. Two-path section:
   - Existing Rhode Island operators: join the RI POTA community and coordinate locally.
   - New to POTA: learn what POTA is and continue to official POTA resources.
3. Rhode Island resources section with a static map-style visual, a link to official POTA map/search, and clear source-of-truth language.
4. Official links section for POTA docs, POTA app, rules or activator guidance, and RI POTA Groups.io.
5. Unofficial notice in the body/footer, clear but not dominant in the hero.

The homepage should avoid stale phrasing such as "upcoming", "this summer", "new for 2026", or event dates. Event content should live on a dedicated project page when it is ready.

## Calls To Action

Primary launch CTAs:

- Join the RI POTA community.
- Start with official POTA.

The homepage should not push `/activate` yet. A future projects/events area can appear when the Activate All RI page has useful content.

## Visual Design

The visual system should feel editorial, coastal, and durable.

Use:

- Serif display type for hero and major headings.
- Clean sans-serif type for body, navigation, links, and interface text.
- Natural palette: off-white, deep green or blue-gray, sea-glass tones, and restrained weathered-brass accents.
- Real Rhode Island outdoor photos when available.
- Abstract or location-realistic coastal/outdoor imagery is acceptable; radio gear is not required in hero imagery.
- No official POTA logo unless the licensing and disclaimer requirements are deliberately handled.

The design should work even if the hero photo changes later.

## Theming

Use a token-based theme layer from the start:

- CSS custom properties for semantic roles: page surface, raised surface, text, muted text, border, link, accent, hero overlay, focus ring, success, warning, and map/resource colors.
- Light and dark mode via `prefers-color-scheme`.
- Theme palettes grouped so future combinations can be swapped without rewriting components.
- Components consume semantic tokens, not raw color values.

Initial theme: Coastal Field Journal light/dark pair.

## Components

Initial component boundaries:

- `BaseLayout`: document metadata, global shell, theme token imports.
- `SiteHeader`: compact anchor navigation for the single-page launch.
- `Hero`: photo-backed editorial hero with two CTAs.
- `PathCard`: reusable cards for "Already active in RI?" and "New to POTA?".
- `ResourceMapPreview`: static visual block for Rhode Island references.
- `OfficialLinks`: clearly labeled external links.
- `Notice`: unofficial community-site notice.
- `Footer`: community link, official links, and disclaimer.

Interactions at launch:

- Anchor navigation.
- Accessible links and buttons.
- System light/dark mode.
- No homepage Leaflet.

## Content And Data

Launch content should be evergreen and editable in plain files or simple typed modules.

Initial content groups:

- Site identity, tagline, CTAs, and external links.
- Homepage sections and body copy.
- Photo metadata and alt text.
- Official-link definitions.

Future content/data:

- `riReferences` data can be generated from POTA-derived reference data for dedicated map/checklist pages.
- Static/generated data must clearly link back to official POTA pages.
- Local data should not be presented as authoritative when POTA is the source of truth.

## Future `/activate`

The future `/activate` page should adapt the existing personal-site pattern: generated reference data, a Leaflet map, checklist/status views, and links to official POTA park pages.

For the community event version, the page should shift from personal progress tracking to event planning:

- Reference coverage.
- Volunteer or activation signup state.
- Planned activation windows.
- Public schedule/dashboard.
- Links to official POTA pages and rules.

Google Forms or similar no-cost tools can be considered for early signups, but the site architecture should not assume a paid form product.

## Tooling

Use mise for local toolchain and automation.

Mise rules:

- `mise.toml` is for tool versions/env, not task definitions.
- Project-local tasks live under `mise/tasks/`.
- Prefer file-based tasks.
- Use bash tasks for simple wrappers such as `dev`, `build`, `check`, and `test`.
- Use TypeScript tasks only for complex automation, argument parsing, JSON manipulation, or API calls.
- If TypeScript tasks are added, bootstrap local task dependencies with `mise/tasks/package.json`, `mise/tasks/tsconfig.json`, and a hidden `local-tasks-npm-install` task.

Expected commands:

- `mise run dev`
- `mise run build`
- `mise run check`
- `mise run test`

## Testing And Quality

Use Vitest-style tests for utility code and data transforms.

Verification should cover:

- Astro build succeeds.
- Astro/TypeScript checks pass.
- Vitest utility tests pass.
- Homepage renders correctly on mobile and desktop.
- Light and dark modes are legible.
- CTAs and external links point to the intended official/community resources.
- Accessibility basics: heading order, alt text, focus states, semantic links, and color contrast.
- No accidental official-POTA branding or logo misuse.

Browser QA should include screenshots for at least one desktop viewport and one mobile viewport before claiming the homepage is complete.

## Public Repository Readiness

The repo is private now but intended to become public. Treat all committed content as public from the start.

Do not commit:

- Groups.io PDF exports or private thread dumps.
- iCloud/local filesystem paths.
- Cloudflare account IDs, tokens, or deployment secrets.
- `.env` or `.dev.vars` files.
- Browser brainstorming artifacts.
- Assets without permission to publish.

Do commit:

- Public-safe README.
- Public-safe design and planning docs.
- Clear unofficial-community wording.
- Source and ownership notes for photos or generated assets when needed.

## Implementation Defaults

- Use npm unless the implementation pass finds an existing project reason to use a different package manager.
- Use the current stable Astro release available during implementation.
- Add Cloudflare deployment configuration only to the level needed for Workers Static Assets deployment; do not add dynamic Worker routing for launch.
- Use user-owned/public-safe Rhode Island photos when available. If no final photo is available during implementation, use a clearly replaceable local placeholder asset or CSS treatment rather than a third-party photo with unclear licensing.
- Write final homepage copy during implementation, following the evergreen content constraints in this spec.
- Build the launch map preview as a static visual. Prefer a CSS/SVG/data-generated asset that can be replaced by a Leaflet page later without changing homepage structure.
