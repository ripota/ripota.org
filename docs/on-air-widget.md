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

Filter those structured entries in Workers Logs and group by embedder/action.
These are request counts, **not unique visitors**; bots, manual loads, and copied
URLs can affect them. No cookies or viewer identifiers are added, and these events
are not stored in the event-specific analytics archive. Retention follows Workers
Logs configuration.

Generator previews use `?preview=1` and carry that flag through refreshes and
clicks. Preview requests and HEAD probes do not emit widget analytics entries.
The copied embed code never includes the preview flag.
