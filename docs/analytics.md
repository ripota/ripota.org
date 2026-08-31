# Privacy-conscious product analytics

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
repository. There is no Web Analytics beacon or token in the source or current
built HTML, so the repository does not prove that the browser beacon is active.
Confirm the production zone's **Analytics & Logs > Web Analytics** setting and
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

Analytics Engine retains data for three months, so export the September event
report by December 10, 2026. See Cloudflare's
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
existing opaque activator ID, feature, first/last use, and use count. It does
not duplicate callsigns, email addresses, chat text, form values, or auth
tokens.

Unique activators who successfully opened authenticated features:

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
records rather than telemetry:

```sql
SELECT
  COUNT(DISTINCT activator_id) AS activators_with_plans,
  COUNT(*) AS plans_submitted
FROM activate_ri_plans
WHERE event_id = 'activate-ri-2026';
```

Admin changes, approvals, authentication, live POTA evidence, and schedule
state likewise remain in their existing domain/audit tables. Custom product
analytics should never copy their sensitive payloads.

After exporting and reviewing the final aggregate report, set a deliberate D1
retention date for `analytics_feature_usage`. Deleting one scope is isolated:

```sql
DELETE FROM analytics_feature_usage WHERE scope = 'activate-ri-2026';
```
