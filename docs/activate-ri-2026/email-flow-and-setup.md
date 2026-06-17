# Activate RI 2026 Email Flow and Operational Setup

This document covers the activator magic-link email flow and the operational
setup required in Cloudflare.

## Runtime Flow

### Initial signup

1. The activator submits `/activate-ri-2026/volunteer/`.
2. `POST /api/activate-ri-2026/plans` validates the submission and Turnstile.
3. The Worker generates a random edit token.
4. The activator row is upserted by normalized email.
5. Only the SHA-256 token hash is stored in
   `activate_ri_activators.magic_token_hash`.
6. The plan is stored as `pending` under that activator.
7. A `plan-created` activity event is written.
8. The Worker sends the activator an email containing:
   - the private edit URL
   - a note that the link works before and after organizer approval
9. Email success or failure is written as `edit-link-sent` or
   `edit-link-send-failed`.
10. The Worker sends admins an approval-needed email if
    `ACTIVATE_RI_ADMIN_EMAILS` is configured.
11. Admin notification success, failure, or skip is written as
    `admin-notification-sent`, `admin-notification-failed`, or
    `admin-notification-skipped`.

The plan submission still succeeds if email delivery fails. The failure is
visible in the admin activity log.

### Admin approval

1. Admin reviews pending plans at `/activate-ri-2026/admin/`.
2. Approval changes the plan to `approved`.
3. Pending stops are changed to `scheduled`.
4. A `plan-approved` activity event is written.
5. Approval does not generate or reveal the edit link. The activator already
   received it during signup, or can request a resend.

### Activator edits

1. The activator opens `/activate-ri-2026/edit/<token>/`.
2. The browser loads all plans for that activator from
   `GET /api/activate-ri-2026/edit/<token>/plans`.
3. Saving submits the selected plan to
   `PATCH /api/activate-ri-2026/edit/<token>/plans/<plan-id>`.
4. Pending plans update immediately but are still not public.
5. Approved plans update immediately and the live public schedule/coverage API
   reflects the new D1 data.
6. Every meaningful edit writes activity events.
7. High-impact approved-plan changes trigger an admin notification attempt.
   The activity log records `admin-notification-sent`,
   `admin-notification-failed`, or `admin-notification-skipped`.

High-impact events currently include approved stop removals/cancellations,
approved park/date changes, and full plan cancellation.

### Forgot-link resend

1. The activator enters callsign and email on the volunteer page.
2. `POST /api/activate-ri-2026/resend-edit-link` looks for a matching
   activator by callsign and normalized email.
3. The response is always privacy-safe:
   `If we found a matching signup, we sent the private edit link.`
4. If a match exists, the Worker rotates the activator magic token, stores the
   new hash, sends a fresh link, and logs the resend event.

## Cloudflare Email Service Setup

This project sends transactional email through Cloudflare Email Service using a
Workers `send_email` binding named `EMAIL`.

Relevant config:

- `wrangler.jsonc` has `send_email` bindings named `EMAIL`.
- `ACTIVATE_RI_EMAIL_FROM` defaults to `activate-ri-2026@ripota.org`.
- `ACTIVATE_RI_EMAIL_FROM_NAME` defaults to `RI POTA`.
- `ACTIVATE_RI_ADMIN_EMAILS` must be configured outside the repository.

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

If the token is missing D1 access, either update/create the token or temporarily
run Wrangler without the token environment variables:

```bash
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
  npx wrangler d1 migrations apply ripota-org --remote
```

### 2. Apply the D1 migration locally

The repo already has a local mise task:

```bash
mise run activate-ri-2026:d1-apply-local
```

Equivalent raw Wrangler command:

```bash
npx wrangler d1 migrations apply ripota-org --local
```

### 3. Apply the D1 migration to the deployed database

Use the top-level Wrangler config unless you have intentionally deployed a
separate Worker environment. The current deployed Worker is expected to be
`ripota-org`, not `ripota-org-production`.

Important: D1 migration commands default to local Wrangler storage unless
`--remote` is passed. Use `--remote` for the deployed Cloudflare D1 database.

```bash
npx wrangler d1 migrations apply ripota-org --remote
```

Wrangler will show the unapplied migration and prompt for confirmation. The
new migration is:

```text
migrations/0003_magic_links_and_audit.sql
```

### 4. Enable Email Sending for `ripota.org`

Dashboard path:

1. Open the Cloudflare dashboard.
2. Go to **Compute & AI** > **Email Service** > **Email Sending**.
3. Choose **Onboard Domain**.
4. Select `ripota.org`.
5. Let Cloudflare add the required SPF/DKIM DNS records.

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
npx wrangler secret put ACTIVATE_RI_ADMIN_EMAILS
```

When prompted, enter a comma-separated list, for example:

```text
person1@example.com,person2@example.com
```

Current operational note: the deployed value may temporarily contain only
Rob's email address during setup/testing. Before launch, update
`ACTIVATE_RI_ADMIN_EMAILS` to include K1NW and N1BS as admin notification
recipients.

For local testing, use `.dev.vars` or a local environment-specific secret. Do
not commit `.dev.vars`.

### 6. Deploy

```bash
npx wrangler deploy
```

Do not add `--env production` unless you intentionally want Wrangler to target
or create an environment-specific Worker named `ripota-org-production`.

If you accidentally ran:

```bash
npx wrangler d1 migrations apply ripota-org --env production
```

that likely affected local Wrangler D1 state, not the deployed database. Verify
the deployed database with:

```bash
npx wrangler d1 migrations list ripota-org --remote
```

### 7. Verify email delivery

Recommended smoke test:

1. Submit a test plan from `/activate-ri-2026/volunteer/`.
2. Confirm the activator email arrives.
3. Open the private edit link.
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

- If activator submissions succeed but no email arrives, check the admin
  activity log for `edit-link-send-failed` or `edit-link-send-skipped`.
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
  JSON files are only fallback content now.
- If remote D1 commands fail with `Authentication error`, code `10000`, or
  code `7403`, check whether `CLOUDFLARE_API_TOKEN` is set. The token must have
  Account > D1 > Edit permission, or you must run Wrangler without that token
  so it can use `wrangler login` authentication.
