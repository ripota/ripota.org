# Activate All RI 2026 Design

## Summary

Activate All RI 2026 is an event section for ripota.org that helps the
Rhode Island POTA community recruit activators, cover all 61 Rhode Island
POTA references, help hunters find needed parks, and later verify community
recognition claims.

The current planning target is Friday, September 11 through Sunday,
September 13, 2026, with Thursday, September 10 as an optional soft-start
day. The main event goal is to activate all 61 Rhode Island POTA parks during
the Friday-Sunday window.

The site must keep the existing unofficial community-site positioning clear.
Official Parks on the Air resources remain the source of truth for rules,
reference data, accounts, spots, logs, and official awards.

## Goals

- Recruit enough activators to cover all 61 Rhode Island POTA parks.
- Provide organizers with a moderated workflow for reviewing activator
  submissions.
- Publish a public schedule that hunters can use during the event.
- Show park coverage by park and by time.
- Let approved activators keep their own route details current without
  requiring organizer review for every schedule tweak.
- Keep public traffic static-first and inexpensive.
- Provide a path for hunter progress tracking and later event recognition.

## Non-Goals

- Do not build a site-native account system in the first release.
- Do not imply ripota.org can grant official POTA credit or replace official
  POTA logs, spots, or awards.
- Do not show "currently active" state unless backed by real POTA spot data.
- Do not make hunter tools block the first activator recruitment release.
- Do not commit private Groups.io exports, local filesystem paths, secrets, or
  unpublished assets.

## Phases

### Phase 1: Activator Recruitment and Coverage

Phase 1 ships the operational core needed for planning.

Routes:

- `/activate-ri-2026`
- `/activate-ri-2026/volunteer`
- `/activate-ri-2026/schedule`
- `/activate-ri-2026/parks`
- `/activate-ri-2026/admin`

Capabilities:

- Event landing page with phase-aware calls to action.
- Public activator route submission.
- Cloudflare Turnstile protection for public forms.
- D1-backed moderation queue.
- Cloudflare Access-protected organizer dashboard.
- Approval, rejection, editing, and merging of submitted activation routes.
- Magic edit links for approved activators.
- Public by-park coverage view.
- Public by-schedule view.
- Automatic public JSON regeneration after approval, edit, or cancellation.
- Manual public JSON rebuild from the admin dashboard and from a local task.

### Phase 1.5: Hunter Tools

Phase 1.5 ships before the event but does not block activator recruitment.

Routes:

- `/activate-ri-2026/hunters`

Capabilities:

- Client-side import of the official POTA hunted-parks CSV.
- All-time Rhode Island hunter progress against the 61 RI references.
- Missing-parks list.
- Cross-reference missing parks with the public event schedule.
- Manual checklist fallback stored locally in the browser.
- Clear copy that official POTA remains the source of truth.

### Phase 2: Awards and Post-Event Verification

Phase 2 supports recognition and post-event processing.

Routes:

- `/activate-ri-2026/awards`

Capabilities:

- Website-based recognition claims.
- CSV-assisted all-61 RI hunter recognition.
- Activator log upload for participating activations.
- Weekend Sweep verification from activator-submitted logs.
- Organizer review and approval of claims.
- Certificate or confirmation flow.

## Architecture

Use a hybrid architecture:

- Astro builds the public pages and static shell.
- Cloudflare Workers Static Assets serves public pages and generated JSON.
- Worker API routes handle submissions, admin actions, magic-link edits, and
  award workflows.
- D1 stores operational records.
- R2 is optional for raw uploaded files such as ADIF logs or claim proof
  bundles.

Public pages should read generated JSON files instead of querying D1 on every
request. This keeps high-traffic event views cheap, cacheable, and resilient.
D1 remains the working database for moderation and organizer workflows.

## Authentication and Permissions

Organizer authentication should use Cloudflare Access instead of a custom user
system.

- Protect `/activate-ri-2026/admin` and admin API routes with Cloudflare
  Access.
- Use a small allowlist of trusted organizer email addresses.
- One-Time PIN login is sufficient for the expected organizer group.
- The Worker should validate Cloudflare Access identity on admin API routes.
- Store the organizer email on moderation and publish actions for audit
  history.

Activator self-service should use magic edit links:

- Public submitters do not create accounts.
- After approval, an activator receives a private edit link.
- The link contains a long random token tied to that submission or route.
- The activator can edit only their own route and stops.
- Tokens can be rotated or revoked by organizers.

## Data Model

### Event

Fields:

- `id`
- `name`
- `slug`
- `phase`
- `mainStartDate`
- `mainEndDate`
- `softStartDate`
- `timezone`
- `goalParkCount`
- `publicSummary`

Supported phases:

- `planning`
- `schedule-live`
- `event-live`
- `post-event`

The phase controls landing-page emphasis:

- `planning`: primary CTA is volunteer to activate.
- `schedule-live`: primary CTA is find scheduled activations.
- `event-live`: primary CTA is find parks on the air or scheduled now.
- `post-event`: primary CTA is check recognition eligibility.

### Park

Fields come from the project's Rhode Island POTA reference data:

- `reference`
- `name`
- `region`
- `county`
- `location`
- `boundaryGeoJsonPath`

POTA references and official status should be refreshed from official POTA
sources using existing project data-update patterns.

### Activation Route

An activation route is one submitter's plan. It may contain one or more stops.

Fields:

- `id`
- `eventId`
- `submitterCallsign`
- `submitterName`
- `submitterEmail`
- `submitterPhone`
- `club`
- `publicNotes`
- `organizerNotes`
- `status`
- `createdAt`
- `updatedAt`
- `approvedAt`
- `approvedBy`
- `editTokenHash`

Route statuses:

- `pending`
- `approved`
- `rejected`
- `withdrawn`

### Activation Stop

An activation stop is one planned activation at one park.

Fields:

- `id`
- `routeId`
- `eventId`
- `parkReference`
- `plannedDate`
- `startTime`
- `endTime`
- `bands`
- `modes`
- `publicNotes`
- `organizerNotes`
- `status`
- `createdAt`
- `updatedAt`
- `cancelledAt`
- `cancelReason`

Stop statuses:

- `pending-review`
- `scheduled`
- `delayed`
- `cancelled`
- `completed`

The model must allow:

- Multiple activators for one park.
- Multiple stops for one activator.
- Multiple days or time windows for one park.
- Overlapping activations at the same park.
- Backup activations.
- Cancellations without deleting history.

## Public Submission Flow

Anyone can submit a proposed activation route.

Required fields:

- Callsign
- Name
- Email
- At least one activation stop
- Park reference per stop
- Planned date per stop
- Start and end time per stop
- Bands per stop
- Modes per stop

Optional fields:

- Club or group
- Phone, visible only to organizers
- Backup window or flexibility
- Access or portable constraints
- Nearby parks the activator can also cover
- Public notes to hunters
- Organizer-only notes

Frequency is intentionally not required. Frequencies are too dependent on band
conditions and availability at activation time. The public schedule should
point hunters to normal POTA spotting for live frequencies.

Spam controls:

- Cloudflare Turnstile on public forms.
- Server-side Turnstile verification before accepting a submission.
- Strict validation of callsign, email, park references, dates, and time
  windows.
- Rate limiting and duplicate detection for repeated submissions.
- Moderation before any submission appears in public JSON.

## Organizer Workflow

The organizer dashboard should provide:

- Pending submissions queue.
- Route detail view with all stops.
- Approve, reject, edit, and merge actions.
- Coverage overview for all 61 parks.
- Cancellation and coverage-gap alerts.
- Manual public JSON rebuild action.
- Audit history for organizer actions.

Approval is the editorial decision. Publishing should normally be automatic.
When an organizer approves a route or stop, the public data should regenerate
without requiring a separate publish step.

Manual rebuild is still required as an operational escape hatch in case a JSON
file needs to be regenerated from D1.

## Activator Self-Service

After initial approval, activators should be trusted to update routine schedule
details through their magic edit link.

Allowed direct edits:

- Start and end time.
- Bands.
- Modes.
- Public notes.
- Organizer-only notes.
- Delay status.
- Completed status.
- Post-event log upload.

Cancellation:

- Activators can cancel a specific stop.
- Cancellation updates D1 immediately.
- Public data regenerates automatically.
- The affected park returns to a coverage-gap state if no other scheduled stop
  covers it.
- Organizer dashboard surfaces the gap prominently.

Cancellation is a high-priority signal because the event goal depends on full
park coverage. Email or SMS alerts can be added later, but Phase 1 only needs
the dashboard and public coverage state.

## Public Pages

### Landing Page

The event landing page should introduce:

- "Activate All RI 2026"
- Main dates: September 11-13, 2026
- Optional soft start: September 10, 2026
- Goal: cover all 61 Rhode Island POTA parks
- Primary and secondary CTAs based on event phase
- Coverage snapshot, such as `X / 61 parks scheduled`
- Map-based visual overview
- Links to volunteer, schedule, parks, hunters, and awards pages

The landing page should preserve the community-site disclaimer and point users
to official POTA resources where appropriate.

### Volunteer Page

The volunteer page hosts the public route submission form and explains what
activators are committing to provide: park, date, time window, bands, modes,
and follow-up edits if plans change.

### By-Park View

The by-park view is optimized for coverage.

It should show one row or card per RI reference with:

- Park reference and name.
- Coverage status.
- Scheduled activation windows.
- Activator callsigns.
- Bands and modes.
- Cancellation or backup status.

This is the primary view for finding gaps and deciding where to volunteer.

### By-Schedule View

The by-schedule view is optimized for hunters.

It should group stops by:

- Date.
- Time window.
- Park.
- Activator.
- Bands.
- Modes.
- Status.

Useful filters:

- Day.
- Band.
- Mode.
- County or region.
- Missing-only once hunter progress data is loaded.

### Map

The map is a landing-page and discovery layer, not the primary schedule UI.

It should use the existing RI map concept and upgrade it with the checked-in
GeoJSON boundary data. It should summarize coverage state visually. Clicking a
park should open a compact card with:

- Park name and reference.
- Coverage status.
- Next scheduled activation.
- All scheduled activation windows.
- Bands and modes.
- Activator callsigns.
- Link to the park or schedule view.

"Currently active" styling should not appear unless backed by real POTA spot
data. Schedule windows can be labeled as scheduled, but they must not be
represented as live activity.

## Public JSON

Generated public files should include:

- `event.json`
- `parks.json`
- `schedule.json`
- `coverage.json`
- `awards-summary.json` when Phase 2 exists

Public JSON should include only approved, public-safe data. It must not include:

- Email addresses.
- Phone numbers.
- Organizer-only notes.
- Edit tokens.
- Raw uploaded logs.
- Private audit history.

Public JSON should regenerate automatically after:

- Route approval.
- Approved route edits.
- Stop cancellation.
- Organizer edits.
- Manual rebuild.

## Hunter Progress

The hunter tracker should focus on all-time Rhode Island progress.

Input modes:

- Official POTA hunted-parks CSV import.
- Manual checklist fallback.

Output:

- `worked / 61` progress.
- Worked parks.
- Missing parks.
- Missing parks with scheduled event opportunities.
- Optional local-only saved checklist.

CSV parsing should happen client-side unless the hunter submits a recognition
claim. This avoids storing personal log data for ordinary tracking.

The tracker should clearly distinguish:

- Official POTA all-time hunted status.
- Local manual planning notes.
- Community recognition claims.

## Awards

There are two separate recognition tracks.

### RI All-Parks Hunter Recognition

The hunter uploads or imports their POTA hunted-parks CSV. The site checks
whether all 61 RI references are present. If complete, they can submit a claim
through the website.

This proves all-time RI completion, not event-weekend completion.

### Activate All RI 2026 Weekend Sweep

Participating activators upload logs or ADIF summaries after the event.
Organizers aggregate event QSOs by hunter callsign and park reference. A
hunter qualifies only if their callsign appears for all 61 RI references during
the event window.

This is stronger than an honor-system claim but operationally heavier, so it
belongs in Phase 2.

## Error Handling and Edge Cases

- Invalid park references should be rejected during submission.
- Time windows must be valid and shown in the event timezone.
- If Turnstile verification fails, the submission should not be stored.
- If public JSON regeneration fails after an admin action, the dashboard should
  show the last publish error and offer manual rebuild.
- If an activator cancels the only scheduled stop for a park, the coverage view
  must show the park as needing replacement.
- If POTA spot integration is unavailable, live state should be omitted rather
  than guessed.
- If a magic edit token is lost, organizers can resend or rotate it.

## Testing

Utility code and data transforms should use Vitest-style tests.

Phase 1 test coverage should include:

- Route and stop validation.
- Coverage derivation from approved stops.
- Public JSON export removes private fields.
- Cancellation creates the correct coverage state.
- Event phase CTA selection.
- Park reference joins against RI reference data.
- Magic-token authorization boundaries.

Phase 1.5 test coverage should include:

- POTA CSV parsing.
- RI reference matching.
- Missing-park derivation.
- Manual checklist persistence helpers.

Phase 2 test coverage should include:

- Award claim validation.
- ADIF/log parsing.
- Weekend-window filtering.
- Callsign normalization.
- Recognition eligibility derivation.

## Open Decisions

- Whether to integrate real POTA spots for live status.
- Whether R2 is needed for raw uploads in Phase 2 or whether D1 plus short-lived
  processing is sufficient.
- Whether post-event certificates are generated on-site, emailed, or manually
  issued.
- Whether cancellation alerts need email or SMS after Phase 1.

These decisions do not block Phase 1.
