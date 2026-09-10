# Product analytics and after-action evidence

Implementation updated September 10, 2026. See the
[collection and retention runbook](activate-ri-2026/after-action-collection.md)
for archives, verification, and event boundaries. The September 8 review is a
historical assessment, not the current implementation contract.

## Sources and privacy

The site uses separate sources for separate questions:

1. Cloudflare Web Analytics or zone analytics provides aggregate traffic and
   performance information. Dashboard configuration is separate from this code;
   the repository does not establish that a browser beacon is enabled.
2. Public semantic actions pass through `POST /api/analytics/events`. D1 now
   retains each accepted event; Analytics Engine is an optional sampled mirror
   and also contains historical events from before durable collection began.
3. Authenticated D1 facts record successful private-feature requests and bounded
   Ops foreground/message exposure. Plans, changes, messages, and notification
   delivery processing remain domain records.

Do not add custom page-view events. Anonymous identifiers are random,
event-scoped browser UUIDs; the Worker stores only the existing HMAC key.
Anonymous browser keys are never joined to authenticated activator IDs.
GPC and DNT disable collection, including retries. No browser park checklist,
CSV contents, filenames, callsigns, form values, full URLs, IP addresses, or
referrers are added to public analytics. Requests omit cookies and referrer.

Schema v2 includes an action UUID and client occurrence time. Properties are
strictly allowlisted enums, UUID import-attempt identifiers, and bounded integer
counts: checklist entry mode, all-time completed/total counts, change direction,
persistence outcome, import quality/counts, agenda scope/result counts and page
category. They do not identify worked parks.

The Worker awaits durable storage before returning 202. Retries reuse the action
UUID and deduplicate by scope, HMAC browser key and action UUID. The client makes
one bounded in-memory retry for network/transient failures. A closed tab or
extended offline period can still prevent observation. Legacy v1 clients remain
accepted, with receipt-time provenance and a generated server action ID.

Server `received_at` is authoritative for anonymous reporting intervals.
Client `occurred_at` is retained separately; a clock-skew flag marks differences
over five minutes. Neither establishes a QSO time.

`ANALYTICS_HASH_KEY` remains a Worker secret. Do not rotate it before completing
the report: doing so splits one browser across different HMAC subjects.
D1 acceptance does not depend on the `ripota_usage` mirror being available.

## Public instrumentation

- Checklist start, resume, every manual progress change, reset and clear.
- Import attempt, success/failure, persistence and parser quality, linked by
  attempt ID. A parsed file is not reported as saved when storage fails.
- Per-park schedule opening, requested-agenda preparation, scope changes,
  sharing and print requests, including browser printing.
- Existing schedule/map/CTA interactions and volunteer submission outcomes.

An engaged hunter browser has a checklist lifecycle, import, progress,
schedule-detail or agenda action. A hunter CTA alone expresses interest.
Browser counts are not people; daily uniques cannot be added to form period
uniques. Checklist counts are all-time self-reported progress, not event QSOs.

## Authenticated engagement

`analytics_feature_events` records server-timestamped successful GETs of the
plan/account pages and successful Ops bootstrap loads. HEAD and failed asset
responses do not increment usage. These are recorded uses, not reading duration
or completed operations. The lifetime rollup remains for compatibility;
`analytics_feature_usage_legacy` freezes the pre-migration baseline.

`analytics_collection_metadata` distinguishes schema availability from the first
accepted fact for each stream. Historical lifetime counts cannot be assigned
fictional event-day timestamps. Reports show the un-timestamped remainder
separately, including the migration-to-deployment gap.

Ops engagement uses authenticated, permitted members and server receipt times:

- One foreground sample per actor/server UTC minute, deduplicated across tabs.
- First message exposure per actor/message/UTC date after at least 60% visibility
  and one second of foreground dwell; includes pinned messages.
- Hidden pages and an open modal do not produce exposure samples.
- Bounded `direct`/`message_link` entry context is not proof of email delivery.
  Older surviving linked messages can be fetched by authorized members.

These observations establish visible use/exposure, not comprehension,
acknowledgment, exact duration or causality. They store no message bodies or
anonymous browser IDs. Editing/removal preserve existing content semantics;
this work does not add prior message body history.

## Interval reports

```bash
mise run analytics:report -- --json \
  --since 2026-09-10T00:00:00Z --until 2026-09-14T00:00:00Z
```

Windows are `[since, until)` in UTC, normalized to whole seconds to match
Analytics Engine precision. `--until` defaults to now. The known initial
August 31 ingestion check is excluded by default.

The JSON separates:

- `anonymous`: Analytics Engine estimates for the entire requested interval.
- `anonymousDurable`: exact accepted D1 facts and lifecycle/count properties,
  using server receipt time.
- `authenticated`: timestamped private-feature facts in the interval.
- `opsRoom`: posting, foreground samples and first daily message exposures.
- `collection`: stream start times, legacy usage and interpretation limits.

**Analytics Engine and durable anonymous sections overlap. Never add them.**
The engine preserves period-wide historical estimates; D1 supplies exact
accepted facts after instrumentation starts. No artificial split is invented
at a subsecond deployment boundary.

Useful exact feature query:

```sql
SELECT feature, COUNT(DISTINCT subject_id) AS activators, COUNT(*) AS recorded_uses
FROM analytics_feature_events
WHERE scope = 'activate-ri-2026'
  AND occurred_at >= '2026-09-10T00:00:00.000Z'
  AND occurred_at < '2026-09-14T00:00:00.000Z'
GROUP BY feature;
```

Do not filter lifetime `use_count` by `last_used_at` and call it interval usage.
Use domain records for submissions, approval, cancellation and confirmed radio
outcomes. Weight sampled Analytics Engine observations with `_sample_interval`.

## Retention and export

D1 evidence is retained for the report, with no automatic event purge.
Anonymous and spot archives have a minimum retention date of January 1, 2027;
changing a retention date alone does not delete anything. Later deletion
requires a deliberate retention decision after verified export.

Cloudflare Analytics Engine stores data for
[three months](https://developers.cloudflare.com/analytics/analytics-engine/limits/).
Preserve its historical data separately from D1 backups:

```bash
mise run analytics:export -- --upload
```

This creates a private dated bundle, restores/checks a full D1 recovery backup
locally, exports selected report evidence and historical sampled engine rows,
and verifies local/uploaded checksums. Full recovery SQL stays local.
Private R2 receives selected evidence; no public bucket route is added.

See [the runbook](activate-ri-2026/after-action-collection.md) for cloud snapshots,
retry behavior, manifests and the independent desktop backup schedule.
