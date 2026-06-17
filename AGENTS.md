@RTK.md

# Agent Instructions

This project is a static-first Astro site for Rhode Island POTA.

- Preserve the unofficial community-site disclaimer anywhere launch copy is changed.
- Treat official Parks on the Air resources as the source of truth for rules, references, accounts, spots, and logs.
- Keep homepage content evergreen. Event-specific copy belongs on future project pages, not `/`.
- Use TypeScript and ESM for code.
- Use Vitest-style tests for utility code and data transforms.
- Use mise file-based project tasks under `mise/tasks/`; do not add tasks to `mise.toml`.
- Deploy production with `mise run deploy`; do not use `wrangler deploy --env production`. Production is the top-level `ripota-org` Worker config, and the deploy task applies remote D1 migrations first.
- Keep Cloudflare account IDs, API tokens, `.env`, `.dev.vars`, private Groups.io exports, local filesystem paths, and unpublished assets out of the repository.
- Avoid official POTA logos or branding unless licensing and disclaimer requirements are deliberately handled.

jj-commit-default: auto
