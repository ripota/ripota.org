# Activate RI 2026 Reference Map Design

## Goal

Add a richer Rhode Island POTA reference map that helps visitors understand
where references are, helps Activate All RI 2026 participants see coverage
gaps, and lets volunteers start an activation stop directly from the map. The
map should reuse the existing reference data, the reviewed local GeoJSON
boundary inventory, and the public event schedule data.

## Current State

The homepage uses `ResourceMapPreview` to render a Leaflet map with one circle
marker per Rhode Island POTA reference. The popup shows the reference, park
name, grid, location description, and official POTA link.

The repository already contains reviewed boundary metadata in
`src/data/ri-reference-boundaries.json` and per-reference GeoJSON files under
`src/data/boundaries/`. Some references have full boundaries or activation
zones, while a smaller set is point-only or still needs research.

Activate All RI 2026 pages already derive public coverage from
`public/data/activate-ri-2026/parks.json` and
`public/data/activate-ri-2026/schedule.json`, then refresh live schedule data
from `/api/activate-ri-2026/public/stops`. The volunteer form can clone stop
cards and stores each selected park as a POTA reference.

## Recommended Approach

Create one shared Leaflet map component that renders Rhode Island references
with page-specific behavior:

- `home`: evergreen reference discovery.
- `coverage`: Activate RI coverage status and schedule details.
- `volunteer`: coverage status plus a form action to add a stop.

This keeps map rendering, boundary loading, point fallback behavior, fit bounds,
status colors, and popup formatting in one place. Each page should pass only the
variant-specific copy and actions it needs.

## Map Geometry

Use the local GeoJSON boundary inventory first:

- Render `available` boundary and activation-zone records as GeoJSON layers.
- Render `point-only` records as point markers.
- Render `research-needed` records from the existing reference latitude and
  longitude if coordinates are available.
- Keep all popups tied to the POTA reference record so every visible layer has
  a consistent title, reference, counties, grid/location metadata, and official
  POTA link where available.

Boundary layers should remain visually readable at Rhode Island scale. The
component will render a small centroid marker for every reference in addition
to any boundary or activation-zone layer, so small parks and thin trail zones
remain easy to discover and click.

## Home Page Behavior

Replace the point-only homepage map with the shared `home` variant.

The homepage popup should stay evergreen and reference-focused:

- Reference and park name.
- County, grid, or location detail when available.
- A short note that reference data comes from official POTA park data and local
  public boundary sources.
- Link to the official POTA park page.

No Activate RI event copy belongs in the homepage popup.

## Activate RI Overview Behavior

Add the shared map to `/activate-ri-2026/` near the coverage summary. It should
support a quick statewide coverage scan before users go to the full park table.

The overview map must be phase-aware. During the current planning phase, its
primary job is to help volunteers find coverage gaps. As the event gets closer,
the same map should be able to shift emphasis toward hunters by highlighting
where and when activators plan to operate. This design should keep that shift
to copy, legend, color emphasis, popup ordering, or variant configuration rather
than requiring a different map implementation.

Color references by derived coverage status:

- `uncovered`: needs coverage.
- `scheduled`: one planned active stop.
- `multiple-scheduled`: multiple planned active stops.
- `cancelled-needs-replacement`: previously planned but currently needs
  replacement.
- `completed`: completed event stop.

The popup should show:

- Reference and park name.
- Coverage status label.
- For scheduled or completed stops: activator callsign, date, time block,
  modes, bands, and public notes when present.
- For uncovered parks: a clear "Needs coverage" message.
- Links to the park coverage page and the volunteer page.

The map should refresh from `/api/activate-ri-2026/public/stops` using the same
public schedule semantics as the existing tables. Static JSON remains the
initial render fallback.

## Volunteer Page Behavior

Add the shared map to `/activate-ri-2026/volunteer/` above the volunteer form,
after the short "Before you submit" guidance.

The volunteer popup should use the same coverage details as the overview popup
and add an `Add activation` action. Clicking that action should immediately
update the current form:

- If an existing activation stop has no selected park, fill that stop.
- Otherwise clone a new stop and fill it.
- Set the visible park combobox label and hidden POTA reference value.
- Keep date, time block, bands, modes, and notes empty so the volunteer chooses
  the actual plan details.
- Scroll to the filled stop and focus the date field or next required field.
- Show a small status message near the form confirming the park was added.

The action only edits the local form. It does not submit the plan, reserve a
park, or guarantee coverage.

## Component Boundaries

Add a reusable map component for rendering and page wiring. Keep utility logic
separate enough to test without a browser:

- A data helper that combines POTA references, boundary metadata, and event park
  summaries by reference.
- A coverage helper or adapter that maps public stops into map status and popup
  rows.
- A browser-side map initializer for Leaflet rendering and popup actions.
- A small volunteer-form hook that exposes "add this park reference to the
  first empty stop or append a stop" behavior.

Do not duplicate the public schedule table logic. The map should reuse
`deriveParkCoverage` and the existing public stop status semantics, with shared
status labels exported from one helper if implementation needs labels in both
the table and map.

## Accessibility

The map should not be the only way to inspect or choose parks. The coverage
table and form combobox remain the accessible, text-first paths.

Map requirements:

- Provide an accessible label and caption describing the map purpose.
- Keep popup buttons keyboard reachable.
- Ensure status colors have text labels in popups and a visible legend near the
  map.
- Avoid relying on color alone to communicate coverage.
- Preserve existing official POTA source-of-truth disclaimers.

## Testing And Verification

- Add Vitest coverage for data joining and status-to-map-state helpers.
- Run the project check task after implementation.
- Verify the homepage, Activate RI overview, and volunteer page build.
- Manually test desktop and mobile map sizing.
- Manually test popup keyboard navigation.
- On the volunteer page, click `Add activation` for an uncovered park and for a
  scheduled park, then confirm the correct stop card is filled or appended.
- Confirm live public stops update the map without breaking the static fallback.

## Out Of Scope

- Changing activation submission validation or approval rules.
- Adding route optimization or multi-stop itinerary planning.
- Replacing the park coverage table or schedule table.
- Editing the boundary research dataset beyond what is necessary to render it.
- Submitting a plan directly from the map popup.
