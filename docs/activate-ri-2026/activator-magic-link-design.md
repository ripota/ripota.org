# Activate RI 2026 Activator Magic Link Design

## Goals

- Let activators submit a route and receive a private edit link immediately.
- Treat the activator as the owner of their route after submission.
- Keep organizer approval as the initial publication gate, not as an edit gate.
- Publish approved-route edits immediately.
- Notify organizers about high-impact approved-route changes without blocking the edit.
- Keep an admin-visible activity log for submissions, approvals, emails, edits, and cancellations.

## Activator Flow

1. Activator submits the volunteer form.
2. The Worker validates the route, creates a private edit token, stores only the token hash, and stores the route as pending.
3. The Worker emails the activator a private edit link immediately.
4. The activator can use that link before or after admin approval.
5. If the activator forgets the link, they can request a resend with callsign and email. The response is always privacy-safe and does not reveal whether a matching signup exists.

## Admin Flow

1. Admin reviews pending submissions in the protected admin UI.
2. Admin approves a route once.
3. Approval publishes the route and schedules its stops.
4. Later activator edits to approved routes are trusted and published immediately.
5. Admins receive notification emails for high-impact approved-route changes.
6. Admins can review a chronological activity log in the admin UI.

## Edit Rules

- Pending routes: activator edits update the pending submission.
- Approved routes: activator edits update the public plan immediately.
- Activators can edit route identity, email, club, organizer notes, parks, dates, time blocks, bands, modes, public notes, add stops, remove stops, and cancel.
- Removing a previously approved stop should soft-withdraw or cancel the stop rather than hard-delete it, preserving history.
- Full route cancellation should cancel active stops and notify admins.

## Activity Log

Every meaningful action writes an event row:

- `route-created`
- `edit-link-sent`
- `edit-link-send-failed`
- `edit-link-resent`
- `route-approved`
- `route-updated`
- `stop-added`
- `stop-updated`
- `stop-withdrawn`
- `route-cancelled`
- `admin-notification-sent`
- `admin-notification-failed`

Each event records:

- timestamp
- route id
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
- high-impact edit notification email to admins

Email failures must not roll back accepted route changes. Failures are logged as activity events.

## Publishing

Approved-route edits should be public immediately. The current static JSON export model needs a follow-up publishing mechanism: either public pages should read schedule data from a live API, or edit mutations should trigger regeneration/deployment of public JSON. Until that is implemented, the database will hold the authoritative updated schedule, while static JSON may lag.
