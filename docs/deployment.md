# Deployment

This site deploys to Cloudflare Workers Static Assets with a Worker script for
site APIs, account access, event administration, embeds, Ops Room, and scheduled
POTA collection. The production Worker is the base Wrangler Worker named
`ripota-org`.

Do not deploy with `--env production`. That flag selects a separate Wrangler
environment and targets a different Worker name, `ripota-org-production`. This
repo keeps production configuration at the top level of `wrangler.jsonc`; the
named environments are `local` for local development and `production-data` for
local inspection of production D1. Neither is a production deployment target.

## Production Command

Use the project mise task:

```bash
mise run deploy
```

The task runs these operations in order:

1. `npx wrangler whoami`
2. `mise run backup-production`
3. `npx wrangler d1 migrations apply ripota-org --remote --env ""`
4. `npx wrangler deploy --env ""`

The last step runs Wrangler's configured production build before uploading the
Worker and static assets. This build requires the real
`PUBLIC_TURNSTILE_SITE_KEY`; `mise run build` alone uses the local build wrapper.

The migration step applies any unapplied files in `migrations/` to the remote
D1 database before the Worker is deployed. Wrangler prompts for confirmation in
an interactive shell and skips the confirmation in non-interactive CI.

The backup step captures a D1 Time Travel bookmark and writes a SQL export under
`tmp/d1-backups/`. The `tmp/` directory is gitignored, so production exports stay
out of the repository.

For a check that does not change remote state:

```bash
mise run deploy -- --dry-run
```

Dry run mode lists unapplied remote D1 migrations, builds the local assets, and compiles the Worker with
`npx wrangler deploy --env "" --dry-run`. It does not apply migrations or upload a
Worker version.

## Cloudflare Shape

`wrangler.jsonc` is the source of truth for the deployed Worker:

- `name`: `ripota-org`
- `main`: `src/worker/index.ts`
- `assets.directory`: `./dist`
- `assets.binding`: `ASSETS`
- `assets.run_worker_first`: `/api/*`, `/account/*`, `/embed/*`,
  `/activate-ri-2026/admin*`, `/activate-ri-2026/edit/*`, access, and activator
  portal routes
- D1 binding: `DB`, database `ripota-org`
- Analytics Engine binding: `ANALYTICS`, dataset `ripota_usage`
- Email binding: `EMAIL`
- Durable Object binding: `ACTIVATE_RI_OPS_ROOM`, class `ActivateRiOpsRoom`,
  with SQLite class migration `activate-ri-ops-room-v1`
- Ops Room, authentication, and analytics rate-limit bindings, with limits
  defined in `wrangler.jsonc`
- Client error rate-limit binding: `CLIENT_ERROR_RATE_LIMIT`, 20 reports per
  network key per minute
- Observability: enabled
- Worker source maps: uploaded by Wrangler for deobfuscated Worker stack traces
- Cron triggers: every minute for POTA collection/reconciliation and auth
  cleanup; daily at 05:17 UTC for rolling POTA spot-history cleanup

The top-level config is production. `env.local` exists only so local builds can
use `npm run build:local`, the Turnstile test site key, and local Wrangler D1
storage.

`env.production-data` sets `DB.remote=true` and `REMOTE_DATA_READ_ONLY=true`.
The event API rejects non-GET/HEAD requests in this mode, but that is not a
database-wide write barrier: auth routes, GET side effects, and scheduled
handlers are separate. Use it only to inspect existing admin views; use
`env.local` for account and write-flow testing. See the
[development setup](../README.md#local-development).

`upload_source_maps` applies to the Wrangler-built Worker script at
`src/worker/index.ts`. Astro/Vite also emits client-side `.map` assets for the
static browser bundle. Browser failures are reported through
`POST /api/client-errors`; see
`docs/activate-ri-2026/worker-logging-debugging.md` for the payload limits,
privacy controls, and Workers Logs workflow.

## Required Local State

Before deploying:

1. Install the pinned toolchain and locked dependencies with `mise install`
   and `mise exec -- npm ci`. Activate mise in the shell, or prefix direct npm
   and Wrangler commands with `mise exec --`.
2. Authenticate Wrangler with `npx wrangler login`, or provide a
   `CLOUDFLARE_API_TOKEN` with permissions for Workers deploys, D1 migrations,
   D1 reads/writes, and any configured Email Sending operations.
3. Ensure `.env` or the shell environment provides the real production
   `PUBLIC_TURNSTILE_SITE_KEY`. The production build guard rejects missing
   values, Cloudflare test keys, and repository placeholders.
4. Keep `.env`, `.dev.vars`, API tokens, account IDs, and private operational
   exports out of git.

Production Worker secrets are configured outside the repository:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put ACTIVATE_RI_ADMIN_EMAILS
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
npx wrangler secret put ANALYTICS_HASH_KEY
```

`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are required for the Worker to
validate Cloudflare Access JWTs on administrator recovery requests. Access
protects only the recovery page and bootstrap endpoint; routine admin requests
require a current passkey session. See `docs/cloudflare-access.md`.

`AUTH_BOOTSTRAP_ADMIN_EMAILS` was removed after all three administrators had
enrolled and used passkeys. Do not recreate it during routine deployment. It is
only needed for deliberate new-administrator enrollment under the procedure in
`docs/activate-ri-2026/authentication.md`.

`ANALYTICS_HASH_KEY` HMACs public, event-scoped browser identifiers before they
reach Workers Analytics Engine. Create it once and do not rotate it until the
event report is complete. See `docs/analytics.md` for the data contract,
privacy boundary, verification, and report queries.

The completed authentication rollout uses these production values:

```text
AUTH_ADMIN_MODE=passkey
AUTH_ACTIVATOR_MODE=unified
AUTH_EMAIL_LOGIN_ENABLED=true
AUTH_LEGACY_LINK_ISSUANCE_ENABLED=false
```

`wrangler.jsonc` is the source of truth for the current modes. Preserve these
values during routine deployment. The initial rollout and rollback values are
documented separately in `docs/activate-ri-2026/authentication.md`.

## Migrations

Create new D1 migrations with Wrangler:

```bash
npx wrangler d1 migrations create ripota-org <migration_name> --env ""
```

Apply local migrations for development:

```bash
mise run activate-ri-2026:d1-apply-local
```

Check deployed migration state:

```bash
npx wrangler d1 migrations list ripota-org --remote --env ""
```

Apply deployed migrations outside a full deploy only when intentionally doing a
database-only operation. Use the mise task so the production database is backed
up first:

```bash
mise run d1:migrate-production
```

Always include `--remote` for the deployed D1 database. Without it, D1
migration commands target local Wrangler storage. Use `--env ""` to select the
top-level Wrangler config, and do not add `--env production` to migration
commands for this project.

To manually capture a production backup without applying migrations or
deploying:

```bash
mise run backup-production
```

This writes the SQL export to `tmp/d1-backups/` and prints a Time Travel restore
bookmark. D1 migrations are database changes; a Worker rollback does not undo
them.

## Verification

After deployment:

1. Confirm the Worker deploy completed for `ripota-org`, not
   `ripota-org-production`.
2. Check migration state:

   ```bash
   npx wrangler d1 migrations list ripota-org --remote --env ""
   ```

3. Open `https://ripota.org/` and an Activate RI public page.
4. Confirm the volunteer page loads Turnstile and the public schedule API
   responds. When the release needs a production submission check, coordinate
   a real signup or a clearly identified test with the organizers so it does
   not leave unexplained production records.
5. Open `https://ripota.org/activate-ri-2026/admin/` in a private browser and
   confirm it redirects to the site's passkey sign-in page. The email sign-in
   section starts collapsed. Sign in with an admin passkey and verify the
   dashboard loads.
6. Verify an unauthenticated admin API request returns `401`:

   ```bash
   curl -i https://ripota.org/api/activate-ri-2026/admin/plans
   ```

7. If email-related changes shipped, confirm the activator single-use sign-in email and
   admin notification email flow. See
   `docs/activate-ri-2026/email-flow-and-setup.md`.
8. Confirm Cloudflare Access still intercepts unauthenticated requests to
   `/activate-ri-2026/admin/recovery/` and
   `/api/activate-ri-2026/admin/auth/access-bootstrap/start`.
9. Trigger one allowlisted public event, then query the `ripota_usage` Analytics
   Engine dataset to confirm the event arrived without a raw browser UUID. See
   `docs/analytics.md`.

## Rollback

For an administrator authentication rollback, restore Cloudflare Access on the
full admin page and API paths before switching `AUTH_ADMIN_MODE` to `access`.
For an activator rollback, enable legacy-link issuance before disabling email
login; the Worker rejects having both disabled. Follow the ordered procedure in
`docs/activate-ri-2026/authentication.md` before rolling back a Worker version.
Keep the additive authentication schema and existing credentials intact.

List recent Worker deployments or versions:

```bash
npx wrangler deployments list --env ""
npx wrangler versions list --env ""
```

Rollback the Worker when needed:

```bash
npx wrangler rollback --env ""
```

For D1 data recovery, use the database reset and Time Travel runbooks under
`docs/activate-ri-2026/`. Treat D1 recovery as a separate database operation
from Worker rollback.

## References

- Cloudflare Wrangler deploy commands:
  <https://developers.cloudflare.com/workers/wrangler/commands/workers/>
- Cloudflare D1 Wrangler commands:
  <https://developers.cloudflare.com/workers/wrangler/commands/d1/>
- Cloudflare Wrangler configuration:
  <https://developers.cloudflare.com/workers/wrangler/configuration/>
