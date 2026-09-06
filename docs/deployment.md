# Deployment

This site deploys to Cloudflare Workers Static Assets with a Worker script for
Activate RI API, admin, and edit routes. The intended production Worker is the
base Wrangler Worker named `ripota-org`.

Do not deploy with `--env production`. That flag selects a separate Wrangler
environment and targets a different Worker name, `ripota-org-production`. This
repo keeps production configuration at the top level of `wrangler.jsonc`; the
only named environment is `local` for local development.

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

The migration step applies any unapplied files in `migrations/` to the remote
D1 database before the Worker is deployed. Wrangler prompts for confirmation in
an interactive shell and skips the confirmation in non-interactive CI.

The backup step captures a D1 Time Travel bookmark and writes a SQL export under
`tmp/d1-backups/`. The `tmp/` directory is gitignored, so production exports stay
out of the repository.

For a non-mutating check:

```bash
mise run deploy -- --dry-run
```

Dry run mode lists unapplied remote D1 migrations and compiles the Worker with
`npx wrangler deploy --env "" --dry-run`. It does not apply migrations or upload a
Worker version.

## Cloudflare Shape

`wrangler.jsonc` is the source of truth for the deployed Worker:

- `name`: `ripota-org`
- `main`: `src/worker/index.ts`
- `assets.directory`: `./dist`
- `assets.binding`: `ASSETS`
- `assets.run_worker_first`: `/api/*`, `/account/*`,
  `/activate-ri-2026/admin*`, `/activate-ri-2026/edit/*`, access, and activator
  portal routes
- D1 binding: `DB`, database `ripota-org`
- Email binding: `EMAIL`
- Client error rate-limit binding: `CLIENT_ERROR_RATE_LIMIT`, 20 reports per
  network key per minute
- Observability: enabled
- Worker source maps: uploaded by Wrangler for deobfuscated Worker stack traces

The top-level config is production. `env.local` exists only so local builds can
use `npm run build:local`, the Turnstile test site key, and local Wrangler D1
storage.

`upload_source_maps` applies to the Wrangler-built Worker script at
`src/worker/index.ts`. Astro/Vite also emits client-side `.map` assets for the
static browser bundle. Browser failures are reported through
`POST /api/client-errors`; see
`docs/activate-ri-2026/worker-logging-debugging.md` for the payload limits,
privacy controls, and Workers Logs workflow.

## Required Local State

Before deploying:

1. Install dependencies with `npm install`.
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
npx wrangler d1 migrations create ripota-org <migration_name>
```

Apply local migrations for development:

```bash
mise run activate-ri-2026:d1-apply-local
```

Check deployed migration state:

```bash
npx wrangler d1 migrations list ripota-org --remote
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
   npx wrangler d1 migrations list ripota-org --remote
   ```

3. Open `https://ripota.org/` and an Activate RI public page.
4. Submit a low-risk volunteer signup and confirm Turnstile and the D1-backed
   API work.
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
npx wrangler deployments list
npx wrangler versions list
```

Rollback the Worker when needed:

```bash
npx wrangler rollback
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
