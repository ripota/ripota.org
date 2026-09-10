@RTK.md

# Agent Instructions

This project is a static-first Astro site for Rhode Island POTA.

- Preserve the unofficial community-site disclaimer anywhere launch copy is changed.
- Treat official Parks on the Air resources as the source of truth for rules, references, accounts, spots, and logs.
- Keep homepage content evergreen. Event-specific copy belongs under `/activate-ri-2026/` or another dedicated project page, not `/`.
- Use TypeScript and ESM for code.
- Use Vitest-style tests for utility code and data transforms.
- Make search and filter state shareable through the URL on every listing, both inside and outside event pages. Include search text, dropdowns, status/scope filters, sorting, and filter checkboxes; the URL must restore the selected controls and results on a fresh visit, reload, and Back/Forward navigation.
- Treat URL filter state as authoritative over saved browser preferences. Validate parameter values, omit defaults, preserve unrelated parameters and anchors, and namespace independent filter groups that share a page. Clear/reset must update the URL; background data refreshes must preserve the current selection, including filters with no matches. Group consecutive search keystrokes into one history entry and keep discrete filter changes navigable.
- Cover filter URL round trips, combined controls, clear/reset, and history behavior with browser tests when adding or changing search/filter forms. Keep private form contents, credentials, and personal checklist data out of URLs; share personalized public results only through the existing explicit share action.
- Send outbound POTA API requests through `src/worker/pota-api.ts` so user-agent and transport policy stay centralized.
- Use mise file-based project tasks under `mise/tasks/`; do not add tasks to `mise.toml`.
- Create ready-to-use Jujutsu workspaces with `mise run workspace:create -- --name <name>`. The task branches and seeds from the current workspace by default; use `--parent-workspace <workspace>` or `--revision 'trunk()'` to override that behavior instead of calling `jj workspace add` directly.
- Deploy production with `mise run deploy`; do not use `wrangler deploy --env production`. Production is the top-level `ripota-org` Worker config, and the deploy task applies remote D1 migrations first.
- Keep Cloudflare account IDs, API tokens, `.env`, `.dev.vars`, private Groups.io exports, local filesystem paths, and unpublished assets out of the repository.
- Avoid official POTA logos or branding unless licensing and disclaimer requirements are deliberately handled.

jj-commit-default: auto
