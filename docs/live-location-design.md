# Live Interactive Park Location

**Status:** Implemented on park detail pages and the statewide directory\
**Original design:** 2026-09-01\
**Implementation reviewed:** 2026-09-06\
**Primary surface:** Individual park field guides\
**Secondary surface:** `/parks/` statewide map

## Current implementation

Both surfaces render a blue dot and accuracy circle, classify against detailed
canonical geometry, and show accessible text results. **Show my location**
starts a session; **Exit location mode** stops it. Directory results link to
detail pages while preserving the location-mode navigation context.

The main differences from the original proposal are:

- Maps initially embed simplified web geometry for rendering. Classification
  fetches canonical detailed geometry from `/data/parks/3.1.1/` only after a
  location fix. It never uses the simplified display geometry.
- Normal browsing starts without a location request. A URL with `location=1`
  or a saved directory return state starts location mode on arrival, including
  the deliberate directory → detail → Back flow. This is an exception to the
  original proposal's requirement for a new tap on every page.
- The directory saves map camera, browse camera, page scroll, and result-list
  scroll in browser history state. It does not store a geolocation fix,
  accuracy, or classification, but the saved camera center can reflect where
  the user was looking in location mode.
- The current UI expands the map and hides its normal hero card while location
  mode is active. Detail pages show a compact status tray; the directory shows
  **Mapped matches**, **Boundary uncertainty**, and **Closest parks**.
- The original inline privacy disclosure below remains suggested copy; the
  current map components do not render that disclosure or location telemetry.

The rest of this document records the interaction rationale, implemented
behavior, and remaining device-check/refinement guidance. See
[v3.1.1 adoption](parks-v311-adoption.md) for the geometry delivery contract.

## Interaction rationale

The explicit **Show my location** target control on each individual park page
shows:

- a standard blue location dot;
- a translucent accuracy circle using the browser-reported accuracy radius;
- a concise result: **Inside mapped boundary**, **Outside mapped boundary**,
  or **Near mapped boundary — location is uncertain**; and
- the current accuracy and a visible way to stop location updates.

The individual park page gives the result an unambiguous reference and has room
for source and rules caveats. `/parks/` reuses the same location session and
classification logic, with a discovery sheet listing mapped parks at or near
the current location.

The product must say **mapped boundary** or **mapped activation zone**, never
claim that a GPS fix proves a valid POTA activation. The local geometry is a
community-maintained, time-stamped planning aid. Official POTA resources,
managing agencies, posted signs, access rules, and station-placement rules
remain authoritative.

Location processing is client-side. RI POTA does not upload geolocation fixes
to its APIs or add them to URLs or analytics. The navigation state and normal
map-tile requests are described under Privacy and Security below.

## Why This Belongs in Both Places

### Individual park page: the decision surface

This is the clearest place to answer the field
question: “Does my reported position appear to be inside this mapped area?”

- The map already emphasizes one park geometry.
- A boundary, activation zone, or point-only limitation can be named directly.
- Same-geometry and possible multi-reference relationships are already known.
- The location code and Turf dependency can stay out of pages with no map.
- Only the current park and its related geometries need classification.

### All-parks map: the discovery surface

The map at the top of `/parks/` uses the same target control to answer:
“Which mapped parks am I in or near?”

After canonical geometry loads for the first location fix, its results show:

1. **Mapped matches** and **Boundary uncertainty** — definite and
   edge-uncertain matches in separate groups;
2. **Closest parks** — three distance-sorted results, expandable to eight; and
3. links to the individual field guides for the full map, geometry semantics,
   source, and caveat.

Do not make the all-parks map the only entry point. Operators commonly arrive
from a saved park URL, search result, event schedule, or POTA page.

## Current Foundation

The implementation uses:

- It is a static-first Astro site using Leaflet 1.9.4.
- `ParkDetailMap.astro` already renders one park plus related geometries.
- `ReferenceMap.astro` already renders the statewide set.
- `@ripota/parks` v3.1.1 provides EPSG:4326 GeoJSON web and canonical detailed
  geometry in the WGS84 coordinate system used by browser geolocation.
- The pinned catalog contains 60 boundaries and one derived trail activation
  zone. Point-only handling remains supported and covered by synthetic tests;
  no current catalog reference uses that fallback.

The geometry package deliberately warns that its data are not legal boundaries,
access determinations, navigation data, surveys, or official activation
validity decisions. That warning shapes the result language and uncertainty
model in this design.

The packaged canonical statewide aggregate is about 4.9 MB uncompressed and
728 KB with gzip. Initial maps embed only web geometry; the directory loads
the detailed `all.geojson` static resource when classification needs it.
Detail pages fetch only their own and related references' detailed files.
`public/_headers` gives versioned geometry a one-year immutable browser cache.

## Prior Art: POTAMAP.US

[POTAMAP.US](https://potamap.us/) inspired the target-control interaction.
Its public source, checked on 2026-09-06, shows that:

- an OpenLayers geolocation object tracks the device with high accuracy;
- the map renders a blue position point and an accuracy geometry; and
- the target control recenters the map on the most recent position.

Relevant source:

- [position and accuracy layer](https://github.com/cwhelchel/potamap.ol/blob/main/getGeolocationLayer.js)
- [target/recenter control](https://github.com/cwhelchel/potamap.ol/blob/main/controls/ZoomToPosControl.js)

That is a useful, recognizable interaction model. RI POTA should retain the
target metaphor and blue-dot convention, while improving four things for this
specific use case:

1. do not begin location tracking before the user asks;
2. give the target control an accessible label, not only an emoji and tooltip;
3. interpret the accuracy circle relative to the mapped edge; and
4. state the result in text rather than asking the user to judge overlapping
   shapes visually.

## Park-Page Interaction

### Placement

- Keep the target in the same bottom-right Leaflet control column as zoom,
  positioned above the zoom buttons.
- Use a minimum 44-by-44 CSS-pixel touch target.
- Keep the existing geometry key at the top-right.
- On mobile, show the result in a compact tray across the bottom of the map,
  above attribution and clear of the control column.
- On desktop, keep the narrower tray near the bottom-right, to the left of
  the location/zoom control column.
- Preserve **Recenter map** as the way to return to the park geometry.

Use the target/bullseye graphic as the visible icon if desired, but give the
button the accessible name **Show my location**. Emoji rendering varies by
platform and must not be the only semantic label.

### First tap

1. Change the control to a locating state.
2. Announce **Finding your location…** through a polite live region.
3. Ask the browser for geolocation permission.
4. On the first usable fix, draw the accuracy circle and blue dot.
5. Fit the reported position/accuracy circle and park geometry while leaving
   **Recenter map** available.
6. Load canonical geometry, then classify the location in the status tray.

Normal page loads do not ask for permission. The tap provides context before
the browser prompt. Location-mode URLs are the documented continuation path
and start a session on arrival.

### While active

- Continue updating the dot, accuracy circle, and result while the page is
  visible.
- Do not force the map camera to follow every update. If the user pans, the dot
  can keep moving while the camera stays put.
- A later target tap recenters on the latest fix.
- Keep a visible **Exit location mode** action while updates are active.
- Stop the watch when the user stops it, leaves the page, or the document is
  hidden. A normal visibility return requires another tap; the explicit
  location-mode navigation/Back flow starts a new session automatically.

This makes “live” useful without letting the map fight the user or keeping GPS
active invisibly in the background.

## Result Model

The browser reports an accuracy radius in meters. The
[Geolocation specification](https://www.w3.org/TR/geolocation/#accuracy-attribute)
defines that value at a 95% confidence level. The status should
use both the point and that radius rather than treating a single coordinate as
perfect.

For a polygon or multipolygon, calculate signed distance `d` from the reported
point to the nearest polygon edge, where negative means inside, positive means
outside, and zero is on the edge. Let `a` be the reported accuracy radius and
`e = 0.01 m` be the classifier's numerical tolerance.

| Condition    | Result                      | Meaning                                                                  |
| ------------ | --------------------------- | ------------------------------------------------------------------------ |
| `d < -(a + e)` | **Inside mapped boundary** | The reported accuracy circle is inside with room beyond the tolerance. |
| `d > a + e` | **Outside mapped boundary** | The reported accuracy circle is outside with room beyond the tolerance. |
| Otherwise | **Near mapped boundary** | The accuracy circle reaches or crosses the edge, including the tolerance. |

Always show `Accuracy ±N m`. The circle on the map and the text result must use
the same radius.

This model is intentionally conservative. It avoids a green “inside” result
when the center dot is barely over a line but the location uncertainty spans
both sides.

### Geometry-specific language

| Geometry kind   | Allowed result language                        | Additional behavior                                                                                     |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Boundary        | Inside/outside/near **mapped boundary**        | Normal signed-distance classification.                                                                  |
| Activation zone | Inside/outside/near **mapped activation zone** | Explain that the zone is derived from the reviewed trail rule and route snapshot.                       |
| Point only      | **No mapped boundary available**               | Show the blue dot and optional distance to the reference coordinate, but never classify inside/outside. |

Holes and disconnected multipolygon components must be honored. A point in a
polygon hole is outside. A point inside any component of a multipolygon is
inside that mapped geometry.

### Related and overlapping references

On a page with related geometries, classify the primary and every related
reference separately. Layer visibility toggles only change rendering; they do
not remove a related reference from classification.
If the location is definitely inside more than one mapped geometry, the tray
may say **Inside 2 mapped areas** and list both references. Keep the existing
possible multi-reference caution: a geometry overlap is not by itself proof
that an activation can be claimed for every reference.

## State and Copy Matrix

The target control becomes **Recenter on my location** after a fix. Current
controls use **Exit location mode** for the stop action and **Recenter map**
to show the park. Canonical loading adds neutral **Loading mapped boundaries…** and
**Mapped boundaries could not load** states; the location button retries a
failed geometry load without substituting simplified geometry.

| State                | Primary copy                                  | Secondary action                                 |
| -------------------- | --------------------------------------------- | ------------------------------------------------ |
| Idle                 | **Show my location**                          | None                                             |
| Requesting           | **Finding your location…**                    | Exit location mode                              |
| Definite inside      | **Inside mapped boundary**                    | Recenter on my location · Exit location mode     |
| Definite outside     | **Outside mapped boundary**                   | Recenter on my location · Recenter map · Exit location mode |
| Edge uncertain       | **Near mapped boundary**                      | “Your ±N m accuracy crosses the mapped edge.”    |
| Point-only park      | **No mapped boundary available**              | “This park has only a reference coordinate.”     |
| Permission denied    | **Location access is off**                    | “Enable it in browser settings, then try again.” |
| Position unavailable | **Your device could not get a location**      | Try again                                        |
| Timeout              | **Location took too long**                    | “Move to an open area or try again.”             |
| Unsupported/insecure | **Location is not available in this browser** | Keep normal map controls                         |

Do not use success/error color alone. Pair every state with text and a distinct
icon or shape. The blue dot always means the reported device position; it does
not change color to imply activation validity.

## All-Parks Map Behavior

The target stays in the same control position and uses the same lifecycle.
After the first fix:

- center at a neighborhood-scale zoom rather than the statewide fit;
- classify the location against all polygonal canonical detailed geometries;
- highlight definite and edge-uncertain matches;
- open a bottom sheet instead of a park-specific status tray; and
- list definite matches before uncertain matches, then nearby parks.

If no polygon matches, say **You’re not inside a mapped park** and
show nearby field-guide links. A point-only record can appear under nearby
parks with a **Point only** badge, but cannot appear as an inside match.

For an overlap, list each matching reference separately. Do not collapse them
into one result even if they share the same display geometry.

## Client Architecture

No Worker route, D1 table, account feature, or server session is required.

### Shared location session

`src/lib/location/session.ts` is independent of Leaflet and owns:

- idle/requesting/active/error/stopped state;
- `navigator.geolocation.watchPosition()` and `clearWatch()`;
- high-accuracy options and a bounded timeout;
- page-visibility and teardown behavior; and
- normalized, testable position updates.

Using the native API directly keeps the session reusable across
`ParkDetailMap` and `ReferenceMap`. Leaflet remains responsible for rendering,
camera movement, and controls.

Current session options:

- `enableHighAccuracy: true`;
- `maximumAge: 5_000` milliseconds; and
- `timeout: 12_000` milliseconds.

These values should be validated on iPhone and Android hardware. High accuracy
can take longer and consume more power, which is another reason to make the
session explicit and short-lived.

### Geometry classification

The implementation uses the modular
[`@turf/point-to-polygon-distance`](https://turfjs.org/docs/api/pointToPolygonDistance)
package. It returns a signed distance for polygons and multipolygons, including
holes, which maps directly to the conservative accuracy model above. Avoid the
larger `@turf/turf` bundle.

Extract polygon and multipolygon features from each canonical GeoJSON feature collection.
Point features are display-only and must not enter containment classification.
The loader groups canonical features by reference and validates geometry and
expected references before caching. It rejects web-fidelity responses and
clears failed requests so an explicit retry can recover. Request generations
discard late classifications after newer fixes, errors, stops, or navigation.

### Leaflet integration

Each map instance adds:

- a custom target control;
- one non-interactive location layer group;
- `L.circle` for the meter-based accuracy radius;
- `L.circleMarker` for the fixed-size blue dot; and
- a status region outside the Leaflet canvas for accessible text.

Leaflet also exposes `map.locate`, `locationfound`, `locationerror`, and
`stopLocate`, but the shared native session is preferable because containment,
privacy lifecycle, and state transitions should not be coupled to a map
instance.

### Implemented code boundaries

- `src/lib/location/session.ts` — geolocation lifecycle only;
- `src/lib/location/classify.ts` — pure geometry/accuracy classification;
- `src/lib/location/canonical-geometry.ts` — validated detailed-geometry loading
  and stale-request protection;
- `src/lib/location/global-matches.ts` — statewide result grouping, distances,
  and summary copy;
- `src/lib/location/reference-map-location.ts` — statewide Leaflet integration,
  result sheet, and navigation state; and
- `src/components/parks/ParkDetailMap.astro` — detail-map integration and copy,
  with the directory wired from `src/components/ReferenceMap.astro`.

## Privacy and Security

- Normal browsing requests location after the target control is tapped.
  `location=1` and saved directory-return state also start a session; neither
  carries a geolocation fix in the URL.
- Keep the browser fix, accuracy, and classification in page memory.
- Do not write coordinates, accuracy, containment status, or movement to D1,
  cookies, local storage, session storage, logs, query strings, error reports,
  or analytics.
- No location events are currently in the analytics allowlist. If interaction
  analytics are added, allow only coarse control events such
  as `location_requested`, `location_started`, `location_stopped`, or a generic
  error category. Do not attach coordinates, accuracy, or derived park matches.
- Clear the watch promptly and visibly.
- Keep the feature top-level and same-origin. If a Permissions-Policy header is
  added, allow only `geolocation=(self)`; do not grant it to cross-origin
  frames.
- Production already uses HTTPS. Geolocation also works on `localhost`, but a
  phone opening a developer machine by LAN IP over plain HTTP will not be a
  secure context; use a secure preview for device testing.

RI POTA itself should not retransmit the coordinates. The privacy note should
also be precise: the browser/OS supplies location, while normal map-tile
requests still go to the configured tile provider as the view moves. The
directory's browser history stores map-camera coordinates to restore the
browsing view; those can reflect the location-mode view even though they are
not a saved browser geolocation fix. **Exit location mode** clears this return
state. Avoid promising that no location-related state is persisted anywhere.

Suggested inline disclosure, not currently rendered:

> Your browser supplies your location to this page. RI POTA uses it only on
> this device to draw the blue dot and compare it with the mapped area. The
> location fix is not sent to an RI POTA account or database. Map tiles load
> from the tile provider, and your map view is remembered in browser history
> when you open a field guide from location mode.

## Accessibility

- Give the target control a visible focus style and the accessible name
  **Show my location** or **Recenter on my location**, depending on state.
- Use a polite live region for requesting, result, and error messages.
- Keep the textual result in normal DOM outside the Leaflet canvas.
- Ensure every action is keyboard operable.
- Use at least 44-by-44 CSS-pixel touch targets.
- Never require the user to distinguish only by color, boundary fill, or the
  relative position of the dot.
- Keep zoom, location, attribution, geometry key, and result tray from
  overlapping at 320 CSS pixels wide and at 200% text zoom.

## Testing and Acceptance

### Pure unit tests

Use synthetic GeoJSON fixtures to cover:

- definitely inside, definitely outside, and accuracy-crosses-edge cases;
- exactly on the boundary;
- polygon holes;
- disconnected multipolygons;
- activation-zone copy;
- point-only behavior;
- multiple related references; and
- invalid or missing geometry.

### Browser/component tests

- Normal page loads do not request location. Location-mode links and the
  directory Back flow start a fresh session without carrying the old fix.
- Permission grant produces a dot, accuracy circle, and text status.
- Permission denial, timeout, and unavailable errors are distinct.
- Panning does not stop position updates or force camera following.
- Stop removes the watch and location layers.
- Page hide/navigation clears the watch.
- No browser fix appears in application API requests, analytics payloads,
  URLs, or client error reports. Normal tile URLs represent the map viewport.

### End-to-end and device checks

Use Playwright geolocation and permission emulation for deterministic inside,
outside, edge, and denied flows. Manually verify current iOS Safari and Android
Chrome for:

- first-use permission prompts;
- approximate/low-accuracy location;
- GPS acquisition outdoors versus indoors;
- backgrounding and returning to the page;
- one-handed control reach; and
- collision-free layout at small widths and large text sizes.

## Rollout status

### Phase 1 — individual park pages (implemented)

The core controls, classifications, and errors below ship today. The original
inline privacy-disclosure proposal is still not rendered.

- The target control, blue dot, accuracy circle, conservative result tray,
  and failure states are implemented.
- Boundary, activation-zone, point-only, and related-reference pages work
  through the shared classifier.
- Location processing needs no account or server session.

### Phase 2 — `/parks/` map (implemented)

- The directory reuses the same location session and classifier.
- It shows grouped match, uncertainty, and closest-park results.
- Every result links to its field guide.
- Statewide canonical geometry is served as a cacheable static resource.

### Phase 3 — optional refinements after field use

- Add a user-controlled follow-camera mode only if operators ask for it.
- Consider bearing/heading only if it supports a concrete navigation need.
- Consider an offline map experience separately; geolocation alone does not
  make OpenStreetMap tiles available offline.

## Non-goals

- Declaring an activation valid or invalid.
- Replacing official POTA rules, park pages, or land-manager guidance.
- Turn-by-turn navigation.
- Recording tracks, visits, activation history, or attendance.
- Sharing live location with other users.
- Storing a “last location” between page visits.
- Background tracking.

## Original design wireframe

The September 1 wireframe records the proposed park-page idle and active states
and all-parks discovery sheet. It is historical design material; current
controls, copy, and navigation differ as documented above. Blue is used only
for device location; the rest is intentionally low fidelity.

![Three mobile wireframes showing a ready park map, a located park map with a blue dot and accuracy circle, and a statewide map with an At your location result sheet.](./live-location-wireframes.png)

## References

- [MDN: `getCurrentPosition()`](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)
- [MDN: `watchPosition()`](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)
- [W3C Geolocation specification: accuracy and privacy](https://w3c.github.io/geolocation/)
- [Leaflet 1.9.4 API reference](https://leafletjs.com/reference)
- [Turf `pointToPolygonDistance`](https://turfjs.org/docs/api/pointToPolygonDistance)
- [POTAMAP.US](https://potamap.us/)
- [POTAMAP.US geolocation layer source](https://github.com/cwhelchel/potamap.ol/blob/main/getGeolocationLayer.js)
- [POTAMAP.US target control source](https://github.com/cwhelchel/potamap.ol/blob/main/controls/ZoomToPosControl.js)
