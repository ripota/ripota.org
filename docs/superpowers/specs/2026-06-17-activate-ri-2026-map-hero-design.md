# Activate RI 2026 Map Hero Design

## Goal

Refresh the `/activate-ri-2026/` landing page hero so the planning-phase page
feels more energetic and recruiting-focused. The new hero should combine the
poster-like wording from the first visual concept with the existing coverage
map, live coverage stats, and direct volunteer actions.

The page should immediately communicate the community challenge: cover all 61
Rhode Island POTA references during one coordinated weekend. It should also
make the next action obvious while the event is in activator-recruiting mode:
volunteer to activate one park or submit a multi-park route.

## Current State

`src/pages/activate-ri-2026/index.astro` renders `EventHero` first, followed by
an overview section containing `EventNav`, activator guidance, a coverage plan
header, `CoverageSummary`, and a large `ReferenceMap`.

`EventHero` currently renders a simple text-only hero on a green brand
background with one radial accent. It has the correct event data and CTAs, but
the first viewport does not show the coverage mission, current progress, or a
strong event identity.

The existing `ReferenceMap` component already renders the coverage map from
local park and schedule data, refreshes live public stops for event variants,
supports a volunteer phase focus, and disables scroll-wheel zoom.

## Recommended Approach

Move the coverage map entirely into the hero and convert the lower overview
section into a recruiting action area.

The hero should use a two-column layout on desktop and a stacked layout on
mobile:

- Left column: event date, bold event headline, short recruiting copy, live
  coverage stats, and CTAs.
- Right column: the existing interactive coverage map in a hero-friendly frame.

The section below the hero should retain the page navigation, activator guide,
and overview copy, but replace the current large map with a full-width volunteer
CTA band. This avoids showing the same map twice and keeps the page focused on
recruiting activators.

## Hero Content

The hero copy should keep the stronger poster-style language from the approved
visual direction:

- Eyebrow: formatted event date range, currently `September 11-13, 2026`.
- Headline: `Activate All RI`.
- Body: explain that the Rhode Island POTA community is trying to cover all 61
  Rhode Island references during one coordinated weekend, with the soft start
  planned for September 10.
- Primary CTA: current planning-phase primary CTA from event data, currently
  `Volunteer to activate`.
- Secondary CTA: current planning-phase secondary CTA from event data, currently
  `See the schedule`.

The page can continue using `activateRi2026Event` for dates, goal count, phase,
and CTA URLs so the hero remains phase-aware.

## Hero Coverage Stats

During the planning phase, the hero should show compact coverage stats before
or near the primary actions:

- `Parks scheduled`: scheduled parks over total event parks.
- `Coverage gaps`: uncovered parks plus parks that need replacement.

These values should use the same semantics as the existing `CoverageSummary`
component: ignore sample stops, call `deriveParkCoverage`, count scheduled,
multiple-scheduled, and completed parks as scheduled, and count uncovered plus
cancelled-needs-replacement parks as gaps.

Extract the count derivation into a small shared helper so `EventHero` and any
future summary display can use the same scheduled and gap semantics. Avoid
duplicating count logic in unrelated components.

## Hero Map

The right side of the hero should render `ReferenceMap` with the existing event
coverage behavior:

- `variant="coverage"`.
- `phaseFocus="volunteer"`.
- A hero-specific title and caption.
- `legendPlacement="overlay"` so the map stays compact inside the hero frame.

The map should feel integrated with the hero without losing usability:

- Use a stable responsive height so Leaflet initializes predictably.
- Preserve no scroll-wheel zoom.
- Preserve clickable markers, boundaries, popups, and live public stop refresh.
- Preserve text labels and captions so color is not the only coverage signal.

The hero map replaces the lower map on the page. There should not be a second
full coverage map later in the overview.

## Below-Hero CTA Band

After the existing overview copy, add a full-width recruiting CTA band where
the large map currently appears.

Recommended content:

- Heading: `Help fill the Rhode Island map`.
- Supporting copy: volunteers can submit one park or a multi-park route for
  organizer review.
- Primary button: `Volunteer to Activate`, linking to the event volunteer page.
- Secondary action: `See the schedule`, linking to the event schedule page.

The band should use the existing button styles and route helpers. It should
feel like a clear next step rather than another explanatory card grid.

Once hero stats exist, remove `CoverageSummary` from the lower overview section
to avoid repeating the same numbers.

## Component Boundaries

`EventHero.astro` should own the new hero layout. If the coverage count logic
needs to be shared, add a small helper or component prop rather than copying the
logic from `CoverageSummary`.

The lower CTA can be implemented as a small dedicated component, such as
`VolunteerCtaBand.astro`, if that keeps `index.astro` readable. Inline markup is
acceptable if the implementation stays short and unique to this page.

Do not change volunteer submission validation, schedule semantics, map popup
behavior, or official POTA source-of-truth language as part of this visual
refresh.

## Responsive Behavior

Desktop and wider tablet:

- Hero uses two columns.
- Text, stats, and CTAs appear on the left.
- The map appears on the right with a stable height and visible legend/caption.

Mobile:

- Hero stacks in a single column: event text, stats, CTAs, then map.
- Map height remains fixed enough to be useful without dominating the whole
  first screen.
- Buttons wrap cleanly without text overflow.

The overview CTA band should remain full width, with its button row wrapping
cleanly on narrow screens.

## Accessibility

The map remains supplemental to text-first paths. Visitors can still use the
schedule, park list, and volunteer form without interacting with the map.

Requirements:

- Keep a meaningful accessible map title and caption.
- Keep legend labels visible.
- Keep popup controls keyboard reachable.
- Preserve the unofficial community coordination framing and official POTA
  source-of-truth disclaimers anywhere launch copy changes.
- Avoid relying on color alone for coverage state.

## Testing And Verification

- Run the project check task after implementation.
- Run relevant Vitest coverage if shared coverage-count logic is extracted or
  changed.
- Build the site locally.
- Verify `/activate-ri-2026/` on desktop and mobile widths.
- Confirm the hero map initializes with correct bounds and nonblank tiles.
- Confirm map popups still work after being moved into the hero.
- Confirm live public stop refresh still updates coverage styling.
- Confirm lower overview no longer renders a duplicate full map.
- Confirm CTA links route to the volunteer and schedule pages.

## Out Of Scope

- Changing event dates, phase logic, or CTA destination rules.
- Changing public schedule approval, validation, or API behavior.
- Redesigning the volunteer form.
- Replacing Leaflet or rebuilding the map data model.
- Adding new external imagery or official POTA branding.
