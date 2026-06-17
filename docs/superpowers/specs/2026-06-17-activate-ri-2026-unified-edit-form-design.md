# Activate RI 2026 Unified Edit Form Design

## Goal

Make the private activator edit page use the same form fields, controls, and visual treatment as the public volunteer signup page.

## Scope

The public volunteer page and private edit page should share the same core form surface:

- Callsign, name, email, and club affiliation.
- Activation stop cards with park search, date, time block, bands, modes, and public notes.
- Organizer notes.
- Required-field indicators, help text, and validation feedback styling.
- Cloudflare Turnstile for state-changing submissions.

The private edit page should also include the same reference map experience as the volunteer page so activators can add parks from the map while editing an existing plan.

The edit page should not include the edit-link resend form because the user reached it from an edit link already.

## Approach

Extract the shared form markup for identity fields and stop cards into small Astro components used by both `VolunteerForm.astro` and `ActivatorEditForm.astro`. Keep submission behavior separate because the public form posts a new plan, while the edit form loads existing plans and patches a selected plan.

The edit form will convert the selected three-hour time block into `startTime` and `endTime` for the existing edit API. This keeps the backend storage and validation model unchanged while presenting the same user-facing fields in both places.

## Edit Behavior

The edit form will:

- Load plans from the private token endpoint.
- Render a plan picker when the edit link manages multiple plans.
- Populate the shared controls from the selected plan.
- Preserve stop IDs in hidden fields for PATCH saves.
- Submit `turnstileToken` with PATCH saves.
- Submit `turnstileToken` with cancellation requests.
- Reset Turnstile after failed or successful state-changing requests.
- Keep edit-specific actions: add another park, cancel plan, and save changes.

## Page Layout

The volunteer page keeps its current guidance, map, volunteer form, after-submit guidance, and edit-link resend form.

The edit page keeps its private-link header, adds the same `ReferenceMap` used by the volunteer page, renders the unified edit form, and omits edit-link resend content.

## Testing

Tests should verify:

- The edit form includes the same required-field note and compact required markers as the volunteer form.
- The edit form uses the same park combobox, band multi-select, mode multi-select, public notes, and organizer notes controls.
- The edit form includes Turnstile.
- The edit page includes `ReferenceMap`.
- The edit form script derives `startTime` and `endTime` from selected time blocks for PATCH payloads.
- The edit form submits `turnstileToken` for PATCH and cancel requests.

## Out Of Scope

- Changing the Activate RI database schema.
- Changing public schedule rendering.
- Changing the edit-link resend workflow on the volunteer page.
- Adding custom start/end time fields to the public form.
