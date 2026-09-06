# Contributing

Treat every committed file as public. Follow the [local development setup](README.md#local-development)
before running checks; it explains the pinned toolchain and when to use Astro
or the local Worker.

## Run Checks

Before proposing changes, run:

```bash
mise run test
mise run check
mise run build
```

`test` includes Vitest and the Activate RI Playwright suite. Install Chromium
with `mise exec -- npx playwright install chromium` before the first browser
run. Browser tests build the site and use isolated local D1 databases. The
separate `mise run e2e:parks` task checks park geometry and public event flows
on desktop and mobile; run it for changes to those surfaces. `build` is a local
build, while [deployment](docs/deployment.md) validates the production Turnstile key.

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
- Use the pinned `@ripota/parks` package for park metadata and
  `@ripota/parks/display` for display geometry. Keep lightweight consumers on
  those imports; reserve `src/lib/pota/catalog.ts` for build-time catalog,
  provenance, and relationship queries. Do not reintroduce a hand-maintained
  reference JSON file or pull the full catalog into browser forms.
- In a Jujutsu checkout, create additional workspaces with
  `mise run workspace:create -- --name <name>` so ignored development state is
  seeded and dependencies are reconciled. Add `--revision 'trunk()'` to start
  from main instead of the current workspace.

## Documentation

Use the [documentation index](docs/README.md) to find the relevant runbook when
changing routes, migrations, authentication, or task behavior. Update current
instructions alongside the change. Keep original plans and specs as historical
records, with a dated status note linking to the implemented behavior and any
remaining proposals. A repository check does not establish production state;
date operational verification records and distinguish them from code status.
