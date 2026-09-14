# Activate All RI 2026 recap: reference notes

The recap should feel like a thank-you from fellow radio operators, with results
and photographs that help participants remember what they did together. These
organizer-published examples informed that direction; their future-event
announcements are not a model for ours, since another Activate All RI is undecided.

## Reference pages

- [Leatherman’s Loop 2025 recap](https://leathermansloop.org/2025/05/2025-recap/):
  results, photos, and photo submissions are easy to find; small, specific stories
  recognize the people doing the work, and earlier years remain accessible.
- [Evergreen Mountain Bike Festival 2025 recap](https://www.evergreenmtb.org/blog/2025-festival-recap):
  separate thanks acknowledge participants, volunteers, trail builders, and
  photographers; captions and an organizer’s personal note give the event a voice.
- [NORAC’s Silver Star POTA report](https://norac.bc.ca/index.php/news/1183-event-report-pota-syp-at-silver-star-with-va7sz-ve7pae-and-ve7kpz):
  real photographs, callsigns, and ordinary operating details make the results
  part of a recognizable afternoon spent playing radio with friends.
- [Ice Age Trail Alliance’s 2025 trailbuilding recap](https://www.iceagetrail.org/2025-trailbuilding-season-recap/):
  statistics explain what volunteers accomplished; photographs connect outcomes
  to particular locations, and a calculated impact figure includes its formula.
- [Superior Fall Trail Race 2025 recap](https://www.superiorfalltrailrace.com/2025-superior-fall-trail-race-recap/):
  recognition explicitly includes participants across abilities and outcomes,
  along with people supporting them; a leaderboard does not define belonging.
- [ARRL’s preliminary 2025 Field Day results](https://www.arrl.org/news/arrl-field-day-2025-saw-growth-in-participants-and-entries):
  celebration can coexist with incomplete logs and a clear correction process.

## Principles adopted for this recap

1. Thank activators and hunters equally, naming concrete contributions: carrying
   equipment, putting parks on the air, listening, and answering calls. Include
   helpers without inventing individual stories or quotes.
2. Let real participant photographs and captions carry the memories. Keep the
   gallery and the existing photo-submission route easy to find.
3. Show a few understandable results beside the park map. Distinguish confirmed
   activations from other recorded activity, explain QSO credits, and date the
   provisional results. Do not present callsigns as a count of people.
4. Preserve 2026 as a historical event, with access to the schedule, recorded
   POTA activations, photos, and relevant wrap-up tools.
5. Invite people to stay connected to RI POTA without promising another event or
   naming a future year. Activator feedback questions remain a separate draft for
   organizer review; do not build or advertise a custom survey collection flow.

## Implementation

The event overview switches to the recap at the existing September 14, 2026,
00:00 UTC boundary. Planning and live views remain available before that boundary.
The recap thanks both activators and hunters, shows provisional POTA log totals,
separates confirmed parks from other recorded activity, and previews public photos
from different contributors. Schedule, media, and account links remain
available. The site homepage remains evergreen.

The map and headline denominator use the original 61-park roster. Map points use
reviewed display geometry where necessary to locate the Rhode Island portion of
national trails. Current live spots do not affect the recap map. The statistics
use the latest event log data and identify the last successful POTA history sync;
an API refresh time is not presented as a log-check time.

Results are deliberately provisional. After reconciliation and organizer review,
publish a dated, preserved results snapshot and update the late-log wording. The
current public API still projects evidence through the installed park catalog;
a complete final snapshot should preserve evidence for every 2026 reference even
if the current catalog later removes it. Do not label results final merely because
the automatic reconciliation window has ended.

The activator debrief remains in `activator-debrief-draft.md` for review. There is
no new feedback form, contact database, or commitment to another event.

## Follow-up experience audit

The recap now leads with “We did it!! Thank you!!”. Post-event help answers
practical questions about logs, results, photos, account access, hunter credit,
corrections, and the QRZ widget. The old planning FAQ is retained for the
pre-event phase.
Organizer contact offers a friendly invitation to reach out, with each name
and callsign linked directly to its QRZ profile.

Park results now present POTA activation records: park, callsign, UTC date,
total QSO credits, and mode counts. Attempts with fewer than 10 contacts are
identified separately. Plans remain in the dated schedule but are not part of
the post-event results table. Photo links appear only when the public
gallery confirms that a park has media.

The public spot dashboard and event hunter checklist are retired after the
event. Old URLs still offer a route to the recap or park results. Spot evidence,
reusable checklist code, and saved checklist data are retained. A future general
RI checklist could belong under the main park directory; no new location or
replacement tool has been built.

The retained schedule labels its plans as historical on screen and in print.
Empty or unavailable schedule views offer park results, and older shared park
selections remain usable without inviting visitors to start an event checklist.

The remaining recommendations, in roughly this order, are:

1. Remove new-registration invitations from account sign-in and event-access
   recovery. Offer existing-account access, organizer help, and the recap.
2. Put photo sharing, corrections, and account access first for returning
   activators. Keep existing coordination available; organizers should decide
   separately about future posting and announcement-email behavior.
3. Clarify that the current photo uploader requires an existing activator
   account, and offer organizer contact to other contributors. Broadening upload
   access is a separate product decision.

The QRZ widget now leads with “We did it!! Thank you!!” and links to the recap,
park results, and photos. Existing iframes update at the same URL; even old live
preview URLs retire after the event, without fetching current spots or refreshing.
The post-event FAQ retains the embed instructions. The social share image also
shows the thank-you recap, and its scheduled generator supports both the recap
and earlier event phases.

The recap photo preview chooses up to three photos from the organizer-curated
pool, favoring different contributor callsigns. It reads every page of featured
photos, so older selections remain eligible. Selection happens once per visit;
photos stay still while someone reads and are not periodically replaced.

In Admin → Photos, open a photo, check “Feature on recap,” and save its details.
Featured badges and the shareable “Featured only” filter help organizers review
the pool. Activators cannot change this editorial selection. Ordinary metadata
edits preserve it, and unfeaturing does not remove a photo from the full gallery.

Migration `0034_media_featured_on_recap.sql` starts existing and new uploads
unfeatured. Organizers need to pick the initial favourites after rollout. Until
then, the recap links to the gallery without substituting unreviewed uploads.

## Hero event replay

The recap hero replays archived POTA spot reports on the Rhode Island map.
Parks begin muted, light up on their first retained report, and pulse on later
activity. The historical “parks heard” count stays separate from the recap’s
recorded coverage and official log totals. A spot timestamp is reported on-air
activity, not the moment an activation earned credit.

The 72-second animation plays once when the map becomes visible. Empty time
before the first report is compressed to at most one second. The scrubber
always maps linearly across September 10–13 UTC, including early activations.
Visitors can pause, scrub, skip to the final map, replay, and inspect parks.
Selecting or navigating the map pauses playback. Background tabs and wholly
offscreen replays pause without advancing the clock; explicit pauses persist.
Reduced-motion visitors start on the final map and can opt into playback
without expanding rings. Keyboard visitors can skip directly to the controls.

`GET /api/activate-ri-2026/public/event-replay` projects the permanent archive,
collapses revised reports, and retains positive reports followed by QRT.
Declared N-fer references use the existing normalized evidence and frozen event roster.
At most 128 reports per park are sampled across the full event, preserving each
park’s first and last reports. The public response contains only timestamps,
park references, activator callsigns, modes, and frequencies, plus feed metadata.
Comments, spotters, collection metadata, and private archives are not exposed.
Empty archives and service failures have separate UI states; neither invents
activity. The compact activity silhouette counts reported parks per hour from
this sampled feed, rather than claiming to count all spots or contacts.
