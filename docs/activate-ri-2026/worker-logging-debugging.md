# Activate RI 2026 Worker Logging And Debugging

This runbook explains how to use Cloudflare Worker logs, D1 activity events,
and Email Service logs to answer operational questions after deploy.

## What Is Logged

Cloudflare Worker observability is enabled in `wrangler.jsonc`:

```jsonc
"observability": {
  "enabled": true
}
```

That means deployed Worker invocations, uncaught Worker exceptions, and
`console.log`/`console.error` output are persisted in Cloudflare Workers Logs
after deploy. Caught operational failures use structured error entries with an
`event`, a bounded `errorName`/`errorMessage`, and safe diagnostic fields. The
Worker writes structured email attempt logs from `src/worker/email.ts` with
this shape:

```json
{
  "event": "email_send_attempt",
  "emailAttemptId": "<uuid>",
  "kind": "admin-pending-plan",
  "status": "sent",
  "recipientsCount": 2,
  "recipientHashes": ["<sha256-email-hash>"],
  "subject": "Activate RI approval needed: N1RWJ"
}
```

The D1 activity log is the durable app-level audit trail. It is available in
the protected admin UI and through:

```text
GET /api/activate-ri-2026/admin/activity
```

Email-related activity entries include `details.emailAttemptId` so D1 activity
can be correlated with Workers Logs. Recipient email addresses are not written
to logs; the Worker records counts and SHA-256 hashes instead.

## Browser Error Reports

Pages using `BaseLayout.astro` install a small error reporter in the document
head. It reports these otherwise browser-only failures:

- uncaught JavaScript errors;
- unhandled promise rejections, using message and stack details only when the
  reason is an `Error`; and
- failed same-origin script or stylesheet loads.

Reports are posted to `POST /api/client-errors`. The Worker validates and
bounds the payload, then emits a structured Workers Logs entry with
`event = "client-error"`. Search or filter on that event, then use `kind`,
`route`, `errorName`, `message`, `source`, and `cfRay` to group related
failures. Browser bundle source maps are emitted by Astro/Vite, so the logged
bundle location can be resolved against the matching deployment artifact.

The reporter is intentionally best-effort. It deduplicates identical errors,
sends at most five reports per page load, and the Worker accepts at most 20
reports per network key per minute. Reporting failures never affect the page.
Handled UI errors are not reported; their API requests and corresponding
Worker logs remain the source of truth.

Client reports exclude cookies, form values, request bodies, user-agent and IP
addresses, URL query strings and fragments, and non-`Error` promise rejection
values. Email addresses, bearer/JWT credentials, sensitive query parameters,
and private edit-link tokens are redacted. The endpoint only accepts trusted
same-origin requests and bodies no larger than 8 KiB. Cloudflare uses the
connecting IP only inside the rate-limit binding; the application does not
write it to logs.

## Where To Look

Use the admin activity log first when debugging Activate RI behavior. It is the
highest-signal event history for submissions, approvals, edits, cancellations,
and email outcomes.

Use Workers Logs when you need request-level detail, structured
`email_send_attempt` or `client-error` entries, caught operational failures,
uncaught exceptions, or Cloudflare invocation metadata.

Use Cloudflare Email Service logs when the Worker says an email was sent but
you need to confirm whether Cloudflare accepted, rejected, delivered, or failed
the message.

## Real-Time Debugging

For a live reproduction, stream deployed Worker logs with Wrangler:

```bash
npx wrangler tail ripota-org
```

If you only care about email attempts, pipe the stream through `jq`:

```bash
npx wrangler tail ripota-org \
  | jq '.. | objects | select(.event? == "email_send_attempt")'
```

For browser failures, filter on the client event instead:

```bash
npx wrangler tail ripota-org \
  | jq '.. | objects | select(.event? == "client-error")'
```

For high-volume debugging, prefer narrower filters in the Cloudflare dashboard
or Wrangler tail options so log messages are less likely to be sampled or
dropped by the real-time stream.

## Historical Debugging

1. Open `/activate-ri-2026/admin/`.
2. Find the relevant activity event:
   - `edit-link-sent`
   - `edit-link-send-failed`
   - `edit-link-send-skipped`
   - `approval-email-sent`
   - `approval-email-failed`
   - `approval-email-skipped`
   - `admin-notification-sent`
   - `admin-notification-failed`
   - `admin-notification-skipped`
3. Copy `details.emailAttemptId` when present.
4. In Cloudflare Dashboard, open the `ripota-org` Worker and go to
   **Observability**.
5. Search Workers Logs for the `emailAttemptId` or for
   `event = "email_send_attempt"` around the activity timestamp.
6. If the Worker status is `sent`, check Cloudflare Email Service logs for the
   same subject and time window.

The important distinction is:

- `sent`: the Worker called the Email Service binding without an exception.
- `failed`: the binding call threw, and `details.error` should explain why.
- `skipped`: the Worker deliberately did not attempt a send. Check
  `details.reason`.

Common skipped reasons:

- `no-admin-recipients`: `ACTIVATE_RI_ADMIN_EMAILS` is missing or empty.
- `no-trigger-events`: the admin notification helper was called without
  high-impact activity events.
- `email-binding-missing`: the `EMAIL` binding is unavailable in that runtime.
- `email-sender-missing`: `ACTIVATE_RI_EMAIL_FROM` is missing.

## Common Questions

### An admin email should have been sent, but nobody saw it

Check the admin activity log for `admin-notification-*`.

For a new pending submission, a healthy flow should include an
`admin-notification-sent` activity entry with `details.status: "sent"`.

If the action is `admin-notification-skipped` with
`reason: "no-admin-recipients"`, fix `ACTIVATE_RI_ADMIN_EMAILS` in the deployed
Worker environment.

If the action is `admin-notification-failed`, inspect `details.error` and the
matching Workers Logs entry.

If the action is `admin-notification-sent`, use `details.emailAttemptId` to
find the Worker log, then check Cloudflare Email Service logs for delivery or
rejection.

### An activator did not receive a sign-in link

Check `plan-created.details.accessEmail` and the matching
`auth-email-login`/`auth-activator-submission` Worker email attempt.

The activator can request a fresh 15-minute link from `/account/sign-in/`.
If delivery failed or skipped, inspect `details.error` or `details.reason`.
Do not mint or email a new reusable private link as routine recovery.

### Public schedule data looks stale

Check whether the relevant plan/stop activity happened first. Then request the
live D1-backed endpoint directly:

```bash
curl -s https://ripota.org/api/activate-ri-2026/public/stops \
  | jq '.generatedAt, (.stops | length)'
```

If this endpoint has fresh data but the browser does not, investigate browser
or edge caching. If this endpoint is stale, inspect D1 activity and Worker logs
for the edit/approval request.

## Logging Guidelines

Use `logWorkerError` for caught failures so errors are consistently structured,
bounded, and redacted:

```ts
logWorkerError("activate-ri-some-operation-failed", error, {
  planId,
  category: "database",
});
```

Do not log raw edit tokens, Access JWTs, Turnstile secrets, phone numbers,
full recipient email addresses, request bodies, or admin email lists. Prefer
stable IDs, counts, statuses, and hashed values.

For Ops Room diagnostics, also exclude message bodies, local drafts, cookies,
raw credentials, and full WebSocket URLs. Log only opaque identifiers, durable
sequence numbers, results, durations, and sanitized errors. The broadcast and
recipient tables are authoritative for delivery state; retry only failed
recipients and never paste a raw recipient list into logs or incident notes.

Keep D1 activity events for durable business history. Use Workers Logs for
request-level diagnostics and transient debugging context.

## References

- Cloudflare Workers Logs:
  <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>
- Cloudflare Real-time logs:
  <https://developers.cloudflare.com/workers/observability/logs/real-time-logs/>
- Cloudflare Wrangler observability config:
  <https://developers.cloudflare.com/workers/wrangler/configuration/#observability>
