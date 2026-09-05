# Activate All RI: final-week review and proposed work

Reviewed September 5, 2026 using production pages, public schedule data, open GitHub issues, browser tests, and outside reporting. The review began on main `2a8276b5`; the final source check included concurrent commit `520b6e9c`, which shortened Progress notices. The findings below describe that baseline; implementation progress is recorded separately here.

## Implementation update — September 5

The first implementation covers:

- Separate **Add an activation** and **Get ready to hunt** invitations, welcoming additional parks, times, bands, and modes while helping hunters prepare for POTA's Worked All RI award.
- Cancellation and completion preserved across later plan saves, with read-only summaries and organizer guidance. Delayed stops retain their status.
- Production schedule outages shown as unavailable, with neutral maps and no false gap totals. Only Astro dev can use a dated local export.
- Working live and post-event destinations: on-air spots, My Plan, event progress, and help.
- Signup before the map, explicit date selection, EDT guidance, and visible email sign-in.
- Saved hunter results before import instructions, accurate restore status, remaining parks first, import-update controls, and preserved privacy details.
- Schedule filter reset, reload and loaded-time controls, clearer event-day labels, and Ops Room guidance that messages do not update the public schedule.

The event-window decision, organizer coverage confirmation, and real-device email/passkey rehearsal remain open. The existing UTC phase boundaries are unchanged. These changes do not create a separate event award or determine official POTA eligibility.

Validation: Astro check reports zero errors, warnings, or hints; the local build and volunteer bundle gate pass. All 595 unit tests, 22 event browser tests, and 30 desktop/mobile park browser tests pass. Browser regressions cover cancellation after reload and unrelated saves, email-only sign-in, explicit date selection, saved hunter checklists, phase destinations, and unavailable schedule/map states. At 390 × 844, the signup's first identity field now begins approximately 642 pixels from the page top, compared with 1,886 during the original review. This is local verification; production deployment and real-device rehearsal are pending.

## Original assessment

The best use of the remaining week is to make the existing tools dependable and easier to reach, then rehearse real operating situations. Keep the current routes, data model, authentication options, maps, and official POTA integrations. Prioritize schedule correctness before presentation work.

One decision is urgent: the current automatic live window begins **September 9 at 8 p.m. EDT**, although public copy describes early September 10 activity. Confirm the intended window before scheduling the final rehearsal and support coverage; details appear below.

**What the current evidence says**

The public schedule had 81 scheduled stops, 8 cancelled stops, 32 distinct scheduled callsigns, and all 61 parks represented. However, **43 parks had only one scheduled stop, and 48 depended on one callsign**, including parks with repeated stops by the same callsign. These are planned opportunities, not completed activations or independently verified commitments. Mode coverage was 56 parks listing SSB, 34 listing CW, and 8 listing Digital; mode choices can overlap. These are a September 5 snapshot, not numbers to hard-code into copy. [Public schedule data](https://ripota.org/api/activate-ri-2026/public/stops)

The event landing page nevertheless still says “Help fill the Rhode Island map,” displays zero coverage gaps, and directs visitors to references needing volunteers. Additional operating windows and complementary modes now make a more useful invitation. Preserve the signup action and explain that another activation at a scheduled park is welcome. [Event overview](https://ripota.org/activate-ri-2026/)

Outside promotion has already established what hunters expect: ARRL's August 6 announcement and Amateur Radio Newsline's August 20 report promise a complete schedule and an on-air dashboard. The existing `/on-air/` page meets the underlying need, but it needs prominent links from the hunter and schedule pages. [ARRL announcement](https://www.arrl.org/arrlletterissue?issue=2026-08-06), [Newsline report](https://www.arnewsline.org/news-text?offset=1787255690504)

Three independent reviews covered hunters, activators, and external reporting. Public pages were inspected on desktop and at phone widths. The full existing `mise run e2e:activate-ri` suite passed on baseline `2a8276b5`, including its local build; `test-results/.last-run.json` reported `passed` with no failed tests. A separate browser exercise using synthetic local D1 data then reproduced a cancellation defect that the passing suite does not cover. The final source delta changed only Progress notice wording/tests and this report, leaving the reproduced behavior paths unchanged. No real registrations, messages, accounts, or production configuration were changed by this assessment.

**First fix the three concrete correctness problems**

| Priority | Verified problem | Smallest useful change | Acceptance evidence |
| --- | --- | --- | --- |
| P0 | A removed stop comes back after an unrelated save. In a synthetic two-stop plan: Remove + Save leaves one scheduled and one cancelled stop; the editor still displays both. Reload, change only organizer notes, and Save schedules both again. Cancel plan followed by Save also schedules both again. | Preserve cancellation across reads and unrelated saves. Clearly display cancelled plan/stop state; restoring a stop must be an explicit action. Keep this within the existing editor/API. | Browser regression: remove → save → reload → edit notes → save; cancelled stop stays absent from public scheduled results. Repeat for whole-plan cancellation and any explicit restoration path. |
| P0 | A public-stops outage becomes a false empty schedule. Blocking that request in an isolated browser causes production to accept `{ok:true,stops:[],generatedAt:null}` from its static fallback. It then says “Find parks that still need coverage (61)” and “Approved activation windows will appear here after organizer review.” | Distinguish unavailable, genuinely empty, and dated fallback data. Reject the undated empty placeholder as a usable outage snapshot; show an unavailable message and official-spots link. If using a real fallback snapshot, visibly identify its age and avoid presenting gap totals as current. | Simulate failed live requests with the actual empty fallback, a dated nonempty fallback, and a genuinely empty successful live response. Check schedule, hero, park coverage, and the hunter's remaining-parks planner. |
| P1, fix before opening | Automatic post-event “Check recognition” links to `/activate-ri-2026/awards/`, which returns HTTP 404. The current phase test checks that the button exists, not that its destination works. | Point the post-event action to the existing event progress/park results page and label it “View event progress.” Send corrections to the existing help/contact route. During the event, “Update my activation” should lead directly to My Plan/sign-in, not new signup. | Exercise planning, event, and post-event actions; follow every visible destination and verify the intended page. Do not create an awards program to satisfy a placeholder link. |

Implementation pointers: `src/components/activate-ri/ActivatorEditForm.astro`, `src/worker/db.ts`; `src/lib/activate-ri/public-stops-client.ts`, `ScheduleTable.astro`, `ParkCoverageTable.astro`, `CoverageSummary.astro`, `EventHeroContent.astro`; `src/data/activate-ri-2026/event.ts`, `src/lib/activate-ri/paths.ts`, and `e2e/activate-ri-activity.spec.ts`.

These are the first work package. Its duration depends on the cancellation fix; reserve up to a day, and let it displace optional polish if necessary.

**Give each visitor an obvious next action**

| Visitor | What they are trying to do | Existing tools to retain | Proposed improvement |
| --- | --- | --- | --- |
| Casual hunter arriving from a club announcement | Find someone to contact immediately | Public on-air page and schedule, no site account required | Lead hunter page with “See RI on air now” and “View event schedule.” Make the checklist optional. |
| Experienced hunter chasing remaining RI parks | Match needed parks to bands, modes, and times | POTA CSV import, manual choices, remaining-parks schedule, print | Show remaining parks and personalized schedule first on repeat visits; add park search to the existing schedule if time permits. |
| DX/UTC hunter | Interpret the date and time correctly | Working UTC conversion and shareable filter URLs | Label the day filter “Event day (Rhode Island time)” and the zone “Eastern (RI / EDT).” Include that distinction on print. |
| First-time or one-stop activator | Volunteer without understanding the whole application | Signup, organizer review, email access, official guide | “Add one park or a multi-park route.” Replace the silently preselected September 10 date with “Choose a date”; make email sign-in easy to see. |
| Returning activator or rover on a phone | Change the next stop quickly | My Plan, existing stop editor, Ops Room | Lead with My Plan and upcoming stops, show publication/cancellation state, and make the difference between a chat update and a schedule edit explicit. |
| Organizer watching coverage | Know where intervention is needed | Public plans, progress, Ops announcements/chat, admin controls | Review parks with one stop/one callsign and confirm backup arrangements through existing coordination. Separate missed plans, recent spots, and POTA confirmation. |

Do not infer from these personas that every hunter is at home or every activator is experienced. Keep instructions usable for park-to-park operators, visiting rovers, club stations, and people joining for one short outing.

**A bounded page and copy pass**

| Surface | Recommended change and sample wording |
| --- | --- |
| `/` | Keep the homepage evergreen and retain the existing prominent event link. Shorten the introductory sentence to “Find Rhode Island POTA parks, see current spots, and connect with local operators.” No event dates in general homepage prose. |
| Event overview | “Put Rhode Island's 61 POTA parks on the air—or join the hunt from wherever you operate.” Keep dates and use “Early activations September 10” instead of “soft start.” Add clear hunter and activator links near the hero, before the long map on mobile. |
| Overview signup band / coverage summary | When all parks have a plan: “Every park has a planned activation. More times, bands, and modes give hunters another chance.” Use “Add an activation,” with a nearby “Already signed up? Open My Plan.” When gaps actually exist, retain a specific gap invitation. |
| Overview guidance | Replace the repeated coordination explanation with three short steps: add or browse plans; check official spots for current activity; upload activator logs to POTA. Keep a compact explanation that planned windows are approximate and parks are not reserved. |
| Hunter landing | “Find parks you still need and plan when to listen.” Put schedule/live actions above import. “Already hunted RI parks? Import your POTA Hunted Parks CSV to personalize your schedule.” |
| Returning hunter checklist | Show saved progress and Remaining first. Collapse instructions under “Update from POTA CSV.” Fix the restored-state message that still says “No checklist has been imported in this browser yet.” Show last import and “Saved in this browser.” |
| Checklist privacy and manual controls | Visible: “Your CSV stays on this device. Your checklist is saved in this browser only.” Preserve the full disclosure under “Privacy details.” Describe it as all-time RI history plus your manual choices, so it is not mistaken for an event-only score. Add “Check a park after you work it. This changes your checklist; official POTA credit comes from activator logs.” Explain that reimport preserves manual choices. |
| Schedule | “Planned times. Check current POTA spots for frequencies and changes.” Link “See RI on air now.” Remove the zero-gap recruitment shortcut from the main hunting path. Relabel Timeline and time zone as above. |
| Event parks | Make its purpose “Activation plans by park” during planning, with scheduled times and links to field guides easy to reach. Preserve park volunteer links. In the live view, put current spots and next planned opportunity ahead of detailed confirmation history. |
| Progress / live park results | Keep `Progress`. Replace “persistent POTA evidence,” “strongest evidence,” and “public collection rehearsal” with task language such as “Event activity,” “Park status,” and “Updated [time].” Hide rehearsal prose when the event starts. Retain separate planned, reported activity, and POTA-confirmed states; do not silently reinterpret declared multi-park activity as a direct spot. |
| Activator signup / sign-in | “Add your activation plan” and “Sign in to change your plan.” Keep passkeys and email links; show both choices without exposing authentication terminology in the lead. Describe link expiry when sending/using the link. Explain the time choice visibly: “Choose the three-hour window when you expect to be on the air. You can operate for less time.” Replace “The same email address can manage multiple submitted plans” with “Use the same email address to keep all your stops together,” matching the current merged-plan behavior. Do not alter authentication policy this week. |
| My Plan / Ops Room | Show “Waiting for review,” “On the public schedule,” or “Cancelled” as appropriate. Rename the quick chat action to “Tell the Ops Room I'm running late,” with a nearby “Edit scheduled time” link. Posting a message alone does not update the schedule. |
| Account security | Keep security controls intact. Use “Follow your device's passkey prompt” instead of “Waiting for your authenticator,” label the first enrollment “Add a passkey,” and keep administrator-specific explanations out of ordinary activator guidance. This is optional copy polish after sign-in usability is verified. |
| FAQ | Give the hunter answer immediate links to current spots and schedule. Explain that POTA credit can appear after log upload. Add brief early-activation, time-zone, changing-plan, and seasonal-access answers. Keep existing cookout RSVP and event contact information easy to find. |
| General park directory / field guides | Keep the recent map/copy improvements. Distinguish these from event coverage pages and add an easy return to the event from a guide reached through an event link. Preserve official map/source links and the unofficial-site notice. |

The unofficial community-site notice and official POTA links stay intact. Simplifying “persisted evidence” is a language change; retaining the actual source/confirmation distinctions is essential. POTA distinguishes a spotted station, a qualifying activation, and hunter credit; hunters do not submit POTA logs, and activators should submit partial logs too. [Official POTA rules](https://docs.pota.app/docs/rules.html)

Relevant files: `src/pages/activate-ri-2026/`, `src/components/activate-ri/`, `src/components/auth/SignInPanel.astro`, `src/data/site.ts`, and `src/components/SiteHeader.astro`. The second work package is a selected copy/navigation pass: allow half to one day including rendered review, with a hard stop. Prioritize event/hunter/schedule actions, signup/date clarity, and Ops wording; general homepage/account polish is optional. Returning-checklist behavior and layout belong to the third package, not this estimate.

**Make schedule and listing pages work better on a phone**

The production schedule's first row starts about 1,156 pixels below the top at 390 × 844, after seven stacked filters. The activator's first signup field starts around 1,886 pixels down, after guidance and the map. Neither page overflows horizontally; the problem is how much setup precedes useful information. The hunter upload field similarly sits below the first screen, and the full import instructions remain above saved results on repeat visits. Put a short signup introduction and returning-user link before the form; move optional guidance/map below it, or add a prominent “Go to signup form” anchor if reordering cannot be verified in time.

For the third work package, budget half to one day:

1. Keep event day, mode/band, and time zone easy to reach. Put secondary filters in a native “More filters” disclosure on narrow screens. Retain current URL state and printing.
2. Show the number of matching activation windows and a visible “Clear filters” recovery. Add park name/reference search to the existing table only after correctness fixes pass; then a checklist park can link straight to its scheduled times.
3. Keep park reference/name, callsign, date/time/zone, and bands/modes readable together. Reuse the existing callsign popover and public notes; make important changed-plan notes easy to discover. Keep cancelled stops out of the public scheduled list, as today, while clearly showing cancellation in My Plan. Adding a public cancellation-history view is outside this package.
4. Show “Loaded [time]” and a “Reload schedule” action. The schedule currently fetches once when the page loads, so a tab left open can miss later changes. Existing on-air automatic refresh should remain separate and retain its stale-data warning.
5. Render saved hunter results before setup, list Remaining before Hunted, and retain keyboard focus when a checkbox moves a park between lists. Preserve the existing unscheduled-remaining-parks list and print header.

A date example that must stay understandable: selecting September 10 in the RI event-day filter can correctly show September 11 at 01:00–04:00 UTC. The conversion is working; the filter's calendar needs an explicit label. [Reproducible schedule view](https://ripota.org/activate-ri-2026/schedule/?timeline=2026-09-10&timezone=utc)

**Confirm the event boundary before the automatic switch**

Current code uses September 10 at 00:00 UTC through September 14 at 00:00 UTC. In Rhode Island this begins **Wednesday September 9 at 8 p.m. EDT** and ends **Sunday September 13 at 8 p.m. EDT**. Public prose instead describes early Thursday activity and a Friday–Sunday event. The phase and reporting windows are explicitly UTC in the implementation; do not casually change them as part of a wording cleanup.

Organizers should confirm the intended operating/reporting window, then make dates, phase behavior, and public explanations agree. Rehearse the two transitions and a Sunday evening stop. Check the homepage buttons, event navigation, park results, progress wording, and actual destinations at each phase. This is a release decision, not a reason to rebuild the schedule's time conversion.

**Operational actions worth more than another feature**

Use the existing schedule to identify the overlapping groups of 43 single-stop parks, 48 single-callsign parks, and parks with constrained access or narrow mode availability. Deduplicate them into operator/route conversations, prioritizing sole-operator roves and access constraints; these groups cover most of the catalog, so do not start 91 separate park follow-ups. Confirm intended time, access, contact route, and a fallback operator/stop where practical. One callsign currently supplies the only stop at eight parks, so a single disrupted rove could affect several references. This is a dependency to discuss, not a judgment about that operator. Repeat the review after cancellations. No new assignment dashboard is needed.

The outside accounts support that emphasis. The 2023 RI ARRL retrospective describes repeated activations at every park and celebrates newcomers; its provisional historical counts are not the 2026 denominator. N2BTD's firsthand rover account describes a long itinerary shaped by shared activations and operations across midnight UTC. Those suggest backup opportunities and easy plan changes. [RI ARRL retrospective archive](https://ri-arrl.org/category/pota/), [N2BTD's 2023 account, printed pages 40–41](https://fairlawnarc.com/Newsletters/v08-nr10_2023-10_.pdf#page=40)

Recent blogs reinforce realistic rehearsal cases: KB2PIZ's August Brenton Point outing ended after six contacts but made a new local connection; K4SWL's May account includes a first CW activation and changing bands under poor conditions; your Rocky Point account combines a first activation with backup equipment. My inference is to welcome a short contribution, keep band/time changes easy, and avoid making delayed confirmation feel like rejection. [Brenton Point report](https://qrper.com/2026/08/six-contacts-and-a-new-friend-at-brenton-point-state-park-us-2870/), [POTA with Friends](https://qrper.com/2026/05/pota-with-friends-zachs-first-cw-activation-new-gear-and-tough-bands/), [Rocky Point with KA5I](https://rwjblue.com/notes/2026-08-05-rocky-point-with-ka5i/)

Two current, specific access notes belong in a short activator briefing:

- **Orange clothing:** September 12 is the second Saturday in September. RI's active rule requires 200 square inches of solid daylight fluorescent orange for users of State Management Areas and designated Undeveloped State Parks, subject to its exemptions, starting that day. Link the applicable rule rather than implying all 61 parks have identical requirements. [RI regulation §7.23](https://rules.sos.ri.gov/Regulations/part/250-100-00-7)
- **Beach facilities:** DEM's September 1 notice says pavilion restrooms and concessions close after September 7; parking remains open unless extreme weather closes it, with portable toilets at most beaches as conditions permit. Avoid promising summer amenities for the event. [DEM seasonal notice](https://dem.ri.gov/press-releases/wave-goodbye-state-beach-season)

Use existing FAQ contacts and the Ops Room for ordinary coordination. Agree who checks announcements and handles last-minute plan problems during each operating period. The existing Ops runbook already has room-off/announcements/full modes and rollback controls; rehearse those rather than designing a new incident system. Preparing or sending participant announcements is separate from this assessment; none have been sent.

**Human rehearsal and a realistic finish line**

Suggested sequence, with roles to be assigned by organizers:

| When | Work | Evidence to collect |
| --- | --- | --- |
| September 5–6 | Correct cancellation and outage states; repair phase links; confirm time-window intent | Passing behavior regressions and a short before/after browser demonstration |
| September 7 | Copy/navigation pass; saved-checklist and mobile schedule improvements within the available budget | Walk every public landing route on desktop and phone; no broken destinations or misleading statuses |
| September 8 | Prepared 60–90 minute rehearsal with one hunter, one activator/rover, and an organizer; include someone unfamiliar with the site | Record completed task, time, confusion, and observed result rather than “looks good” |
| September 9, before the current 8 p.m. switch | Fix only rehearsal blockers, run affected checks and event browser suite, verify deployed pages, review vulnerable coverage | Known-good public routes, tested phase actions, accessible contact fallback, named organizer coverage |
| From the confirmed start (currently September 9 at 8 p.m. EDT) through the confirmed end | Use existing tools; make corrections as plans change; protect time for operating/support | Current schedule, clearly dated live/progress data, resolved coverage problems |

Prepare test identities, a reachable test environment, synthetic plans, and sample data before the volunteer session. Run engineering cancellation/outage/phase regressions beforehand. The 60–90 minute estimate is for the prepared participant session, with roles working in parallel where useful; it does not include environment setup or every engineering check below.

Rehearsal tasks:

- **Hunter:** arrive from the public event link, reach current spots in two clicks, find a known park within 30 seconds, and make a useful filtered schedule. Download a real POTA CSV through the normal login/My Stats path on a phone or desktop; import, mark a park, reload, reimport, and understand local-only storage. Save an actual Letter/A4 print/PDF and interpret an overnight UTC row. The synthetic upload and print-CSS tests do not prove these external/user tasks.
- **Activator:** keep destructive plan-edit/cancellation regressions in isolated local D1. For real phone email/browser and passkey behavior, use a reachable test deployment with its correctly configured origin, or the documented controlled pilot with approved participants and their intended accounts. Desktop loopback alone cannot prove phone behavior. Rehearse a one-stop and club/rove plan, review/publication, an expired email link, and the existing fallback. The virtual authenticator does not prove iCloud/Google password manager or in-app email-browser behavior.
- **Field coordination:** two clients post/receive, reconnect after backgrounding or lost connectivity, read a pinned announcement, and change a delayed stop's actual schedule. Demonstrate that chat alone does not update it. Keep rehearsal messages/registrations synthetic or use the documented organizer pilot with participant consent; do not seed public fake activations.
- **Trust and phase states:** simulate empty live spots, failed refresh with retained data, public-stops outage, a partial attempt, delayed POTA confirmation, and both date transitions. Confirm users can tell “no activity” from “data unavailable” and still find official POTA.

After code changes, run affected existing unit/acceptance tests, `mise run check`, the required build, and `mise run e2e:activate-ri`; include the documented park regression gate if shared park/navigation infrastructure changes. Add regressions for the newly found behavior bugs. Do not claim this assessment's passing baseline suite validates proposed changes or substitutes for the human rehearsal.

**Keep the scope small and reconcile work already done**

At review time GitHub showed no open PRs, but there were several local workspaces and an open park-report backlog. A workspace name alone does not show active work. The completed “Implement and ship issue #33” task records deployed Parks v3.1.1 adoption; preserve that work. The “Investigate on-air polling” task contains recent Progress work, and its shortened notices landed during this assessment. Check the current branch before starting each package, and avoid duplicate edits in the shared checkout.

- FAQ issue [#3](https://github.com/ripota/ripota.org/issues/3) remains open although a substantial combined FAQ is live. Finish missing content/pilot validation rather than build a second FAQ.
- Requested-parks agenda [#5](https://github.com/ripota/ripota.org/issues/5) is partly served by the existing CSV checklist, remaining-parks schedule, and print function. Do not implement it again as a separate planner. A blank checklist or calendar export can wait.
- Prototype-copy issue [#31](https://github.com/ripota/ripota.org/issues/31) describes language already removed from the inspected current field guide. Reconcile its acceptance evidence instead of repeating the cleanup.
- Defer park-report persistence/enrollment/moderation/photos, new notifications, ADIF/contact logging, cross-device hunter sync, new awards, broad map redesign, and authentication/schema migrations. The existing post-event issues already provide homes for several of these.

The final-week scope is three small code/copy packages, a coverage confirmation pass, and a human rehearsal. If time tightens, retain the correctness fixes, direct hunter/activator paths, and rehearsal; drop new search/blank-checklist/export ideas first.
