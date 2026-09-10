# After-action collection and retention

Implemented September 10, 2026. Capture runs September 10 00:00 through
September 14 00:00 UTC, with the existing fifteen-minute final grace period.
Main event dates are September 11–13 UTC. Automatic activation reconciliation
ends September 21 00:00 UTC; protected manual deep reconciliation remains
available afterward. The original review's October 14 cutoff is obsolete.

## Durable evidence

| Evidence | Persistence and interpretation |
| --- | --- |
| Detailed spots | `activate_ri_pota_spot_archive` retains normalized revisions, source IDs/times, observation/fetch times, freshness, provenance, source band, QRT, expiry/count and collection context. Existing event-dated rolling rows are backfilled with legacy/unknown provenance. |
| Activation results | Current official evidence remains queryable; `activate_ri_pota_activation_revisions` preserves later QSO-total/qualification corrections. Confirmed parks continue to be revisited. |
| Collection health | `activate_ri_pota_collection_runs` distinguishes scheduled/actual times, fresh/stale/empty/error states and stage counts. A started run without completion identifies interruption. Earlier uptime is not fabricated. |
| Public actions | `analytics_anonymous_events` retains validated lifecycle/count properties, receipt/client time, skew, schema and retry ID under the separate HMAC browser identity. |
| Private engagement | Timestamped feature events, UTC-minute foreground samples and daily message exposures support bounded event-window reporting. |
| Operational health | `analytics_ingestion_daily` stores acceptance/rejection/storage/mirror outcomes; `operational_health_daily` stores coarse browser/server/background failure counts without error text or personal data. |
| Domain history | Existing stops, activity audit, Ops transitions and send attempts remain in D1. Use before/after records and dated snapshots rather than treating current state as the original plan. |

Rolling spot cleanup still manages the UI cache after fourteen days. It does
not delete the event archive. The minimum archive retention date is January 1,
2027; no automatic purge runs then. Any deletion requires a deliberate decision
after verified export. Ops body cleanup remains a separate guarded manual
operation; this work does not add removed/edited body history.

History hydration archives event-dated reports found after capture closes.
Candidate discovery includes ended approved stops and official evidence,
bounded to two new pairs per invocation. QRT stays out of the active on-air UI
but is retained historically. Upstream disappearance alone does not prove
retraction; evidence is not silently deleted when absent upstream.

## Cloud snapshots

The `EVENT_ARCHIVES` binding uses private R2 bucket
`ripota-org-event-archives`. The hourly archive trigger creates one complete
snapshot per UTC day, retrying failed/abandoned attempts on later triggers.
An atomic database claim and attempt fence prevent overlap from mislabeling
another attempt. Automatic snapshots run through September 30, 2026 UTC and
stop at October 1 00:00 UTC. The cron trigger is limited to September; a fixed
2026 cutoff in the handler prevents it from restarting in a later September.
Stored objects retain their January 1, 2027 minimum retention date and do not
expire when snapshots stop. Cloudflare collection and snapshots run
independently of this Mac.

Snapshots include the installed park catalog, event evidence, measurement facts,
legacy/current usage, selected actor/stop state, audit details and Ops metadata.
They exclude credentials, contact fields, organizer notes and Ops body text.
Email-bearing legacy IDs are consistently pseudonymized to preserve joins.
These remain private datasets, not a promise of anonymity. Notification exports
are aggregate processing facts without recipient contacts; private D1 remains
the source for deeper authorized recipient-level analysis.

Each table uses a rowid upper bound, stable pagination and verified row counts.
Cloud manifests describe per-table consistency: mutable rows can change during
export. Local full D1 exports provide separate consistent database snapshots.
R2 validates content checksums and each write's metadata is checked. The
manifest is written last. `analytics_archive_exports` records running/complete/
failed status, prefix, row counts and error category. Missing rows or failed
writes do not produce a success marker. There is no public archive endpoint.

Read-only health query:

```sql
SELECT id, status, started_at, finished_at, table_count, row_count, error_category
FROM analytics_archive_exports ORDER BY started_at DESC LIMIT 10;
```

## On-demand exports and historical analytics

```bash
mise run analytics:export -- --upload
```

The task writes a dated private bundle under ignored `tmp/aar-exports/`.
It restores a full production SQL backup to temporary SQLite and requires
`PRAGMA integrity_check = ok`. It exports selected evidence, the bounded
analytics report and available sampled Analytics Engine fields with
`_sample_interval`. Capped engine queries split into smaller time intervals;
an unsplittable interval fails rather than silently truncating.

`--since` and `--until` bound the analytics interval. The D1 snapshot contains
the full retained event at execution time, with its own manifest times; it is
not falsely labeled as an arbitrary historical `--until` database state.
`--legacy-only` preserves Analytics Engine observations without requiring new
migrations and does not claim a full evidence bundle.

Without `--upload`, files remain local. Upload mode downloads every selected
uploaded file and compares checksums. `export-complete.json` is uploaded last
and lists verified files and interval/retention metadata. Full recovery SQL
stays local. Never publish HMAC subjects, raw databases or signed download URLs.

The existing desktop backup automation is separate and runs daily through
September 30, 2026; its active schedule and history live in the Codex app. It also
runs this export to preserve Analytics Engine history before its three-month
expiry. Desktop runs require the Mac and app to be running; the Cloudflare
snapshots do not.

## Verification and interpretation

On September 10, 2026, the automatic cloud snapshot and desktop backup/export
schedules were shortened to finish at the end of September. This changes when
new automatic backups stop, without deleting existing archives or shortening
their minimum retention. The original deployment verification below records
the checks performed before that schedule change.

### Production verification: September 10, 2026

Implementation commit `a263e3ff` was deployed at 13:42 UTC as Worker version
`71577b83-3cba-48b1-9d30-bf7a50bfe9a0`. Migrations 0026–0030 were confirmed
applied. The pre-migration backup restored with SQLite integrity `ok`.

The first recorded production collector run succeeded with fresh source data.
All 131 retained event detail reports were backfilled, and new spot/QRT records
were observed in the archive. No operational-health errors were recorded in
the initial verification window.

A full manual export preserved 22 evidence tables (1,002 rows), 536 returned
Analytics Engine observations through 13:42:48 UTC, and 28 uploaded files.
The database restored successfully and every uploaded file passed download
checksum verification. The archive handler was also invoked once with native
production D1/R2 bindings to bootstrap today's cloud snapshot while the new
hourly trigger propagated. Its completion record confirmed 22 tables and 1,019
rows at 13:45:36 UTC. This verifies the handler and storage path; it does not
claim that a natural hourly execution was observed during this check.

Validation passed: 888 unit tests, 77 Activate RI browser tests, 47 parks
desktop/mobile tests, type checking and the local build. The signed commit is
published on `main`. Private export paths, checksums and backup bookmarks stay
in the operational verification bundle, outside the repository.

### Measurement boundaries

Tests cover rendered hunter actions, blank/manual/import resumes, every progress
direction, persistence failures, agenda/share/print, GPC/DNT, retry deduplication,
malformed inputs, interval boundaries, GET/HEAD semantics, foreground/dwell,
pinned/older/removed messages and cross-tab daily/minute deduplication. Real-SQL
tests cover archival backfill, revisions, aged cleanup, late hydration, QRT,
freshness, independent collector failures and durable operational counts.
Export tests exercise pagination, counts, checksums, partial failure and fencing.

For deployment verification inspect applied migrations and production collection
rows, run an export, verify its R2 round trip and inspect the first cloud archive
completion. Empty new engagement tables do not establish failure before real
accepted actions. Do not manufacture participant activity to inflate them.

Missing prior actions, report revisions or freshness cannot be reconstructed;
preserve that instrumentation boundary. Analytics Engine and durable anonymous
measurements overlap and must not be added. Foreground samples are not duration,
exposure is not acknowledgment, checklist progress is not an event QSO log, and
spots are not proof of contacts. Exact stop/callsign/time matching, causal claims
and optional debriefs remain reporting or new-workflow choices supported by the
retained evidence. See [analytics semantics](../analytics.md).
