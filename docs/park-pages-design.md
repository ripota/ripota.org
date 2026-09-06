# Rhode Island Park Field Guide Pages

Original design: 2026-08-31\
Implementation reviewed: 2026-09-06

## Current implementation

The read-only field guides and the existing-account identity bridge are
implemented. The contribution pipeline remains a proposal. Current source:

- [`src/pages/parks/index.astro`](../src/pages/parks/index.astro) renders a
  statewide map followed by name/reference search, a county filter, and a
  **Possible 2-fers** filter. Rows show reference, name, county, grid, and any
  same-source relationship badge; there is no geometry filter or report count.
- [`src/pages/parks/[reference].astro`](../src/pages/parks/[reference].astro)
  generates all 61 public, indexable field guides, including map facts, official
  source links, same-source relationship guidance, and **No community reports
  yet.** The earlier practical-note prompts, byline preview, and detailed
  freshness ledger in the mockups below are not rendered by the current page.
- Both directory and detail maps support location mode. The
  [location implementation notes](live-location-design.md) describe canonical
  geometry loading, accuracy handling, and navigation behavior.
- Migration
  [`0016_community_profiles.sql`](../migrations/0016_community_profiles.sql)
  adds community profiles and site moderator roles. Existing accounts manage
  their public byline from `/account/security/`; no new community enrollment
  route, report storage, submission form, or moderation queue exists yet.

The remaining sections preserve the design rationale and staged contribution
roadmap. Layout mockups and suggested report models are design targets, not a
description of every control or database table shipped today.

## Recommendation

Build durable park pages at `/parks/<lowercase-reference>/`, beginning with a
map-first field-guide format. The page should help someone plan a real visit
without trying to reproduce the official POTA app.

The original visual prototype, now a public field guide, is
`/parks/us-2878/`. Lincoln Woods is a useful
stress test because the local catalog currently maps both Lincoln Woods State
Park (`US-2878`) and Lincoln Woods State Forest (`US-5483`) from the same
Rhode Island DEM boundary features. That lets the prototype demonstrate a
reference-overlap research state while still showing an honest empty community
layer. The implemented relationship calculation matches mapped source feature
IDs; containment, intersection, nearby, and trail-crossing relationship types
below remain future work.

The page's main promise is:

> Know where the reference is, how to approach a visit, what local operators
> have learned, and what still needs to be verified.

It is not a replacement for official POTA reference data, rules, accounts,
spots, or logs.

## Launch State

The first generated version of a park page has only information that already
exists in the versioned park catalog or can be calculated from it:

- reference, name, county, grid, and official POTA URL;
- the reviewed boundary, activation zone, or point;
- geometry source and review status;
- same-geometry, containment, intersection, trail-crossing, or nearby
  relationships that the site can calculate; and
- an explicit empty state for community reports.

Do not prefill parking, picnic-table, operating-location, accessibility,
seasonal-access, or RF-condition prose merely to make the page look complete.
Those fields begin empty and become useful through attributed reports. An
official land-manager link can be shown as a source, but the site should not
silently turn an unreviewed source page into local advice.

An empty page is still useful because the map, geometry relationships, source
ledger, and a well-designed research queue are real content. The empty state
must say `No community reports yet`, not imply that a missing field means a
facility is unavailable.

## Directions Considered

### 1. Map-first field guide — recommended

The detailed boundary map is the page hero. A compact identity card floats on
the map at desktop sizes and follows the map on mobile. Practical planning
notes, reference relationships, community observations, and sources follow.

This direction best fits the existing Coastal Field Journal design, makes the
reviewed boundary catalog feel useful, and works equally well when someone
arrives from search, the homepage map, or an event coverage table.

### 2. Operator notebook

The page opens with a chronological feed of contributed reports and photos,
with the map reduced to a supporting card. This could become useful after the
site has sustained contribution volume, but it would feel empty and less
trustworthy at launch.

### 3. Activation planner

The page opens with task-oriented controls: parking, setup location, route,
current spots, event status, and a checklist. This is helpful during a rove or
event, but it would make an evergreen park page feel like a transient event
dashboard.

The recommended page uses direction 1 as the shell, then borrows structured
notes from direction 2 and a small number of planning prompts from direction 3.

## Layout Mockups

Site-home discovery:

```text
  existing site hero and community paths

  Rhode Island references
  ┌───────────────────────┐  ┌─────────────────────────────────┐
  │ map / reference       │  │ Browse all 61 park field guides │
  │ boundaries            │  │ Searchable list                 │
  │ popup → local guide   │  │ Official-source reminder        │
  └───────────────────────┘  └─────────────────────────────────┘
```

Park directory:

```text
  Parks / 61 Rhode Island references
  [Search by name or reference] [County] [Geometry] [Relationships]

  US-2878  Lincoln Woods State Park        Providence County
           reviewed boundary · same-geometry candidate · 0 reports  →

  US-5483  Lincoln Woods State Forest      Providence County
           reviewed boundary · same-geometry candidate · 0 reports  →
```

Desktop:

```text
┌──────────────────────────────── detailed boundary map ────────────────────────────────┐
│ site navigation                                       [boundary / overlap layer key]  │
│                                                                                        │
│ ┌─ park identity ──────────────────┐                         highlighted park shape    │
│ │ US-2878 · page status            │                                                   │
│ │ Lincoln Woods State Park         │                                                   │
│ │ county · grid                    │                                                   │
│ │ [Add first report] [Official POTA ↗] │                                               │
│ └──────────────────────────────────┘                                                   │
└────────────────────────────────────────────────────────────────────────────────────────┘
  sticky in-page navigation
  reference | county | boundary confidence | local-note state

  [quick facts]       First-report queue
                      Parking / tables / setup questions, all unanswered

  Reference relationship / possible n-fer research + verification checklist

  Community-note cards with contributor, observed date, and review state

  Source ledger and unofficial-site notice
```

Mobile:

```text
┌──────────────────────┐
│ boundary map         │
│ layer key            │
└──────────────────────┘
┌──────────────────────┐
│ park identity        │
│ primary actions      │
└──────────────────────┘
  swipeable section nav
  compact snapshot rows
  quick facts
  field-note cards
  overlap checklist
  community notes
  sources
```

The mobile page deliberately stops floating the identity card over the map.
The boundary needs enough uninterrupted space to remain useful, and Leaflet
attribution and controls must not collide with content.

## Information Hierarchy

Every visible fact belongs to one of five layers. These layers should have
distinct labels and freshness behavior.

1. **Official POTA identity** — reference, current name, grid, official URL.
   Keep this compact; do not duplicate activation histories or program
   dashboards without a concrete user need.
2. **Land-manager information** — address, access, facility details, policy,
   alerts, and official visitor maps. Link to the source and record when it was
   checked.
3. **Reviewed local geometry** — boundary or activation-zone data, geometry
   source, feature IDs, and review status from `@ripota/parks`.
4. **Community field notes** — first-hand observations with a visit date,
   contributor callsign byline, moderation state, and optional evidence.
5. **Temporary context** — Activate All RI or another event's coverage and
   schedule. This can link to or appear on a park page, but cannot define the
   canonical title or evergreen introduction.

At launch, layers 1 and 3 are populated, layer 4 is an empty contribution
state, and layer 2 is links-only until someone deliberately reviews or reports
the useful local detail. Layer 5 remains owned by the event pages.

## Page Anatomy

### Map and identity

- Focus the map on one boundary rather than the entire state.
- Allow related boundaries or activation zones to be toggled.
- Use map geometry as a planning aid, never as a rules verdict.
- Show reference, park name, county, grid, and one official POTA link in the
  identity card.
- Keep all map-only meaning available in text below the map.
- Provide a point fallback when reviewed geometry is unavailable.

### Planning snapshot

The first text after the map should answer four questions quickly:

- Which reference is this?
- Where is it?
- How confident is the local boundary data?
- Does the page have current local field notes?

### Practical notes

Organize notes by the decision they support instead of by the source that
provided them:

- Parking and entrances.
- Carry distance and legal access.
- Picnic tables, shelters, and restrooms.
- Antenna clearance and operating-space constraints.
- Accessibility.
- Seasonal gates, crowds, noise, and facility changes.
- Land-manager permit or reservation requirements.

Every category starts empty. An empty category should become a visible
research question, not disappear. That makes an incomplete page useful and
gives contributors a bounded prompt without manufacturing advice.

### Reference relationships

Precompute and store relationships between reviewed geometries:

- `same-geometry`
- `contains`
- `contained-by`
- `intersects`
- `nearby`
- `trail-zone-crosses`

Only the first five need to be geometry-derived. Editorial review can add a
short explanation when the raw relationship is misleading.

The page may call a relationship an **overlap candidate** or **possible
n-fer**. It must also say that:

- the official POTA pages and current rules must be checked;
- public access and station placement still matter;
- the entire station must satisfy the current requirements for every claimed
  reference; and
- the local map is not an activation-validity decision.

### Community notes

Avoid launching an unstructured comment wall. Start with one observation per
submission and require enough provenance for a reader to judge it.

Suggested data shape:

```ts
type ParkFieldNote = {
  id: string;
  authorUserId: string;
  parkReference: string;
  topic:
    | "parking"
    | "setup-location"
    | "facilities"
    | "accessibility"
    | "seasonal-access"
    | "noise-crowds"
    | "reference-overlap"
    | "other";
  title: string;
  body: string;
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
  observedOn: string;
  contributor: {
    displayName?: string;
    callsign: string;
  };
  reviewState: "pending" | "new" | "corroborated" | "needs-recheck" | "archived";
  sourceUrls: string[];
  createdAt: string;
  updatedAt: string;
};
```

Exact coordinates should be optional. A recognizable public landmark is often
enough, and sensitive or unsafe locations should not be published merely
because a contributor supplied a pin.

Every published note should show:

- the contributor's callsign and optional public name;
- when the contributor observed it;
- when the site last reviewed it;
- whether another operator corroborated it; and
- a correction/report action.

Treat edits as new revisions. Keep superseded content available to moderators
without continuing to show stale advice publicly.

## Identity, Authentication, And Provenance

Park contributions should use the same unified RI POTA account, email,
session, passkey, and audit infrastructure that Activate RI already uses. Do
not create a second login system or a park-specific password database.

That reuse is architectural, not a claim that the current flow already admits
all contributors. The current `/account/sign-in/` email fallback only sends a
link when the address belongs to an Activate RI activator. General community
contribution therefore requires an additive self-service enrollment flow.

### Proposed general-community account flow

`/account/join/` and first-report submission in this flow are not implemented.

1. A new contributor starts at `/account/join/`, enters an email address, and
   passes Turnstile.
2. A short-lived, single-use email link verifies the address and creates the
   same `auth_users` / `auth_user_emails` account used elsewhere.
3. The contributor chooses a public callsign byline and optional display name.
4. The account strongly prompts passkey enrollment using the existing
   WebAuthn flow. A verified-email session may submit a first report for
   moderation; a passkey is recommended for durable future access rather than
   being a high-friction prerequisite to helping once.
5. Later sign-in uses the same discoverable passkey flow or the same
   single-use email fallback.

Existing Activate RI activators and administrators do not make another
account. Their current user ID, verified email, passkeys, and sessions continue
to work. An activator membership can seed the community profile with its
primary callsign after the user confirms the public byline.

### Callsign claims

Passkeys prove continuity of the RI POTA account; they do not prove legal
ownership of a callsign. Keep those ideas separate in the data and interface.

- A callsign is required before a report can be published, but not merely to
  create an account.
- Callsigns are normalized and unique among active community profiles.
- A callsign begins as `self-asserted` unless it is linked from an existing
  event activator record or deliberately reviewed by a moderator.
- The public UI may distinguish `self-asserted`, `event-linked`, and
  `moderator-reviewed` only if that distinction is useful and explained; it
  must not imply official POTA or FCC verification.
- Callsign conflicts go to manual resolution rather than letting the newest
  claimant overwrite an existing profile.

### Implemented additive identity tables

[`0016_community_profiles.sql`](../migrations/0016_community_profiles.sql) is the
schema source of truth. `auth_community_profiles` stores a required callsign,
optional public name, claim status, and active/released claim history. A partial
unique index reserves a normalized callsign only while the claim is active.

`auth_site_roles` is site-wide and separate from event-scoped
`auth_event_roles`. It currently permits only `moderator`, with distinct grant
rows, revocation metadata, and a unique index for active grants. There is no
`editor` or `contributor` role. Moderator authorization requires an authenticated
passkey session. Report submission authorization remains part of the future
report pipeline.

### Report provenance

Each report and revision stores the immutable author user ID. The public
byline shows the callsign and optional public name, never the verified email.
Keep a byline snapshot on each revision so a later callsign/profile change
does not rewrite historical attribution.

```ts
type ParkReportRevision = {
  id: string;
  reportId: string;
  editorUserId: string;
  bylineCallsignSnapshot: string;
  bylineNameSnapshot?: string;
  observedOn: string;
  body: string;
  createdAt: string;
};
```

The public report card shows:

- callsign and optional public name;
- observation date;
- original publication and latest revision dates;
- moderation state;
- corroboration state when available; and
- a report/correction action.

The private audit trail additionally records account user IDs and moderator
actions. Verified emails remain private and are not copied into report rows.
Changing the primary callsign requires recent passkey verification or a fresh
single-use email reauthentication. Moderators use passkeys for moderation
actions.

## Incremental Rollout

Treat each phase as a complete, deployable release that does not depend on the
next phase to be useful or honest. The site can stop after the read-only launch
and still deliver value; community input should expand only after the previous
slice is operating cleanly.

### Phase 0 — validate the static prototype

Historical preview phase, superseded by the public routes. Its review scope was:

- the generated 61-page park shell;
- `/parks/`, homepage discovery, and event deep links;
- boundary, activation-zone, and point-only map states;
- calculated same-geometry relationships; and
- the zero-report and account-provenance mockups.

This phase excluded database migrations, public enrollment, and report forms
and kept park routes `noindex` during review. Current field guides are public
and indexable; do not restore those preview restrictions.

**Done when:** the page hierarchy, empty state, mobile layout, and source
language are accepted using representative geometry types.

### Phase 1 — public read-only field guides

**Status:** Implemented, with the simpler current page scope described above.

Publish the useful part without any new write path:

- make all catalog-derived park pages public and indexable;
- include them in navigation, sitemap, homepage map popups, and Activate RI
  links;
- keep catalog facts, geometry, calculated relationships, and source ledgers;
  and
- show contribution questions as `Coming later`, not as a working submission
  flow.

No authentication, D1 content tables, moderation queue, or user-generated
content is required for this release.

**Done when:** all 61 routes build without gaps, every discovery link resolves,
and boundary/source language passes accessibility and factual review.

This is the first sensible stopping point. If the directory and park pages do
not attract meaningful use, the project has not yet taken on community-content
operations.

### Phase 2 — identity bridge for existing accounts

**Status:** Implemented through migration `0016_community_profiles.sql`,
`src/worker/auth/community-profile.ts`, and
`src/components/auth/CommunityByline.astro`. General enrollment and reports
remain unimplemented.

Extend the unified account system without accepting reports yet:

- add `auth_community_profiles` and `auth_site_roles`;
- let an existing Activate RI user confirm a callsign byline and optional public
  name;
- reuse verified emails, sessions, passkeys, user IDs, and audit events; and
- require passkeys for site moderators.

Do not add general `/account/join/` enrollment or a park submission form in
this phase.

**Done when:** an existing activator can sign in, confirm the public byline,
manage a passkey, and retain the same identity across event and site-wide
account screens.

### Phase 3 — private report drafts

Build the write model without publishing user content:

- add report and immutable revision storage in D1;
- let an invited existing account create one structured draft containing topic,
  observation date, body, and optional source URL;
- let the author view and revise that draft after signing in again; and
- record author, revision, and audit identifiers from the unified account.

There is no moderation queue or public report rendering yet. Keep the form
behind a pilot feature flag.

**Done when:** a draft survives sign-out and sign-in, every edit produces a
revision, and the stored author still resolves to the expected callsign
profile.

### Phase 4 — invited moderation and publishing pilot

Complete the text-report lifecycle for the already-known account population:

- add a minimal moderator queue with approve, reject, and request-changes
  actions;
- render approved reports with callsign, observation date, revision date, and
  moderation state;
- show requested changes on the author's draft screen; and
- keep submission limited to explicitly invited existing accounts.

Explicitly defer photos, comments, replies, ratings, exact-location pins,
corroboration, and automatic summaries.

**Done when:** one report can travel through submit, moderate, publish, revise,
and correct without losing its author or audit history.

This is the contribution MVP. It validates the report shape and moderation
workload before opening a public signup surface.

### Phase 5 — open community enrollment

Open the proven report pipeline to people who were not part of Activate RI:

- add `/account/join/` with Turnstile and an enumeration-safe email response;
- verify the email into the existing `auth_users` and `auth_user_emails`
  records;
- collect and resolve callsign claims;
- strongly prompt passkey enrollment; and
- add submission rate limits and basic abuse controls.

The report form, moderation queue, revision model, and public report card should
remain the same as the invited pilot.

**Done when:** a person with no event history can enroll, establish a callsign
byline, submit a pending report, and later return with either a passkey or
single-use email link.

### Phase 6 — corrections and freshness

Add lifecycle tools only after real reports reveal which ones matter:

- correction requests and contributor revisions;
- `needs-recheck` and archived states;
- topic-specific freshness guidance;
- optional public landmark or coarse-location fields; and
- corroboration when it helps readers assess a changing condition.

Avoid replies or a general-purpose discussion thread; keep each contribution
focused on improving a field-guide fact.

**Done when:** stale or disputed information can be corrected transparently
without deleting attribution or silently rewriting history.

### Phase 7 — richer media, only if needed

- add photos after licensing, EXIF stripping, moderation, storage, retention,
  and alt-text requirements are settled;
- consider notifications for contributors and moderators;
- add private moderator notes separately from public reports; and
- consider helpfulness signals only if they improve freshness decisions rather
  than creating a reputation contest.

**Done when:** media adds planning value that text and map geometry cannot
provide, and its moderation/storage cost has an explicit owner.

### Recommended decision gates

- After Phase 1, measure whether people actually reach and use park pages.
- After Phase 4, review report quality and moderation effort before building
  public enrollment.
- After Phase 5, learn from real correction patterns before designing freshness
  or corroboration systems.
- Treat Phase 7 as optional, not as an inevitable destination.

## Freshness Rules

Use independent dates for each source layer rather than one ambiguous “page
updated” timestamp.

- POTA identity follows the versioned park-catalog refresh.
- Boundary geometry follows the versioned geometry review.
- Any later editorial summary of an official facility source shows the date the
  source page was checked; launch pages do not contain those summaries.
- Community notes show the contributor's observation date and moderation date.
- Event modules use the event API's own timestamp and disappear or collapse
  when the event phase no longer needs them.

Do not expire every note on an arbitrary global schedule. Gate and restroom
hours need frequent checks; a description of a rocky carry may remain useful
for years. Topic-specific freshness rules can come after real notes exist.

## Routes and Discovery

- Use the lowercase POTA reference as the stable path:
  `/parks/us-2878/`.
- Do not make the park name part of the canonical URL; names can change.
- Generate the shell for every catalog reference before adding park discovery
  to global navigation, so directory and map links never lead to a 404.
- Add `Parks` to the global header and footer.
- On the site homepage, keep the existing hero and community-path layout. Turn
  the Rhode Island references section into the main gateway by adding a
  prominent `Browse all 61 park field guides` action beside the existing map.
- Add `Open local field guide` to each homepage and event-map popup.
- `/parks/` opens with the statewide map, followed by search, county and
  **Possible 2-fers** filters, then linked rows with catalog/calculated facts.
- All references remain discoverable even without community reports. The
  explicit empty report state appears on each field guide.
- Search engines and share metadata should use the current park name while the
  path remains stable.

## Activate All RI Integration

The event should link into park pages without turning them into event pages.

Recommended integration points:

1. Make the park name/reference in `ParkCoverageTable` a link to the local
   field guide.
2. Add `Local field guide` beside the official POTA link in event result
   cards.
3. Add the field-guide link to event map popups.
4. Preserve the volunteer action as the event-specific primary action; the
   field-guide link is secondary.

The current site implements the first three connections. Event calls to action
follow the event phase; volunteer entry points remain on the event surfaces.

The canonical park page can optionally show a small current-event module below
the evergreen planning snapshot. It should be driven by event phase and public
event data, and it should not appear in the page title, description, or durable
field notes.

## Initial Prompt And Template Priorities

Generate the reliable shell for every reference, then use a deliberately
varied set to verify that empty states, relationship calculations, and
contribution prompts are useful:

- one popular state park with many unanswered visitor-planning questions;
- one wildlife management area with sparse visitor infrastructure;
- one coastal reference with parking or seasonal pressure;
- a synthetic point-only fallback (the current v3.1.1 catalog has none);
- one trail activation zone; and
- one same-geometry or contained reference pair.

This will expose template weaknesses without pre-filling local content. The
first real practical detail still comes from an attributed contributor.

## Open Product Decisions

- Should exact setup coordinates ever be public by default?
- Who can mark a note corroborated or stale?
- Does the site need replies, or are revision/correction flows enough?
- Should current spots appear on a park page, or remain on `/on-air/`?
- Which six references best represent the first contribution-prompt review?

None of these decisions blocks the static park shell or event deep links.

## Current scope and next work

The current park pages implement:

- a searchable, filterable `/parks/` directory for every catalog reference;
- generated `/parks/<reference>/` shells for every catalog reference;
- a focused Leaflet map with reviewed boundary, activation-zone, or point
  geometry and location mode;
- a toggleable related-reference overlay;
- official POTA and geometry-source links;
- only catalog-derived facts and calculated same-geometry relationships;
- a true zero-report community state;
- concise multiple-reference verification guidance;
- homepage, global-navigation, footer, and map-popup discovery links; and
- links to official POTA and geometry sources.

It intentionally does not implement general-community enrollment,
submissions, report storage, moderation, park-page current spots, or photos.
The shared account system does have a community-profile database and byline
editor. Phases 3–7 above describe possible additions; they are not current
capabilities or required parts of the read-only field guides.
