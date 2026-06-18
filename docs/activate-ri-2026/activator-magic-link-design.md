# Activate RI 2026 Activator Magic Link Design

## Goals

- Let activators submit a plan and receive a private edit link immediately.
- Treat the activator as the owner of every plan submitted with their email.
- Keep organizer approval as the initial publication gate, not as an edit gate.
- Publish approved-plan edits immediately.
- Notify organizers about high-impact approved-plan changes without blocking the edit.
- Keep an admin-visible activity log for submissions, approvals, emails, edits, and cancellations.

## Activator Flow

1. Activator submits the volunteer form.
2. The Worker validates the plan, upserts the activator by normalized email,
   creates a private edit token, stores only the token hash on the activator,
   and stores the plan as pending.
3. The Worker emails the activator a private edit link immediately.
4. The activator can use that link before or after admin approval to manage all
   plans attached to the same email.
5. If the activator forgets the link, they can request a resend with callsign and email. The response is always privacy-safe and does not reveal whether a matching signup exists.

## Admin Flow

1. Admin reviews pending submissions in the protected admin UI.
2. Admin approves a plan once.
3. Approval publishes the plan and schedules its stops.
4. Later activator edits to approved plans are trusted and published immediately.
5. Admins receive notification emails for high-impact approved-plan changes.
6. Admins can review a chronological activity log in the admin UI.

## Edit Rules

- Pending plans: activator edits update the pending submission.
- Approved plans: activator edits update the public plan immediately.
- Activators can edit plan identity, email, club, organizer notes, parks, dates, time blocks, bands, modes, public notes, add stops, remove stops, and cancel.
- Removing a previously approved stop should soft-withdraw or cancel the stop rather than hard-delete it, preserving history.
- Full plan cancellation should cancel active stops and notify admins.

## Activity Log

Every meaningful action writes an event row:

- `plan-created`
- `edit-link-sent`
- `edit-link-send-failed`
- `edit-link-resent`
- `plan-approved`
- `plan-updated`
- `stop-added`
- `stop-updated`
- `stop-withdrawn`
- `plan-cancelled`
- `activator-notification-sent`
- `activator-notification-skipped`
- `activator-notification-failed`
- `admin-notification-sent`
- `admin-notification-failed`

Each event records:

- timestamp
- plan id
- optional stop id
- actor type: `activator`, `admin`, or `system`
- actor email when known
- action
- human-readable summary
- structured JSON details, including old and new values for important changes

## Email

Cloudflare Email Service should be used through the Worker `send_email` binding. Email sending is transactional:

- signup/edit-link email to the activator
- forgot-link resend email to the activator
- saved-edit receipt email to the activator for stop add/remove, park changes,
  date changes, time changes, and full plan cancellation
- high-impact edit notification email to admins

Email failures must not roll back accepted plan changes. Failures are logged as activity events.

## Publishing

Approved-plan edits should be public immediately. The current static JSON export model needs a follow-up publishing mechanism: either public pages should read schedule data from a live API, or edit mutations should trigger regeneration/deployment of public JSON. Until that is implemented, the database will hold the authoritative updated schedule, while static JSON may lag.
