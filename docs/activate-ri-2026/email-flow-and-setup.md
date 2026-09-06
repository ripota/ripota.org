# Activate RI 2026 Email Flow and Operational Setup

This document covers activator account email, explicit Ops Room
announcement broadcasts, and the operational setup required in Cloudflare.

## Runtime Flow

### Initial signup

1. The activator submits `/activate-ri-2026/volunteer/`.
2. `POST /api/activate-ri-2026/plans` validates the submission and Turnstile.
3. The activator row is upserted by normalized event email. A new/unapproved
   activator remains `pending`; an approved activator keeps approval and
   additional submitted stops go straight to `scheduled`.
4. No reusable edit token is created when
   `AUTH_LEGACY_LINK_ISSUANCE_ENABLED=false`.
5. A 15-minute login token is generated; only its SHA-256 hash is stored in
   `auth_email_tokens`.
6. The Worker emails a fragment-based, single-use account-claim link that
   opens My Plan. Delivery failure invalidates the token.
7. A `plan-created` activity event records the access-email outcome.
8. For a pending signup, the Worker sends admins an approval-needed email if
   `ACTIVATE_RI_ADMIN_EMAILS` is configured.
9. Admin notification success, failure, or skip is written as
    `admin-notification-sent`, `admin-notification-failed`, or
    `admin-notification-skipped`.

The plan submission still succeeds if email delivery fails. The failure is
visible in the admin activity log. API plans are activator-owned itineraries;
there is no separate plan table or new review gate for each repeat submission.

### Admin approval

1. Admin reviews pending plans at `/activate-ri-2026/admin/`.
2. Approval changes the plan to `approved`.
3. Pending stops are changed to `scheduled`.
4. A `plan-approved` activity event is written.
5. The Worker sends the activator an approval receipt email containing:
   - the live status (`Live on the public schedule`)
   - the current saved stop list
   - the public schedule URL
   - the activator help URL
6. Approval links to the stable My Plan URL and contains no bearer credential.

### Activator edits

1. The activator signs in with a passkey or 15-minute email link. An existing
   legacy `/activate-ri-2026/access/#<token>` or `/edit/<token>/` link also works.
2. Successful authentication creates a hashed, HttpOnly 14-day browser session
   and the browser enters the tokenless activator portal.
3. The editor uses session-authenticated `/api/activate-ri-2026/activator/*`
   routes. Legacy token APIs remain compatibility adapters.
4. Pending plans update immediately but are still not public.
5. Approved plans update immediately and the live public schedule/coverage API
   reflects the new D1 data.
6. Every meaningful edit writes activity events.
7. Saved plan edits trigger an activator receipt email with the current saved
   status, current saved stop list, and stable tokenless My Plan URL. Even edits
   made through a legacy adapter do not redistribute the reusable credential.
8. High-impact approved-plan changes trigger an admin notification attempt.
   The activity log records `admin-notification-sent`,
   `admin-notification-failed`, or `admin-notification-skipped`.

High-impact events currently include approved stop removals/cancellations,
approved park/date changes, and full plan cancellation.

Activator receipt emails, including approval email,
plan-update email, and cancellation email, share one receipt layout. They render
stop summaries from the saved D1 plan state, sorted by date, start time, park
reference, and park name:

```text
- YYYY-MM-DD HH:MM-HH:MM: Park Name (US-1234)
```

### Account recovery

1. The activator expands **Email me a sign-in link** on the shared sign-in page
   and submits their email address. The section starts collapsed.
2. `POST /api/auth/email-login` looks for an eligible activator by normalized email.
3. The response is always privacy-safe:
   `If we found an account that can use email sign-in, we sent a link.`
4. If a match exists, the Worker sends a single-use token protected by
   Turnstile and email/network rate limits. Recovery neither creates nor
   revokes a durable legacy link.

The old `/resend-edit-link` endpoint remains a compatibility adapter. With
legacy issuance disabled it sends the same single-use email token after a
callsign/email match and rate limiting; it does not mint an edit token.

### Unified sign-in and passkey reset

The shared sign-in page can send an eligible activator a 15-minute access link
when `AUTH_EMAIL_LOGIN_ENABLED=true`. The endpoint always returns the same
message for known, unknown, disabled, and ineligible addresses. Turnstile plus
auth-specific network/email limits protect the request. The database stores
only a token hash; the raw token is placed after `#` in the account-access URL,
is consumed once, and is invalidated if delivery fails.

A passkey-authenticated administrator can send a 30-minute passkey replacement
link from the admin Account security tab. Completing registration revokes the
account's previous passkeys and sessions. Reset delivery failure invalidates the
token and leaves existing credentials unchanged. Re-enabling a disabled account
does not restore a credential; the administrator must explicitly send a reset
link afterward.

Both messages state that RI POTA is unofficial, point to official POTA resources
as the source of truth, and never request an RI POTA or POTA password. Existing
private activator links continue to work and are not revoked by email sign-in or
passkey reset.

### Organizer security replacement

The admin panel exposes distinct operations with different scopes:

- **Account security → Revoke sessions** invalidates unified sessions and related
  legacy activator sessions, while keeping passkeys and private links usable.
- **Ops members → Revoke portal sessions** invalidates legacy activator sessions
  only. It does not end unified account sessions.
- **Ops members → Revoke legacy access** revokes the activator's edit tokens and
  legacy browser sessions, sends
  a security notification with the stable My Plan URL, and writes an audit
  event. It does not revoke unified sessions/passkeys or create a replacement
  durable link.

These are separate from Ops Room mute/ban controls. A room ban does not remove
plan-edit access.

### Ops Room announcement email

Ordinary room messages never send email. An organizer must explicitly select
**Also email eligible activators** and confirm the recipient count when posting
an announcement. The room announcement commits independently before delivery.

Eligible recipients are active and muted Ops Room members; banned or unapproved
activators are excluded. Recipient IDs are snapshotted in D1. The Worker sends
BCC batches of at most 49 activator addresses, using the event sender address as
the single `To` recipient so the provider's combined count stays at most 50.
Addresses are never exposed to other recipients. Delivery status is recorded as
`pending`, `sending`, `sent`, `partial`, or `failed`, and the admin panel can
retry failed recipients only.

## Cloudflare Email Service Setup

This project sends transactional email through Cloudflare Email Service using a
Workers `send_email` binding named `EMAIL`.

Relevant config:

- `wrangler.jsonc` has `send_email` bindings named `EMAIL`.
- `ACTIVATE_RI_EMAIL_FROM` defaults to `activate-ri-2026@ripota.org`.
- `ACTIVATE_RI_EMAIL_FROM_NAME` defaults to `RI POTA`.
- `ACTIVATE_RI_ADMIN_EMAILS` must be configured outside the repository.
- `AUTH_EMAIL_LOGIN_ENABLED` gates activator email fallback; it is `false` in
  rollback-safe configuration and enabled in current production.
- `AUTH_LEGACY_LINK_ISSUANCE_ENABLED` independently gates creation of new
  reusable edit links. It is `false` in current production; acceptance of
  already-issued links remains enabled.

Cloudflare docs:

- Email Sending getting started:
  <https://developers.cloudflare.com/email-service/get-started/send-emails/>
- Workers Email Sending API:
  <https://developers.cloudflare.com/email-service/api/send-emails/workers-api/>

## One-Time Operational Steps

### 1. Confirm Wrangler auth

```bash
npx wrangler whoami
```

If needed, log in:

```bash
npx wrangler login
```

If `whoami` says Wrangler is using `CLOUDFLARE_API_TOKEN`, that environment
variable overrides the interactive Wrangler login. Remote D1 migrations require
that token to have D1 access.

For D1 migrations, Cloudflare documents the required API token permission as:

- Account > D1 > Edit

If the token is missing D1 access, either update/create the token or verify
interactive Wrangler authentication without the token environment variables:

```bash
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
  npx wrangler whoami
```

Before running the migration task with interactive authentication, remove the
overriding token from the task's environment source as well. Mise loads `.env`,
so unsetting a shell variable alone can leave the same token active in a task.
Keep credential values out of logs and the repository.

### 2. Apply the D1 migration locally

The repo already has a local mise task:

```bash
mise run activate-ri-2026:d1-apply-local
```

Equivalent raw Wrangler command:

```bash
npx wrangler d1 migrations apply ripota-org --local --env local
```

### 3. Apply the D1 migration to the deployed database

Use the top-level Wrangler config unless you have intentionally deployed a
separate Worker environment. The current deployed Worker is expected to be
`ripota-org`, not `ripota-org-production`.

Important: D1 migration commands default to local Wrangler storage unless
`--remote` is passed. Use `--remote` for the deployed Cloudflare D1 database.

```bash
mise run d1:migrate-production
```

The task checks authentication, backs up production, and applies all pending
top-level migrations. Use the complete ordered `migrations/` directory; do not
apply only the original session/Ops/auth files. Inspect pending migrations with:

```bash
npx wrangler d1 migrations list ripota-org --remote --env ""
```

The checked-in sequence currently runs through
`0021_pota_post_close_history_sync.sql`, including unified authentication,
ownership preservation, community bylines, analytics, and POTA evidence/history.

### 4. Enable Email Sending for `ripota.org`

Dashboard path:

1. Open the Cloudflare dashboard.
2. Go to **Compute** > **Email Service** > **Email Sending**.
3. Choose **Onboard Domain**.
4. Select `ripota.org`.
5. Review and add the domain's required DNS records, including bounce handling
   and email authentication, as shown by the onboarding workflow.

CLI alternative:

```bash
npx wrangler email sending enable ripota.org
npx wrangler email sending dns get ripota.org
```

Wait for the Email Sending dashboard to show the domain as ready.

### 5. Configure admin notification recipients

Do not commit admin email addresses to the repository.

Set the comma-separated admin recipient list on the deployed Worker:

```bash
npx wrangler secret put ACTIVATE_RI_ADMIN_EMAILS --env ""
```

When prompted, enter a comma-separated list, for example:

```text
person1@example.com,person2@example.com
```

Confirm the intended organizer recipients in the deployed secret before launch
and after staffing changes. Repository configuration does not establish who is
currently on that private list.

For local testing, use `.dev.vars` or a local environment-specific secret. Do
not commit `.dev.vars`.

### 6. Publish the sender logo BIMI record

The site includes a BIMI-oriented sender logo at:

```text
https://ripota.org/assets/logos/ri-pota-bimi.svg
```

Cloudflare DNS should include this TXT record:

```text
default._bimi.ripota.org TXT "v=BIMI1; l=https://ripota.org/assets/logos/ri-pota-bimi.svg;"
```

Verify the current DMARC enforcement policy before relying on BIMI; the DNS
state is external to this repository. Some mailbox providers, including Gmail, require a Verified Mark
Certificate or Common Mark Certificate before showing the logo. If a certificate
is issued later, host the PEM file over HTTPS and add the `a=` tag:

```text
default._bimi.ripota.org TXT "v=BIMI1; l=https://ripota.org/assets/logos/ri-pota-bimi.svg; a=https://ripota.org/assets/bimi/ripota.pem;"
```

After DNS publishes, validate the record and asset:

```bash
dig +short TXT default._bimi.ripota.org
dig +short TXT _dmarc.ripota.org
curl -I https://ripota.org/assets/logos/ri-pota-bimi.svg
```

### 7. Deploy

```bash
mise run deploy
```

The task backs up D1, applies remote migrations, and deploys the top-level
Worker. Do not deploy with `wrangler deploy --env production`.

If you accidentally ran:

```bash
npx wrangler d1 migrations apply ripota-org --env production
```

that likely affected local Wrangler D1 state, not the deployed database. Verify
the deployed database with:

```bash
npx wrangler d1 migrations list ripota-org --remote --env ""
```

### 8. Verify email delivery

Recommended smoke test:

1. Submit a test plan from `/activate-ri-2026/volunteer/`.
2. Confirm the activator email arrives.
3. Open the 15-minute, single-use sign-in link and confirm it lands on My Plan.
4. Save a small edit.
5. Approve the plan in `/activate-ri-2026/admin/`.
6. Make a high-impact edit, such as changing the park or cancelling the plan.
7. Confirm admin notification email arrives.
8. Open the admin activity log and verify the email and edit events are listed.

You can also send a direct Email Sending test from Wrangler:

```bash
npx wrangler email sending send \
  --from "activate-ri-2026@ripota.org" \
  --to "your-test-address@example.com" \
  --subject "RI POTA email test" \
  --text "Cloudflare Email Sending is configured."
```

## Troubleshooting

- If activator submissions succeed but no email arrives, check
  `plan-created.details.accessEmail` and the `auth-activator-submission`
  email-attempt log.
- If admin notifications do not arrive, confirm `ACTIVATE_RI_ADMIN_EMAILS` is
  configured in the same environment that was deployed. If it is missing, the
  admin activity log records `admin-notification-skipped` with
  `reason: "no-admin-recipients"`.
- For deeper tracing, correlate the activity log `emailAttemptId` with Workers
  Logs entries whose `event` is `email_send_attempt`, then check Cloudflare
  Email Service logs for the same subject and recipient window. See
  `docs/activate-ri-2026/worker-logging-debugging.md` for the full logging
  runbook.
- If the Worker says the sender is not verified, finish Email Sending domain
  onboarding for `ripota.org`.
- If local email tests fail, remember that local dev may use simulated bindings
  unless configured for remote sending.
- If public schedule data appears stale, verify that
  `/api/activate-ri-2026/public/stops` returns the updated D1 rows. The static
  event/park JSON files contain reference data, not current itinerary state.
  Production shows an unavailable state when the live schedule fails; only
  Astro dev may use a dated local `stops.json` export.
- If remote D1 commands fail with `Authentication error`, code `10000`, or
  code `7403`, check whether `CLOUDFLARE_API_TOKEN` is set. The token must have
  Account > D1 > Edit permission, or you must run Wrangler without that token
  so it can use `wrangler login` authentication.
