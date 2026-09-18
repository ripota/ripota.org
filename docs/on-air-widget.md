# Evergreen on-air widget

The setup page is `/widgets/on-air/`, linked from `/on-air/`. The generator requires
a callsign, trims whitespace, uppercases it, and produces a responsive, 420px-high
QRZ iframe. This is an attribution label, not verified identity or a spot filter.
Letters, numbers, and slash-separated portable prefixes/suffixes are accepted, up
to 32 characters. Slashes are encoded within a single path segment.

For signed-in accounts, the generator prefills the saved community callsign,
falling back to the activator callsign proposal when no community callsign is saved.
The field remains editable, and a delayed profile response never replaces user
input. With no saved callsign, it stays empty without example placeholder text;
Generate remains disabled until a usable callsign is entered. Profile loading
does not generate a widget or add account details to the page URL.

- `/embed/on-air/K1NW/`: attributed widget.
- `/embed/on-air/K1NW%2FP/`: portable callsign example.
- `/embed/on-air/`: generic widget, still usable directly.

All variants use the shared RI POTA snapshot and display all current spots,
independent of event dates and registration. The list scrolls within the iframe.
The script-free document refreshes every 60 seconds, including quiet and
unavailable states. Delayed snapshots are labeled explicitly; the shared snapshot
service expires old reports and limits stale fallback. The event widget is separate.

## Attribution

Worker logs emit JSON entries with `event: "on-air-widget"`, an `embedder` label
(normalized callsign or `generic`), and one of these `action` values:

- `load`: initial embed request.
- `refresh`: automatic request to the same embed path with `?refresh=1`.
- `click`: request to `?visit=1`, which redirects to the fixed `/on-air/` destination
  with `utm_source=qrz`, `utm_medium=widget`, `utm_campaign=ri-on-air`, and the
  embedder in `utm_content`.

The Worker also increments `analytics_widget_daily` in D1 by UTC date, `on-air`
scope, embedder, and action. Successful D1 writes are optionally mirrored into
the existing `ripota_usage` Analytics Engine dataset as the `widget` stream.
Recording runs through `waitUntil`; a storage or mirror failure is logged and
does not prevent rendering or redirecting. Counts represent recorded requests,
**not unique visitors**, verified installations, or successful renders; bots,
manual loads, copied URLs, and storage failures can affect them. `click` measures
only the Full on-air view link, not park links or official POTA links.

No cookies or viewer identifiers are added to the iframe. Requests carrying
`Sec-GPC: 1` or `DNT: 1`, and read-only production-data development requests, are
excluded. The totals have no automatic purge and are independent of AARI's archive
schedule. Full D1 recovery backups include them; the scoped AARI evidence export
does not. Existing short-lived Worker logs are not backfilled into the counters.

Generator previews use `?preview=1` and carry that flag through refreshes and
clicks. Preview requests and HEAD probes do not emit widget analytics entries.
The copied embed code never includes the preview flag.

The generator records `widget_generated` after valid generation and
`widget_code_copied` only after clipboard success through the existing anonymous
collector. No callsign, account ID, or generated URL is sent with those events.
Manual copying cannot be observed. The client respects GPC/DNT and uses a separate
`on-air` browser subject with a 90-day lifetime.

## Reporting

```bash
mise run analytics:widgets -- --since 2026-09-18 --until 2026-10-01
mise run analytics:widgets -- --json
```

The report uses durable D1 data and shows daily loads, refreshes, and clicks by
embedder, generator actions, and collection start times. Defaults cover the last
30 UTC dates including today. Windows are `[since, until)` and accept whole dates
only; today's totals are partial. No Analytics Engine access is required to run
this report, and its overlapping mirror counts must not be added to D1 totals.
