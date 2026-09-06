# Privacy-conscious product analytics

Last reviewed against the repository: 2026-09-06.

The site uses three complementary sources. They answer different questions and
should not be collapsed into one system:

1. Cloudflare Web Analytics or zone traffic analytics answers page-view,
   referrer, device, geography, and performance questions in aggregate.
2. Workers Analytics Engine stores allowlisted, anonymous product events from
   public browser features through `POST /api/analytics/events`.
3. D1 stores exact domain outcomes and authenticated feature rollups using
   existing opaque activator IDs.

The API and storage binding are intentionally site-wide infrastructure. An
event is selected by the payload's `scope`, currently `activate-ri-2026`, rather
than by nesting the endpoint under an event route. Future scopes must add a
server-side event and property allowlist before clients can send them.

## Cloudflare Web Analytics status

Web Analytics is configured in the Cloudflare dashboard, not in this
repository. There is no Web Analytics beacon or token in the source, so the
repository does not prove that the browser beacon is active in production.
Confirm the production site's Web Analytics configuration in Cloudflare and
inspect rendered HTML for `beacon.min.js` after deployment. Cloudflare's normal
proxied request analytics is separate from the optional browser beacon.

Do not add custom `page_view` events. Use Cloudflare's page analytics for page
traffic and reserve the custom endpoint for semantic feature interactions.

## Workers Analytics Engine

Analytics Engine is a custom Cloudflare Worker dataset, not a switch for the
generic Web Analytics product. The `ANALYTICS` binding in `wrangler.jsonc`
points at `ripota_usage`. Cloudflare creates the dataset table after the first
successful write. The public client sends no cookies, referrer, IP address,
user agent, callsign, park reference, filename, form value, CSV content, or URL
query string into the dataset.

The browser creates an event-scoped random UUID only after a meaningful action.
It expires at the end of 2026. The Worker replaces it with an HMAC-SHA256 value
before writing, and the raw UUID is discarded. Global Privacy Control and Do
Not Track disable custom collection. Authenticated paths do not use anonymous
browser collection.

The HMAC key is a production Worker secret. Create it once before deploying and
do not rotate it until the event report is complete, because rotation splits
one browser into multiple anonymous subjects:

```bash
openssl rand -base64 32 | npx wrangler secret put ANALYTICS_HASH_KEY
```

For local end-to-end testing, put a non-production value in the untracked
`.dev.vars` file. With no key or no dataset binding, the endpoint returns 503
and the product feature continues normally.

Analytics Engine retains data for three months. Export the aggregate report
after the event and before November 28, 2026 to preserve the reporting window
that starts on August 31; waiting until December would lose early activity.
This is an operational export deadline, not an automatic export implemented by
the repository. See Cloudflare's
[SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
and [limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
documentation.

### Dataset columns

| Column | Meaning |
| --- | --- |
| `index1` | HMAC of `scope:anonymous-browser-id` |
| `blob1` | Event scope |
| `blob2` | Event name |
| `blob3` | Subject type; currently `anonymous` |
| `blob4` | Feature enum |
| `blob5` | Action enum |
| `blob6` | Placement enum |
| `blob7` | Outcome enum |
| `blob8` | Coarse error code enum |
| `blob9` | Filter category enum |
| `blob10` | Import method enum |
| `blob11` | Schema version |
| `double1` | Count; always `1` |

The authoritative event/property allowlist is
`src/lib/analytics/events.ts`. Do not add free-form values to it.

### Analytics Engine report queries

For the current privacy-safe production summary, run:

```bash
mise run analytics:report
```

The command combines Analytics Engine feature events, authenticated D1 feature
rollups, hunter-checklist browser usage, and Ops Room posting counts. It excludes
the known initial production ingestion check by default and never prints raw or
hashed browser identifiers. Use `mise run analytics:report --help` for scope,
start-time, dataset, database, and JSON-output options. The command uses the
current Wrangler credentials, which need Account Analytics Read and access to
the selected remote D1 database. The JSON form is suitable for a
future scheduled export:

```bash
mise run analytics:report --json
```

`--since` defaults to `2026-08-31T19:34:14Z`; the command has no end-time
option. Anonymous events and Ops Room messages are filtered by their event
timestamps. D1 feature rows are selected by `last_used_at`, but their
`use_count` and `first_used_at` cover the lifetime of that scope/subject/feature
row. A later `--since` therefore does not turn feature opens into exact
within-window counts. Use the bounded SQL examples below for a fixed anonymous
event reporting interval. The domain conversion query is separate from the
report command.

The SQL below documents the underlying report contract and remains useful for
ad hoc investigation.

Use an Account Analytics Read API token with Cloudflare's SQL API. Restrict all
event reports by both scope and time range.

Feature events and estimated unique browsers:

```sql
SELECT
  blob2 AS event_name,
  count(DISTINCT index1) AS unique_browsers,
  sum(_sample_interval * double1) AS interactions
FROM ripota_usage
WHERE blob1 = 'activate-ri-2026'
  AND timestamp >= toDateTime('2026-08-31 00:00:00')
  AND timestamp < toDateTime('2026-10-01 00:00:00')
GROUP BY event_name
ORDER BY unique_browsers DESC
```

Estimated hunters who meaningfully used the checklist:

```sql
SELECT count(DISTINCT index1) AS hunter_browsers
FROM ripota_usage
WHERE blob1 = 'activate-ri-2026'
  AND blob2 IN (
    'hunter_import_attempted',
    'hunter_import_succeeded',
    'hunter_import_failed',
    'hunter_checklist_resumed',
    'hunter_manual_override_used',
    'hunter_schedule_details_opened'
  )
  AND timestamp >= toDateTime('2026-08-31 00:00:00')
  AND timestamp < toDateTime('2026-10-01 00:00:00')
```

Hunter import funnel:

```sql
SELECT
  blob2 AS event_name,
  blob10 AS import_method,
  blob8 AS error_code,
  count(DISTINCT index1) AS unique_browsers,
  sum(_sample_interval * double1) AS interactions
FROM ripota_usage
WHERE blob1 = 'activate-ri-2026'
  AND blob2 IN (
    'hunter_import_attempted',
    'hunter_import_succeeded',
    'hunter_import_failed'
  )
  AND timestamp >= toDateTime('2026-08-31 00:00:00')
  AND timestamp < toDateTime('2026-10-01 00:00:00')
GROUP BY event_name, import_method, error_code
ORDER BY event_name, import_method, error_code
```

`unique_browsers` is an estimate of browsers, not people: storage clearing,
multiple devices, private browsing, disabled analytics, and shared devices can
all change the relationship. Interaction totals account for Analytics Engine's
`_sample_interval`.

## Authenticated feature and domain reporting

Migration `0015_analytics_feature_usage.sql` adds the reusable
`analytics_feature_usage` rollup. It records only scope, subject type, the
existing opaque subject ID, feature, first/last use, and use count. The current
call sites record activators opening `ops_room`, `plan_editor`, or
`account_security`; the reusable helper also permits a `user` subject. It does
not duplicate callsigns, email addresses, chat text, form values, or auth
tokens.

Unique activators recorded opening authenticated features:

```sql
SELECT
  feature,
  COUNT(*) AS unique_activators,
  SUM(use_count) AS opens,
  MIN(first_used_at) AS first_use,
  MAX(last_used_at) AS last_use
FROM analytics_feature_usage
WHERE scope = 'activate-ri-2026'
  AND subject_type = 'activator'
GROUP BY feature
ORDER BY feature;
```

The `ops_room` rollup happens only after a successful Ops Room bootstrap, so it
answers how many activators opened the feature. Existing message data answers
how many actively posted, without analyzing message bodies:

```sql
SELECT
  COUNT(DISTINCT author_activator_id) AS activators_who_posted,
  COUNT(*) AS activator_messages
FROM activate_ri_ops_messages
WHERE event_id = 'activate-ri-2026'
  AND author_type = 'activator';
```

Volunteer conversion is a domain fact and should come from the existing D1
records rather than telemetry. Migration `0006_activator_owned_stops.sql`
removed `activate_ri_plans`: an activator owns their stops directly, and the
activator row holds review status. Count retained submissions by that status:

```sql
SELECT
  a.status AS review_status,
  COUNT(DISTINCT a.id) AS activators_with_stops,
  COUNT(s.id) AS stops_submitted
FROM activate_ri_activators a
JOIN activate_ri_stops s ON s.activator_id = a.id AND s.event_id = a.event_id
WHERE a.event_id = 'activate-ri-2026'
GROUP BY a.status
ORDER BY a.status;
```

This includes cancelled stops and withdrawn/rejected activators when their
records remain. Add explicit status filters when reporting approved or active
participation, and use the audit trail for historical submission actions.

Admin changes, approvals, authentication, live POTA evidence, and schedule
state likewise remain in their existing domain/audit tables. Custom product
analytics should never copy their sensitive payloads.

After exporting and reviewing the final aggregate report, set a deliberate D1
retention date for `analytics_feature_usage`. Deleting one scope is isolated:

```sql
DELETE FROM analytics_feature_usage WHERE scope = 'activate-ri-2026';
```
