# Activate RI 2026 Signup and Listing Review Design

## Summary

This design updates the Activate All RI 2026 activator signup and public
schedule/parks listings based on review feedback. It keeps the existing route
and stop model, but makes the volunteer form support real event planning:
multiple parks per submission, fixed three-hour activation blocks, searchable
park selection, county-aware park metadata, and clearer private organizer data
collection.

The public listings remain table-based for density. They gain compact filters
and clearer activation display text, including merged activator and mode
labels such as `N1RWJ (CW, SSB)`.

## Goals

- Let one activator submit a route covering multiple parks.
- Replace freeform start/end entry in public signup with event-defined
  three-hour time blocks.
- Keep `Club / group affiliation` for organizer data gathering while keeping
  it private for now.
- Improve the signup form hierarchy so the top fields form a balanced identity
  grid.
- Add searchable park selection for volunteers.
- Add county metadata and use it for park discovery and filtering.
- Show modes directly in schedule and park listings.
- Add mode, band, timeline, and county filters to public schedule and park
  coverage views.
- Preserve the existing public privacy boundary: no email, phone, edit token,
  organizer notes, or private affiliation data in public JSON.

## Non-Goals

- Do not add public club/group display in this pass.
- Do not introduce custom regions yet.
- Do not add block-level timeline filtering in the first listing update.
- Do not replace the schedule and parks pages with card-only layouts.
- Do not add real-time POTA spot integration.
- Do not change official POTA source-of-truth positioning.

## Signup Form Design

The signup form uses a compact multi-stop pattern. One submission represents
one activator route and contains one or more stop cards.

The top identity area is a balanced two-by-two grid:

- Callsign
- Name
- Email
- `Club / group affiliation` optional

`Club / group affiliation` is stored with the route for organizer planning and
future analysis. It is private in this phase and must not be exported to public
JSON or rendered on public schedule or park coverage pages.

Each activation stop card contains:

- Searchable park selector.
- Planned date.
- Required three-hour block.
- Bands.
- Modes.
- Public notes for hunters.
- Add and remove controls for additional stops.

The volunteer page copy should say that one submission can cover one park or a
multi-park route. It should continue to avoid frequency collection and should
point activators to normal POTA spotting when an activation begins.

## Three-Hour Blocks

The form presents block choices instead of freeform `startTime` and `endTime`
inputs. Internally, the API and public JSON may continue storing normalized
`startTime` and `endTime` strings so existing schedule and coverage code can
keep a stable shape.

Initial block choices:

- `06:00-09:00`
- `09:00-12:00`
- `12:00-15:00`
- `15:00-18:00`
- `18:00-21:00`

The block list applies to each event date. If organizers later need custom
windows, that can be handled as an admin/edit capability without exposing
freeform time fields in the public signup form.

## Park Metadata

The project should add county metadata to Rhode Island POTA references.
Counties are the first grouping mechanism because they are stable and useful
for filtering. Custom regions are intentionally deferred.

County should be available to:

- The searchable signup park selector.
- The public parks data file.
- Schedule and parks page filter options.
- Display text where extra park context helps disambiguation.

Park selector option text should include enough context for fast filtering,
such as reference, park name, and county.

## Public Listing Design

The schedule and parks pages keep table-based layouts with a compact filter
bar above each table.

Initial filters:

- Mode.
- Band.
- Timeline.
- County.

Timeline values:

- `All dates`
- `Soft start`
- `Main event`
- `Thu Sep 10`
- `Fri Sep 11`
- `Sat Sep 12`
- `Sun Sep 13`

Block-level filtering is deferred until the first filter pass is in place.

The schedule page remains optimized for hunters scanning activation windows.
The activator column should merge callsign and modes:

- `N1RWJ (CW, SSB)`
- `K1ABC (SSB)`
- `W1XYZ (FT8)`

Bands remain their own column so hunters can filter and scan bands separately.

The parks page remains optimized for coverage. It should show all scheduled
windows for each park instead of only the next stop. Each window should include
date, block or time range, activator/modes, bands, and status. This lets
organizers and volunteers see backups, overlaps, and gaps without switching to
the schedule page.

## Data Flow

The client form converts each selected block into normalized `startTime` and
`endTime` values before submission, or submits a block identifier that the API
normalizes. The API must remain the authority for validation; client-side
conversion is only a convenience.

Validation must ensure:

- At least one stop is present.
- Multiple stops are accepted.
- Each stop uses a known Rhode Island POTA reference.
- Each stop uses an event date.
- Each stop uses an allowed three-hour block.
- Each stop has at least one band and one mode.
- Public notes and organizer data remain text fields.

Public export must include county where needed for filtering and display, but
must exclude private route fields including affiliation.

## Error Handling and Edge Cases

- If JavaScript is available, the form should add/remove stop cards without a
  page reload and submit JSON as it does today.
- If a selected park is later removed or invalid, server validation rejects the
  stop with a clear per-stop error.
- If an activator submits the same park in multiple blocks, the submission is
  valid because split-day activation plans are allowed.
- If multiple activators submit the same park and block, the submission is
  valid; organizer moderation decides whether overlap is useful.
- If the county metadata is missing for a park, the UI should still show the
  park and place it under an `Unknown county` filter value only when necessary.
- If filters remove all rows, the listings should show a concise empty state
  instead of an empty table body.

## Testing

Utility and data-transform changes should use Vitest-style tests.

Coverage should include:

- Three-hour block normalization to `startTime` and `endTime`.
- Rejection of invalid block values.
- Multi-stop route submission validation.
- Public export omits `Club / group affiliation`.
- Public park summaries include county metadata.
- Listing filter helpers for mode, band, timeline, and county.
- Merged activator/modes display formatting.
- Park coverage derivation still handles multiple scheduled stops per park.

## Implementation Notes

This change should fit the existing Phase 1 architecture:

- Astro renders the form and public listing shells.
- The Worker API continues accepting route submissions.
- D1 remains the source for pending and approved route data.
- Generated public JSON remains the read path for public listing pages.

The implementation should prefer small helpers for block normalization and
filter derivation so validation, export, and UI code do not duplicate event
date or time-block rules.
