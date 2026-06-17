# ripota.org

Static-first website for Rhode Island POTA, a local community companion for Parks on the Air operators in Rhode Island.

Rhode Island POTA is not an official Parks on the Air property. Official POTA resources remain the source of truth for rules, references, accounts, spots, and logs.

## Local Development

Install dependencies:

```bash
npm install
```

Run the site:

```bash
mise run dev
```

Common checks:

```bash
mise run test
mise run check
mise run build
```

The site is built with Astro and outputs static files to `dist/`.

## Deployment

The launch target is Cloudflare Workers Static Assets. `wrangler.jsonc` points Wrangler at the Astro `dist/` output through the `assets.directory` setting.

Deploy with:

```bash
mise run deploy
```

The deploy task applies pending remote D1 migrations before deploying the base
Worker. Do not use `wrangler deploy --env production`; production is the
top-level Worker config named `ripota-org`. See
[docs/deployment.md](docs/deployment.md).

Deployments need Cloudflare account configuration outside this repository. Do not commit account IDs, API tokens, `.env`, `.dev.vars`, private exports, or unpublished community files.

Activate RI admin routes require Cloudflare Access in production. See [docs/cloudflare-access.md](docs/cloudflare-access.md).

Activate RI D1 setup/reset notes live under `docs/activate-ri-2026/`, including
the [data-flow overview](docs/activate-ri-2026/data-flow.md) and
[database reset runbook](docs/activate-ri-2026/database-reset.md).

## Content Notes

Keep homepage copy evergreen. Avoid date-forward event language on `/` such as upcoming campaign dates or year-specific project promises. Future project pages, including a possible `/activate` page, can carry event-specific details when they are ready.
