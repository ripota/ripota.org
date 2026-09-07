# ripota.org

Static-first website for Rhode Island POTA, a local community companion for Parks on the Air operators in Rhode Island.

Rhode Island POTA is not an official Parks on the Air property. Official POTA resources remain the source of truth for rules, references, accounts, spots, and logs.

## Local Development

Install the pinned Node.js toolchain and locked dependencies with mise available:

```bash
mise install
mise exec -- npm ci
```

`mise.toml` and `mise.lock` pin Node.js 24.20.0; `package.json` declares
npm 11.19.0. Use `mise exec --` for npm/Wrangler commands if mise is not activated
in your shell.

For Astro page and styling work, run:

```bash
mise run dev
```

This starts Astro at `http://localhost:4321/`. It does not run the Worker APIs,
D1, authentication, or Ops Room. For those features, apply local migrations and
start Wrangler:

```bash
mise run activate-ri-2026:d1-apply-local
mise exec -- npx wrangler dev --env local --port 8787
```

Open `http://localhost:8787/`. Wrangler builds the static assets and uses local
D1 storage, local administrator access, and the Turnstile test configuration.
Use this environment for signup, account, and other write-flow testing.

Run the local Worker against the remote production Activate RI D1 database:

```bash
mise run activate-ri-2026:dev-production-data
```

This mode is for inspecting admin views with real data. It enables localhost-only
admin access and rejects non-GET/HEAD requests in the event API. That guard is
not a database-wide write barrier: authentication routes, GET side effects, and
scheduled handlers have separate paths. Keep account and write-flow tests in
the local environment above.

Common checks:

```bash
mise run test
mise run check
mise run build
```

Activate RI has a real-SQL API acceptance test in the normal Vitest suite. It
applies the checked-in D1 migrations to a temporary SQLite database, submits a
volunteer plan, approves it, and verifies the public stops API.

The unified-authentication acceptance tests use the same real migration stack
to cover legacy-link account claiming, email fallback, unified sessions, and
passkey-only account recovery controls. A browser test uses a virtual WebAuthn
authenticator for enrollment and discoverable sign-in.

Run the signup/approval acceptance test directly with:

```bash
mise run test-unit -- --run src/worker/activate-ri.acceptance.test.ts
```

The normal test command also runs the Activate RI browser suite. Playwright
builds with the Turnstile test key and uses isolated, migrated local D1 databases
for signup, editing, authentication, Ops Room, hunter tools, progress, and printed
schedules. Run it directly with:

```bash
mise run e2e:activate-ri
```

The separate desktop/mobile park and public-event browser checks are:

```bash
mise run e2e:parks
```

Playwright needs Chromium and WebKit installed (`mise exec -- npx playwright install chromium webkit`). The Ops Room test uses WebKit with an iPhone viewport to check mobile chat.
The suite also needs network access to load the Cloudflare Turnstile test widget.
`mise run build` uses the local build wrapper and outputs Astro assets to `dist/`;
the deployment build requires the real production Turnstile site key.

## Deployment

The site runs on Cloudflare Workers Static Assets. `wrangler.jsonc` serves the
Astro `dist/` output alongside the Worker APIs, account access, Ops Room Durable
Object, and scheduled POTA collection.

Deploy with:

```bash
mise run deploy
```

The deploy task backs up production D1, applies pending remote migrations, and
builds and deploys the base Worker. Do not use `wrangler deploy --env production`; production is the
top-level Worker config named `ripota-org`. See
[docs/deployment.md](docs/deployment.md).

Deployments need Cloudflare account configuration outside this repository. Do not commit account IDs, API tokens, `.env`, `.dev.vars`, private exports, or unpublished community files.

Activate RI admin routes require a current administrator passkey session in
production. Cloudflare Access protects only emergency recovery. See
[docs/cloudflare-access.md](docs/cloudflare-access.md).

Activate RI D1 setup/reset notes live under `docs/activate-ri-2026/`, including
the [data-flow overview](docs/activate-ri-2026/data-flow.md) and
[database reset runbook](docs/activate-ri-2026/database-reset.md).
The [authentication runbook](docs/activate-ri-2026/authentication.md) documents
passkeys, email/legacy compatibility, staged feature flags, safety gates, and
rollback.

The [documentation index](docs/README.md) links to current runbooks, feature
status, and historical design records.

## Content Notes

Keep homepage copy evergreen. Avoid date-forward event language on `/` such as
upcoming campaign dates or year-specific project promises. Activate All RI 2026
content belongs under `/activate-ri-2026/`; reusable park and live-spot features
live under `/parks/` and `/on-air/`.
