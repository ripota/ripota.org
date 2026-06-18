# Activate RI 2026 Database Reset

This project uses the Cloudflare D1 database named `ripota-org`, bound to the
Worker as `DB`.

During setup and admin testing, reset only the Activate RI operational rows.
Do not delete and recreate the D1 database unless the binding and
`database_id` in `wrangler.jsonc` are intentionally being replaced.

## What gets deleted

The reset removes all Activate RI signup, stop, edit-token, moderation, and
activity/audit rows:

- `activate_ri_edit_tokens`
- `activate_ri_activity_events`
- `activate_ri_audit_events`
- `activate_ri_stops`
- `activate_ri_activators`

It intentionally keeps the D1 migration table and schema intact.

## Before resetting production

Confirm Wrangler is authenticated:

```bash
npx wrangler whoami
```

If `CLOUDFLARE_API_TOKEN` is set, that token needs Cloudflare D1 edit access.
The operational setup doc has the token troubleshooting details:

```bash
docs/activate-ri-2026/email-flow-and-setup.md
```

The production reset task backs up the database before deleting rows.

Cloudflare D1 also has Time Travel recovery for remote databases. Before a
production reset, capture the current bookmark so the reset can be undone if
needed. The production backup task prints this bookmark:

```bash
mise run backup-production
```

Save the bookmark printed by Wrangler outside the repo.

## Reset the local development database

Use this when clearing data created by `wrangler dev` or local API testing:

```bash
npx wrangler d1 execute ripota-org --local --command="
DELETE FROM activate_ri_edit_tokens;
DELETE FROM activate_ri_activity_events;
DELETE FROM activate_ri_audit_events;
DELETE FROM activate_ri_stops;
DELETE FROM activate_ri_activators;
"
```

If the local database has not been initialized yet, apply migrations first:

```bash
mise run activate-ri-2026:d1-apply-local
```

## Reset the deployed database

Use the guarded mise task for the deployed Cloudflare D1 database:

```bash
mise run activate-ri-2026:reset-production -- --confirm
```

The task checks Wrangler authentication, runs `mise run backup-production`, then
deletes only the current Activate RI operational rows from the remote
`ripota-org` D1 database. Wrangler may prompt before executing against the remote
database. Read the target database in the prompt before confirming.

## Verify the reset

Local:

```bash
npx wrangler d1 execute ripota-org --local --command="
SELECT 'edit_tokens' AS table_name, COUNT(*) AS row_count FROM activate_ri_edit_tokens
UNION ALL
SELECT 'activity_events', COUNT(*) FROM activate_ri_activity_events
UNION ALL
SELECT 'audit_events', COUNT(*) FROM activate_ri_audit_events
UNION ALL
SELECT 'stops', COUNT(*) FROM activate_ri_stops
UNION ALL
SELECT 'activators', COUNT(*) FROM activate_ri_activators;
"
```

Remote:

```bash
npx wrangler d1 execute ripota-org --remote --command="
SELECT 'edit_tokens' AS table_name, COUNT(*) AS row_count FROM activate_ri_edit_tokens
UNION ALL
SELECT 'activity_events', COUNT(*) FROM activate_ri_activity_events
UNION ALL
SELECT 'audit_events', COUNT(*) FROM activate_ri_audit_events
UNION ALL
SELECT 'stops', COUNT(*) FROM activate_ri_stops
UNION ALL
SELECT 'activators', COUNT(*) FROM activate_ri_activators;
"
```

The production reset task prints this verification query after the reset. All
five counts should be `0`.

## Undo a production reset

If the deployed database was reset by mistake, use the bookmark captured before
the reset:

```bash
npx wrangler d1 time-travel restore ripota-org --bookmark "<bookmark>"
```

Cloudflare documents Time Travel restore as destructive because it overwrites
the database in place and cancels in-flight queries. Use it only when the full
database should return to the captured point in time.

## References

- Cloudflare D1 Wrangler commands:
  <https://developers.cloudflare.com/d1/wrangler-commands/>
- Cloudflare D1 Time Travel and backups:
  <https://developers.cloudflare.com/d1/reference/time-travel/>
- Cloudflare D1 migrations:
  <https://developers.cloudflare.com/d1/reference/migrations/>
