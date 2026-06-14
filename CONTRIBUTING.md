# Contributing

This repository is intended to become public. Treat every committed file as public from the start.

## Run Checks

Before proposing changes, run:

```bash
mise run test
mise run check
mise run build
```

## Content and Assets

- Keep official Parks on the Air links clear and prominent when discussing rules, references, accounts, spots, or logs.
- Preserve the unofficial community-site disclaimer.
- Avoid stale homepage phrasing such as "upcoming", "this summer", or event-specific dates.
- Use only public-safe assets that the project has permission to publish.
- Do not commit Groups.io exports, private thread dumps, local filesystem paths, Cloudflare secrets, tokens, `.env`, or `.dev.vars`.

## Tooling

- Use TypeScript and ESM for site code.
- Use Vitest-style tests for utility code and data transforms.
- Use mise file-based tasks under `mise/tasks/`; do not put project tasks in `mise.toml`.
- Keep homepage data editable in typed modules under `src/data/`.
