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
2. `npx wrangler d1 migrations apply ripota-org --remote --env ""`
3. `npx wrangler deploy --env ""`

The migration step applies any unapplied files in `migrations/` to the remote
D1 database before the Worker is deployed. Wrangler prompts for confirmation in
an interactive shell and skips the confirmation in non-interactive CI. Wrangler
also captures a backup when migrations are applied.

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
- `assets.run_worker_first`: `/api/*`, `/activate-ri-2026/admin*`,
  `/activate-ri-2026/edit/*`
- D1 binding: `DB`, database `ripota-org`
- Email binding: `EMAIL`
- Observability: enabled

The top-level config is production. `env.local` exists only so local builds can
use `npm run build:local`, the Turnstile test site key, and local Wrangler D1
storage.

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
```

`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are required for the Worker to
validate Cloudflare Access JWTs on admin requests. See
`docs/cloudflare-access.md`.

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
database-only operation:

```bash
npx wrangler d1 migrations apply ripota-org --remote --env ""
```

Always include `--remote` for the deployed D1 database. Without it, D1
migration commands target local Wrangler storage. Use `--env ""` to select the
top-level Wrangler config, and do not add `--env production` to migration
commands for this project.

For risky schema changes, capture a D1 Time Travel bookmark before applying:

```bash
npx wrangler d1 time-travel info ripota-org
```

Store the bookmark outside the repo. D1 migrations are database changes; a
Worker rollback does not undo them.

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
   confirm Cloudflare Access protects the page.
6. Verify admin API protection:

   ```bash
   curl -i https://ripota.org/api/activate-ri-2026/admin/plans
   ```

7. If email-related changes shipped, confirm the activator edit-link email and
   admin notification email flow. See
   `docs/activate-ri-2026/email-flow-and-setup.md`.

## Rollback

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
