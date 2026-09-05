# Requested-parks agenda

Implements [issue #5](https://github.com/ripota/ripota.org/issues/5) using the existing hunter and schedule pages.

## Using it

- Start a blank hunter checklist, import an official Hunted Parks CSV, or paste the RI park references you want to hunt.
- A blank checklist starts with all parks remaining. Existing saved imports and manual choices are preserved.
- Pasted references accept spaces, commas, semicolons, and mixed case. Invalid and unknown references must be corrected before opening an agenda.
- Use **Share agenda** on the schedule to create a link containing the requested parks and current filters. The link works in another browser without a saved checklist. If clipboard access is unavailable, select and copy the displayed URL.
- **Print filtered schedule** uses the selected time zone and current filters. The printout identifies when the schedule was loaded and when the printout was prepared.

## Product decisions

Input uses checklist selection and pasted references. The export is a portable URL, with the existing browser print/PDF action retained. Calendar files and notifications are outside this implementation.

The agenda uses only this site's public event stops. Every result and printout is a planned estimate; POTA spots and HamAlert remain the places to check current activity. Shared links load the latest published plans when opened, so they are not frozen copies of a schedule.

Requested references use the `parks` query parameter. An explicitly empty `parks=` requests zero parks. A malformed or unknown reference never silently widens the agenda. The local `scope=remaining` view is converted into an explicit requested list only when the user chooses to share it. Starting or resetting a blank checklist does not invent a POTA import date.

## State handling

- Multiple matching windows remain visible and sort by actual UTC start, then park, callsign, and stop ID.
- Delayed and completed windows retain their status. Cancelled windows are omitted; parks with only cancelled windows appear under **Not currently scheduled** with that explanation.
- Parks with no published window remain in the requested list and printout. Other active filters can produce zero matches without removing those requests.
- Unavailable data is shown as unavailable, with printing and sharing disabled. The URL retains its requested parks and filters for reload.
- A filter whose current options disappeared remains selected. Cancellation or an outage cannot silently broaden a shared agenda.
- A view left open for five minutes warns that it is old. Printouts include the loaded-time warning. Overnight ranges show **(+1 day)** only when they cross midnight in the selected time zone.

## Data and exports

There is no new D1 storage. Checklist state stays in the browser. Shared URLs contain only requested reference IDs and the allowlisted public schedule filters; unrelated query parameters, credentials, and fragments are excluded.

Printouts include park, date, time, public activator name/callsign, bands, modes, and status. Popover notes and its other links are excluded from printing, even when the popover was open. The unofficial-site notice and planned-estimate warning remain visible.

## Verification

Unit tests cover normalization, catalog validation, deduplication, public stop joins, deterministic UTC sorting, safe URL construction, blank-checklist compatibility, and midnight conversions.

Browser tests cover input, sharing into a fresh browser, zero requested parks, invalid references, unmatched and cancelled windows, unavailable data, stale views, missing filter options, clipboard fallback, and preserved checklist data.

The PDF regression generates actual Letter and A4 landscape PDFs for long, overnight, requested, empty, and unmatched schedules. It parses page geometry and text to verify margins, repeated table headers, readable callsigns, intact rows, overnight date cues, and absence of note/contact data. Rendered page images are also reviewed for layout and print contrast.

September 5 validation: Astro check reports zero errors, warnings, or hints. All 603 unit tests, 33 event browser tests (including the two focused PDF tests), and 34 desktop/mobile public-site tests pass. Ten Letter/A4 PDFs were generated; all 18 rendered pages were visually inspected. Hunter input and requested-agenda views were checked at 390 pixels and for horizontal overflow at 320 pixels.

Publication and issue closure follow the signed push, deployment, and production verification.
