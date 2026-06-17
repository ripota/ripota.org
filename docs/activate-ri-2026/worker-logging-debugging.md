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

That means deployed Worker invocations and `console.log` output are persisted
in Cloudflare Workers Logs after deploy. The Worker writes structured email
attempt logs from `src/worker/email.ts` with this shape:

```json
{
  "event": "email_send_attempt",
  "emailAttemptId": "<uuid>",
  "kind": "admin-activity",
  "status": "sent",
  "recipientsCount": 2,
  "recipientHashes": ["<sha256-email-hash>"],
  "subject": "Activate RI update: N1RWJ"
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

## Where To Look

Use the admin activity log first when debugging Activate RI behavior. It is the
highest-signal event history for submissions, approvals, edits, cancellations,
and email outcomes.

Use Workers Logs when you need request-level detail, structured
`email_send_attempt` entries, uncaught exceptions, or Cloudflare invocation
metadata.

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

If the action is `admin-notification-skipped` with
`reason: "no-admin-recipients"`, fix `ACTIVATE_RI_ADMIN_EMAILS` in the deployed
Worker environment.

If the action is `admin-notification-failed`, inspect `details.error` and the
matching Workers Logs entry.

If the action is `admin-notification-sent`, use `details.emailAttemptId` to
find the Worker log, then check Cloudflare Email Service logs for delivery or
rejection.

### An activator did not receive a private edit link

Check for `edit-link-sent`, `edit-link-send-failed`, or
`edit-link-send-skipped` around the plan submission or resend time.

If the activity log says `edit-link-sent`, the activator can use the resend
form to rotate and send a fresh magic link. If the activity log says failed or
skipped, inspect `details.error` or `details.reason`.

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

Use structured object logs for new Worker diagnostics:

```ts
console.log({
  event: "activate_ri_some_event",
  planId,
  status: "started",
});
```

Do not log raw edit tokens, Access JWTs, Turnstile secrets, phone numbers,
full recipient email addresses, request bodies, or admin email lists. Prefer
stable IDs, counts, statuses, and hashed values.

Keep D1 activity events for durable business history. Use Workers Logs for
request-level diagnostics and transient debugging context.

## References

- Cloudflare Workers Logs:
  <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>
- Cloudflare Real-time logs:
  <https://developers.cloudflare.com/workers/observability/logs/real-time-logs/>
- Cloudflare Wrangler observability config:
  <https://developers.cloudflare.com/workers/wrangler/configuration/#observability>
