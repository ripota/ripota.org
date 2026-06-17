# Activate RI 2026 Park Row Volunteer CTA Design

## Summary

Add a row-level volunteer CTA to the Activate All RI 2026 park coverage table
for parks that still need help. The CTA should appear only when a park is
uncovered or needs a replacement, keeping the table focused on coverage gaps
instead of adding a repeated action to every row.

The CTA links to the volunteer form with the selected park reference in the
URL. The volunteer form reads that reference on load and preselects the park in
the first available activation stop, matching the existing map-to-form behavior.

## Goals

- Make it obvious how an activator can claim an uncovered park from the parks
  coverage page.
- Avoid visual noise on parks that already have scheduled coverage.
- Preserve the dense table layout and existing filters.
- Reuse the volunteer form as the single signup path.
- Prefill the selected park when the CTA target is opened.

## Non-Goals

- Do not reserve or claim a park before the activator submits the volunteer
  form.
- Do not add a separate per-park signup flow.
- Do not add CTA buttons to scheduled or completed parks.
- Do not change organizer review or approval behavior.

## Row CTA Behavior

The parks coverage table should use the selected Option C treatment:

- For `uncovered` rows, show a compact `Volunteer` action in the status cell.
- For `cancelled-needs-replacement` rows, show the same action because those
  parks need new coverage.
- For `scheduled`, `multiple-scheduled`, and `completed` rows, do not show the
  row action.

The action should link to:

```text
/activate-ri-2026/volunteer/?park=US-XXXX
```

where `US-XXXX` is the park reference for that row.

## Volunteer Form Prefill

On `/activate-ri-2026/volunteer/`, the existing volunteer form script should
read the `park` query parameter after stop cards are initialized. If the value
matches a known Rhode Island POTA reference, the form should select that park in
the first empty stop card and move focus to the date field, using the same
selection path as the reference map's `activate-ri:add-park` event.

Invalid or missing `park` parameters should be ignored without showing an
error. This keeps copied or stale links from blocking normal form use.

## Components

- `ParkCoverageTable.astro` renders the row action in both the static fallback
  rows and live-rendered rows.
- `VolunteerForm.astro` reads the URL parameter and reuses the existing
  `addParkReferenceToForm` helper.
- Global styles may add a compact table-action class if the existing `.button`
  size is too large inside table cells.

## Data Flow

The row action carries only a public POTA reference. The volunteer form remains
the only place where activator identity, schedule, bands, modes, and notes are
submitted. The API continues validating the final submitted plan.

## Error Handling

- If live coverage fails to load, the unavailable state remains unchanged.
- If a row has no actionable coverage state, no CTA is rendered.
- If the query parameter is unknown, the form behaves as if no parameter was
  provided.

## Testing

Use focused tests or build verification for the low-risk UI change:

- The project should build successfully.
- Existing Activate RI utility tests should continue to pass.
- Manual verification should confirm that an uncovered park row links to the
  volunteer form and preselects that park.
