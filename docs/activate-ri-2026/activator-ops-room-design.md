# Activate RI 2026 Activator Ops Room — Final Implementation Plan

**Status:** Implemented; room remains off pending operational rollout  
**Tracking issue:** `ripota/ripota.org#6`  
**Proposed design document:** `docs/activate-ri-2026/activator-ops-room-design.md`

## 1. Outcome

Build a private, event-scoped **Activator Ops Room** for approved Activate All RI 2026 activators and organizers.

The Ops Room is a small operational coordination system, not a general-purpose chat platform. Its jobs are:

- organizer announcements
- park access and field-condition notes
- schedule-delay heads-ups
- coverage rescue and backup requests
- lightweight conversation among approved activators

The system will provide real-time delivery through a Cloudflare Durable Object and hibernating WebSockets. Cloudflare D1 remains the authoritative store for messages, room state, membership, moderation state, and the durable change-event cursor.

There will be **no periodic polling during normal operation**. HTTP remains part of the design for:

- initial bootstrap
- durable catch-up after reconnect
- idempotent message submission
- moderation and room-control mutations
- degraded/manual refresh if WebSockets are unavailable

Loss of the Ops Room must never impair volunteer signup, activator plan editing, the public schedule, or official POTA resources.

The room must continue to state that RI POTA is an unofficial community site and that official Parks on the Air resources remain the source of truth for rules, references, accounts, spots, and logs.

---

## 2. Resolved Product and Architecture Decisions

| Question | Decision |
| --- | --- |
| Refactor private-link authentication before chat? | **Yes.** Ship it as an independent, fully tested prerequisite before the Ops Room. |
| Participant eligibility | Initial organizer approval grants Ops Room membership. Membership remains independent of later stop cancellation or plan withdrawal. |
| Pending activators | May edit plans, but cannot enter the Ops Room until approved. |
| Organizer authentication | Continue using Cloudflare Access. Do not add another identity provider. |
| Room topology | One event-wide room. No per-park channels, activator DMs, or public/hunter access. |
| Realtime transport | Durable Object plus hibernating WebSockets from the first Ops Room release. |
| Authoritative history | D1, not Durable Object storage. |
| Message writes | Authenticated, idempotent HTTP mutations routed through the event Durable Object. |
| Catch-up | Append-only D1 change-event cursor. |
| Periodic polling | None while live. The change API is used only for bootstrap, reconnect, gap repair, and explicit manual refresh. |
| Park versus stop context | General messages may reference a park. Structured delay/backup messages reference a scheduled stop internally. Users only see park names and time windows, never stop IDs. |
| Schedule mutation | Chat never changes the public schedule implicitly. Explicit plan-edit actions remain separate. |
| Room operating modes | `full`, `announcements`, and `off`, controlled from the admin panel. A deployment-level hard-disable remains available. |
| Participant deletion | Participants may remove their own messages. No message editing; delete and repost instead. |
| Organizer moderation | Remove messages, mute, ban, unmute, unban, disconnect active room sessions, and separately revoke portal sessions or secure links. |
| Email announcements | An organizer may explicitly send an announcement as an email broadcast to eligible activators. Ordinary messages never generate email. |
| Retention | Keep room data through the event and for 90 days after the event, then purge message bodies and expired sessions according to a documented maintenance task. |
| Attachments and formatting | Plain text only. No images, files, Markdown, rich previews, reactions, presence, typing indicators, or read receipts. |

---

## 3. Product Experience

### 3.1 Private activator portal

The private activator area becomes tokenless after the secure-link exchange.

Recommended routes:

```text
/activate-ri-2026/access/
/activate-ri-2026/activators/
/activate-ri-2026/activators/plan/
```

- `/access/` exchanges a secure-link token for a browser session.
- `/activators/` opens the Activator Ops Room.
- `/activators/plan/` contains the existing plan-edit experience using the same browser session.
- Existing `/activate-ri-2026/edit/<token>/` links remain temporarily supported as migration bootstraps.

The activator portal should have obvious navigation between **Ops Room** and **My Plan**.

### 3.2 Mobile-first Ops Room layout

The main screen contains:

1. **Connection state**
   - `Live`
   - `Reconnecting`
   - `Offline — last synchronized at …`
   - `Paused while in background`
   - `Announcements only`
   - `Room unavailable`

2. **Pinned organizer announcement**
   - one current pin
   - organizer identity
   - timestamp
   - optional park context
   - optional indication that an email copy was sent

3. **My upcoming stops**
   - next stop shown prominently
   - additional upcoming stops selectable
   - friendly labels such as:
     `US-6986 — Simmons Mill Pond — Fri 1:00–3:00 PM`
   - quick actions pre-associated with the selected stop:
     - `Running late`
     - `Need backup`
     - `Access problem`
     - `Open plan editor`

4. **Operations feed**
   - callsign or `Organizer`
   - absolute local timestamp
   - message kind
   - optional park label
   - removed/resolved state
   - newest messages visible without losing scroll position when the user is reading older messages

5. **Filters**
   - all
   - organizer announcements
   - backup requests
   - access notes
   - my parks

6. **Composer**
   - plain-text body
   - message kind
   - optional friendly context picker
   - clear `Sent`, `Sending`, or `Not sent` state

7. **Unsent drafts**
   - failed/offline submissions remain visibly unsent
   - the user must review and explicitly send after connectivity returns
   - operational updates are never silently replayed later

### 3.3 Message kinds

Use the following stored kinds:

```text
chat
access-note
running-late
need-backup
announcement
system
```

`resolved` is not a message kind. Resolution is a state transition on an existing operational message.

Rules:

| Kind | Who may create it? | Context |
| --- | --- | --- |
| `chat` | Active activator or organizer | Optional park or own stop |
| `access-note` | Active activator or organizer | Optional RI park or own stop |
| `running-late` | Active activator | Required owned stop |
| `need-backup` | Active activator | Required owned stop |
| `announcement` | Organizer | Optional park/stop; may be pinned and/or emailed |
| `system` | Server only | Server-derived |

An activator never types or sees a stop ID. The UI presents the activator’s scheduled stops by reference, park name, date, and time. The browser sends the selected internal `stopId`; the server verifies ownership and derives the park label.

General park access information does not require a scheduled stop and may use a validated RI park reference.

### 3.4 Rules acknowledgement

On first entry, require acknowledgement of a versioned room policy:

- the room is visible to approved activators and organizers
- messages are stored and may be moderated
- participants should not publish private contact information
- the room is not continuously monitored and is not for emergencies
- participants must not interact with it while driving
- it is not the official POTA spotting, scheduling, logging, or rules system

Store both `accepted_rules_version` and `accepted_rules_at`.

---

## 4. Prerequisite: Private Portal and Session Authentication

This work should be implemented and deployed independently before Ops Room schema or UI work.

### 4.1 General activator session

Add a general activator-session table rather than a chat-only session:

```sql
CREATE TABLE activate_ri_activator_sessions (
  token_hash TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL
    REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX activate_ri_activator_sessions_actor_idx
  ON activate_ri_activator_sessions(event_id, activator_id);

CREATE INDEX activate_ri_activator_sessions_expiry_idx
  ON activate_ri_activator_sessions(expires_at);
```

For Activate All RI 2026, use a fixed **14-day session lifetime**. Do not use a write-on-every-request sliding expiration. Update `last_used_at` only on a coarse schedule or on meaningful mutations, not on each read or WebSocket reconnect.

Recommended cookie:

```text
__Host-activate-ri-session=<opaque random token>;
Secure;
HttpOnly;
SameSite=Strict;
Path=/;
Max-Age=1209600
```

Store only the SHA-256 hash of the opaque session token.

### 4.2 Fragment-based secure-link exchange

New emails should use:

```text
https://ripota.org/activate-ri-2026/access/#<edit-token>
```

The access page:

1. reads the URL fragment
2. immediately removes it from browser history with `history.replaceState`
3. posts it in the JSON body to the session-exchange endpoint
4. receives the HttpOnly session cookie
5. uses `location.replace()` to enter the tokenless portal

The raw token is therefore not sent as an HTTP request path, query string, or referrer in the new flow.

### 4.3 Legacy edit-link migration

Continue supporting existing links:

```text
/activate-ri-2026/edit/<token>/
```

The legacy route becomes a short-lived bootstrap:

1. send strict private response headers
2. exchange the path token for a browser session
3. replace navigation with `/activate-ri-2026/activators/plan/`

Keep the legacy flow until after the event. Do not require activators to find a newly issued link.

### 4.4 Token-source cleanup

The edit-token table becomes the only valid source for secure-link authentication.

Required changes:

- stop authenticating against `activate_ri_activators.magic_token_hash`
- verify all existing legacy hashes were copied into `activate_ri_edit_tokens`
- set legacy `magic_token_hash` values to `NULL`
- stop writing new values to that legacy column
- retain the column temporarily if dropping it would add migration risk
- ensure `revoked_at IS NULL` is required for every token lookup

Without this cleanup, “revoke all edit tokens” is incomplete because the legacy column remains independently accepted.

### 4.5 Resend and replacement semantics

Keep two distinct operations:

**Public resend/recovery**

- validates callsign and email
- generates another secure token
- does **not** revoke old tokens or active sessions
- remains privacy-safe and rate-limited

Do not revoke all links from an unauthenticated recovery request; otherwise anyone who knows a public callsign and email address could repeatedly deny access.

**Authenticated or organizer replacement**

- explicitly labeled `Replace all secure links`
- revokes all edit tokens
- revokes all activator browser sessions
- issues one new secure link
- sends a security-notification email
- records an audit event

Also provide a separate organizer action to revoke browser sessions without revoking secure links.

### 4.6 Session API

```text
POST   /api/activate-ri-2026/activator/session
GET    /api/activate-ri-2026/activator/session
DELETE /api/activate-ri-2026/activator/session
```

The `GET` response contains only public-safe portal identity:

```json
{
  "ok": true,
  "activator": {
    "id": "...",
    "callsign": "N1ABC",
    "name": "..."
  },
  "expiresAt": "..."
}
```

### 4.7 Tokenless plan APIs

Add session-authenticated activator routes and migrate the edit UI to them:

```text
GET    /api/activate-ri-2026/activator/plans
PATCH  /api/activate-ri-2026/activator/plans/<plan-id>
POST   /api/activate-ri-2026/activator/plans/<plan-id>/cancel
PATCH  /api/activate-ri-2026/activator/stops/<stop-id>
POST   /api/activate-ri-2026/activator/stops/<stop-id>/cancel
```

Keep legacy token APIs as compatibility adapters calling the same domain helpers.

### 4.8 Private response hardening

All access, activator portal, plan-edit, Ops Room, and private JSON responses send:

```text
Cache-Control: private, no-store
Pragma: no-cache
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Private pages should omit canonical, Open Graph, and Twitter metadata.

Use route-specific Content Security Policies:

- Ops Room: same-origin assets and explicit same-origin `wss:` connection
- edit pages: additionally permit the exact Cloudflare Turnstile script/frame origins already required by the current editor
- `frame-ancestors 'none'`
- `base-uri 'none'`
- `object-src 'none'`

Add `/activate-ri-2026/activators*` and any private access shell requiring Worker headers to `assets.run_worker_first`.

### 4.9 Trusted origin

Add one production configuration value such as:

```text
SITE_ORIGIN=https://ripota.org
```

Use it for:

- email links
- exact mutation `Origin` validation
- exact WebSocket `Origin` validation
- redirects
- canonical private-route decisions

Do not build security-sensitive URLs from an unvalidated request host.

---

## 5. Eligibility and Membership

Add a membership table separate from plan state:

```sql
CREATE TABLE activate_ri_ops_memberships (
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL
    REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('active', 'muted', 'banned')),
  accepted_rules_version TEXT,
  accepted_rules_at TEXT,
  moderation_reason TEXT NOT NULL DEFAULT '',
  moderated_at TEXT,
  moderated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, activator_id)
);
```

Semantics:

- approval creates or activates membership
- migration backfills all currently approved activators
- a later cancelled itinerary or withdrawn plan does not remove membership
- repeated plan approval must not silently clear a `muted` or `banned` status
- `active`: read and post
- `muted`: read, cannot post
- `banned`: cannot read or post
- pending and rejected activators have no room membership
- organizers authenticate through Cloudflare Access and do not require membership rows

A ban affects only the Ops Room. It does not remove the activator’s ability to edit their plan.

A separate organizer security action may revoke portal sessions and secure links when account compromise is suspected.

---

## 6. Room Settings and Admin-Controlled Kill Switch

Add one settings row per event:

```sql
CREATE TABLE activate_ri_ops_settings (
  event_id TEXT PRIMARY KEY,
  room_mode TEXT NOT NULL
    CHECK (room_mode IN ('full', 'announcements', 'off')),
  pinned_message_id TEXT,
  rules_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
```

Initial migration value:

```text
room_mode = off
```

Admin-panel semantics:

- `full`: active members may read and post; organizers may announce and moderate
- `announcements`: eligible members may read; participant posting is disabled; organizers may post announcements
- `off`: participant room entry and room APIs are unavailable; plan editing remains available

Every room-mode change:

1. updates D1
2. appends a room change event
3. broadcasts the change over the Durable Object
4. writes an admin audit event

Also retain a deployment-level emergency override:

```text
ACTIVATE_RI_OPS_HARD_DISABLED=true
```

This override wins over D1 and is displayed in the admin panel as a non-editable hard-disable state. It blocks participant room APIs and writes even if the database says `full`.

The normal operational control is the admin panel. The environment flag is only the last-resort deployment brake.

---

## 7. Realtime Architecture

### 7.1 System shape

```text
Activator browser
  |
  |-- HTTPS bootstrap / catch-up / message mutations
  |-- WSS live event stream
  v
Cloudflare Worker
  |
  |-- session or Access authentication
  |-- exact Origin validation
  |-- eligibility and room-mode checks
  |-- rate limiting
  v
ActivateRiOpsRoom Durable Object
  |
  |-- serializes event-room mutations
  |-- commits authoritative changes to D1
  |-- broadcasts complete sanitized events
  |-- targets or closes sockets by actor tag
  v
Cloudflare D1
  |
  |-- messages
  |-- append-only change events
  |-- memberships
  |-- room settings
  |-- moderation metadata
  |-- email-broadcast state
```

Use one Durable Object instance for the event:

```text
activate-ri-2026:ops-room
```

This is a natural event-room coordination boundary, not a global application singleton.

Use an Eastern North America placement hint when first obtaining the object:

```text
locationHint: "enam"
```

### 7.2 Durable Object configuration

Add a SQLite-backed Durable Object class and Wrangler migration:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "ACTIVATE_RI_OPS_ROOM",
        "class_name": "ActivateRiOpsRoom"
      }
    ]
  },
  "migrations": [
    {
      "tag": "activate-ri-ops-room-v1",
      "new_sqlite_classes": ["ActivateRiOpsRoom"]
    }
  ]
}
```

Export the class from the Worker entry module and add it to the generated `Env` type.

D1 remains the authoritative data store. Durable Object storage may hold only small coordination metadata if useful; it must not become a second message-history system.

### 7.3 WebSocket authentication

The browser opens a same-origin WebSocket:

```text
GET /api/activate-ri-2026/ops/socket
Upgrade: websocket
```

The outer Worker must validate before invoking the Durable Object:

- exact production `Origin`
- valid activator session or Cloudflare Access admin identity
- membership status
- room mode
- hard-disable override

The raw edit token, session token, email, and phone number never appear in the WebSocket URL or messages.

The Worker forwards only normalized internal actor data to the Durable Object:

```ts
type OpsActor = {
  type: "activator" | "admin";
  activatorId?: string;
  label: string;
};
```

### 7.4 Hibernation state and targeted moderation

Accept WebSockets through the Hibernation API.

Tag each connection:

```text
role:activator
member:<activator-id>
```

or:

```text
role:admin
```

Serialize only non-sensitive connection metadata into the WebSocket attachment:

```ts
type ConnectionAttachment = {
  connectionId: string;
  actorType: "activator" | "admin";
  activatorId?: string;
  label: string;
  connectedAt: string;
};
```

Use the member tag to:

- notify a muted participant immediately
- close every socket for a banned participant
- close participant sockets when the room becomes `off`
- keep organizer sockets connected for administration

Do not serialize tokens, cookies, email addresses, or phone numbers.

### 7.5 No application heartbeat

Do not run `setInterval` or periodic ping logic in the Durable Object.

Use WebSocket protocol/runtime behavior and reconnect/catch-up logic. Application-level timers would wake the object and undermine hibernation.

### 7.6 HTTP writes, WebSocket reads

Use HTTP for message creation and all mutations.

This is intentional:

- normal session and Origin checks apply
- request and response semantics are straightforward
- idempotency is easy to enforce
- retries are safe
- failed sends can be shown clearly
- WebSocket reconnect does not complicate submission acknowledgements
- the same APIs remain testable without a socket

The WebSocket carries server-to-client events only. Unexpected client data frames may be ignored or cause a policy close.

### 7.7 Mutation flow

For a message post:

1. browser sends an HTTP POST with `clientNonce`
2. Worker authenticates, validates Origin, checks room mode and membership, and applies rate limits
3. Worker invokes the event Durable Object
4. Durable Object serializes the mutation
5. D1 transaction/batch:
   - inserts or finds the idempotent message
   - inserts the corresponding change event
6. Durable Object constructs the sanitized event
7. Durable Object broadcasts it to open sockets
8. HTTP returns the same canonical message/event to the sender
9. sender deduplicates its HTTP and WebSocket copies by event sequence

If D1 commits but the response or broadcast is interrupted, retrying the same `clientNonce` returns the existing record and may safely rebroadcast it.

---

## 8. Durable Change-Event Cursor

### 8.1 Why it exists

A message-ID cursor is insufficient because existing records can later be:

- removed
- resolved
- pinned or unpinned
- affected by a room-mode change

Store every user-visible room mutation as a durable event.

### 8.2 Event table

```sql
CREATE TABLE activate_ri_ops_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX activate_ri_ops_events_event_sequence_idx
  ON activate_ri_ops_events(event_id, sequence);
```

The event payload stored in D1 must not duplicate message bodies.

Stored event types:

```text
message-created
message-removed
message-resolved
message-reopened
pin-changed
room-mode-changed
```

Membership moderation remains in the membership table and activity log. A current participant receives a targeted socket control event; after reconnect the bootstrap response supplies their authoritative current membership state.

### 8.3 Event DTOs

The sync API and WebSocket use the same public-safe union:

```ts
type OpsEvent =
  | {
      sequence: number;
      type: "message-created";
      message: OpsMessageDto;
    }
  | {
      sequence: number;
      type: "message-removed";
      messageId: string;
      removedAt: string;
      removedBy: "author" | "organizer";
    }
  | {
      sequence: number;
      type: "message-resolved" | "message-reopened";
      messageId: string;
      resolvedAt?: string;
    }
  | {
      sequence: number;
      type: "pin-changed";
      pinnedMessage: OpsMessageDto | null;
    }
  | {
      sequence: number;
      type: "room-mode-changed";
      mode: "full" | "announcements" | "off";
    };
```

For `message-created`, the API joins the current message record. If it has since been removed, it returns only the removed placeholder/state and never the former body.

### 8.4 Bootstrap and reconnect protocol

#### Initial entry

1. fetch a transactionally consistent bootstrap:
   - current membership
   - accepted/current rules version
   - current room mode
   - current pin
   - newest 50 messages
   - current event cursor
2. render the page
3. open the WebSocket
4. receive:
   ```json
   {
     "type": "hello",
     "highWatermark": 418,
     "roomMode": "full",
     "membershipStatus": "active"
   }
   ```
5. if the bootstrap cursor is lower than `highWatermark`, fetch the missing events
6. buffer live socket events while catch-up is applying
7. apply events in sequence order and deduplicate
8. enter `Live` state

The bootstrap queries and cursor query must execute in one D1 transaction/batch so the returned cursor cannot advance beyond the returned data.

#### Reconnect after signal loss or suspension

1. preserve the last applied sequence locally
2. open the WebSocket
3. receive the current high-water mark
4. fetch:
   ```text
   GET /api/activate-ri-2026/ops/events
       ?after=<last-applied-sequence>
       &through=<hello-high-watermark>
   ```
5. apply all missing events
6. apply socket events buffered after the high-water mark
7. resume live delivery

Return events in bounded pages:

```json
{
  "ok": true,
  "events": [],
  "nextCursor": 418,
  "hasMore": false
}
```

If the requested cursor is older than retained history or cannot be reconciled, return `resetRequired: true` and reload a fresh bootstrap.

### 8.5 Live event behavior

WebSocket broadcasts contain complete sanitized events, not only message IDs. Connected clients should not perform a D1-backed fetch for every live message.

TCP/WebSocket ordering handles normal delivery. Any socket close, parse failure, impossible sequence, or detected state mismatch triggers the catch-up protocol.

---

## 9. Battery and Mobile Lifecycle Behavior

The normal client performs no periodic polling.

### Visible page

- keep one WebSocket open
- perform no heartbeat interval
- reconnect with exponential backoff and jitter after an unexpected close
- on successful reconnect, run cursor catch-up

Suggested retry progression while visible:

```text
1s, 2s, 5s, 10s, 30s, 60s maximum
```

Reset the backoff after a healthy connection.

### Hidden page or screen lock

On `visibilitychange` to hidden:

1. persist the latest cursor
2. stop UI work
3. after a short grace period such as 30 seconds, close the WebSocket normally
4. do not poll in the background

On return to visible:

1. reconnect
2. catch up from the cursor
3. return to live mode

Because push notifications are not part of this release, there is no product benefit to holding a background socket open indefinitely.

### Offline behavior

Use browser `online`/`offline` state only as a hint. Real fetch/socket results remain authoritative.

When disconnected:

- keep already rendered messages visible while the page remains loaded
- show a prominent offline/reconnecting status and last sync time
- allow drafting
- do not claim that a message was sent
- preserve at most a small number of unsent drafts in IndexedDB
- clear local drafts on logout
- require explicit review and Send after reconnection
- never automatically replay `running-late`, `need-backup`, or other operational messages

The system cannot communicate from a park with no data service. Its promise is reliable catch-up when service returns, not offline delivery.

---

## 10. Message Data Model

```sql
CREATE TABLE activate_ri_ops_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,

  author_type TEXT NOT NULL
    CHECK (author_type IN ('activator', 'admin', 'system')),
  author_key TEXT NOT NULL,
  author_activator_id TEXT
    REFERENCES activate_ri_activators(id) ON DELETE SET NULL,
  author_label TEXT NOT NULL,

  kind TEXT NOT NULL
    CHECK (kind IN (
      'chat',
      'access-note',
      'running-late',
      'need-backup',
      'announcement',
      'system'
    )),

  body TEXT NOT NULL,
  park_reference TEXT,
  stop_id TEXT
    REFERENCES activate_ri_stops(id) ON DELETE SET NULL,

  client_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,

  resolved_at TEXT,
  resolved_by TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',

  removed_at TEXT,
  removed_by TEXT NOT NULL DEFAULT '',
  removal_reason TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX activate_ri_ops_messages_nonce_idx
  ON activate_ri_ops_messages(event_id, author_key, client_nonce);

CREATE INDEX activate_ri_ops_messages_event_created_idx
  ON activate_ri_ops_messages(event_id, created_at);

CREATE INDEX activate_ri_ops_messages_park_created_idx
  ON activate_ri_ops_messages(event_id, park_reference, created_at);

CREATE INDEX activate_ri_ops_messages_stop_created_idx
  ON activate_ri_ops_messages(event_id, stop_id, created_at);

CREATE INDEX activate_ri_ops_messages_kind_created_idx
  ON activate_ri_ops_messages(event_id, kind, created_at);
```

### 10.1 Author keys

Use a server-derived normalized key for idempotency:

```text
activator:<activator-id>
admin:<stable-hash-of-normalized-access-email>
system:<source>
```

Never accept `author_type`, `author_key`, `author_label`, timestamp, event ID, or activator ID from the browser.

### 10.2 Message context payload

Use a discriminated context union instead of independent client-controlled `parkReference` and `stopId` values:

```ts
type MessageContext =
  | null
  | {
      type: "park";
      parkReference: string;
    }
  | {
      type: "stop";
      stopId: string;
    };
```

For `type: "stop"`:

- verify the stop belongs to the authenticated activator
- derive and snapshot `park_reference`
- reject cancelled/non-applicable stops when the message kind requires an active stop

For `type: "park"`:

- validate against the current RI reference list
- allow only message kinds that do not require owned-stop semantics

### 10.3 Removal semantics

Participant self-removal and organizer removal both:

- clear `body` in the primary message row
- set removal metadata
- append `message-removed`
- remove the body from all subsequent normal reads
- never copy the original body into an activity/audit event

Clients that already received the text cannot be made to “unsee” it; the rules must state that messages are visible to room participants.

### 10.4 Resolution semantics

`need-backup` and `access-note` may be marked resolved or reopened by:

- their author
- an organizer

Resolution appends an event and retains the original message unless it is separately removed.

---

## 11. API

All private JSON responses use `Cache-Control: private, no-store`.

### 11.1 Participant APIs

```text
GET    /api/activate-ri-2026/ops/bootstrap
GET    /api/activate-ri-2026/ops/events?after=<sequence>&through=<sequence>&limit=250
GET    /api/activate-ri-2026/ops/socket
POST   /api/activate-ri-2026/ops/rules/accept

POST   /api/activate-ri-2026/ops/messages
POST   /api/activate-ri-2026/ops/messages/<message-id>/remove
POST   /api/activate-ri-2026/ops/messages/<message-id>/resolve
POST   /api/activate-ri-2026/ops/messages/<message-id>/reopen
```

Example message request:

```json
{
  "clientNonce": "5c6a5518-0a13-46d0-9bca-d5897ea8c198",
  "kind": "need-backup",
  "body": "Vehicle trouble; I may not reach this stop.",
  "context": {
    "type": "stop",
    "stopId": "4e480f8b-..."
  }
}
```

Example response:

```json
{
  "ok": true,
  "event": {
    "sequence": 419,
    "type": "message-created",
    "message": {
      "id": "6c4771e8-...",
      "kind": "need-backup",
      "authorLabel": "N1ABC",
      "body": "Vehicle trouble; I may not reach this stop.",
      "parkReference": "US-6986",
      "stopId": "4e480f8b-...",
      "createdAt": "2026-09-11T13:07:12Z",
      "resolved": false,
      "removed": false
    }
  }
}
```

The `stopId` in API responses may remain available to the browser for navigation and reconciliation, but it is never presented as user-facing text.

### 11.2 Admin APIs

All admin routes require Cloudflare Access.

```text
GET    /api/activate-ri-2026/admin/ops

PATCH  /api/activate-ri-2026/admin/ops/settings
POST   /api/activate-ri-2026/admin/ops/announcements
POST   /api/activate-ri-2026/admin/ops/messages/<message-id>/remove
POST   /api/activate-ri-2026/admin/ops/messages/<message-id>/resolve
POST   /api/activate-ri-2026/admin/ops/messages/<message-id>/reopen

PATCH  /api/activate-ri-2026/admin/ops/members/<activator-id>
POST   /api/activate-ri-2026/admin/ops/broadcasts/<broadcast-id>/retry

POST   /api/activate-ri-2026/admin/activators/<activator-id>/revoke-sessions
POST   /api/activate-ri-2026/admin/activators/<activator-id>/replace-secure-links
```

Membership patch:

```json
{
  "status": "muted",
  "reason": "Repeated off-topic or abusive messages."
}
```

Settings patch:

```json
{
  "roomMode": "announcements"
}
```

Announcement request:

```json
{
  "clientNonce": "2ce0cb69-...",
  "body": "Coastal winds are increasing after 6 PM. Secure masts carefully.",
  "context": null,
  "pin": true,
  "emailEligibleActivators": true
}
```

---

## 12. Admin Panel

Add an **Ops Room** section to the existing Access-protected admin dashboard.

### 12.1 Room control

Show:

- current room mode
- hard-disable status
- connected-client count as informational only
- current pinned announcement
- rules version
- last room-state change and actor

Controls:

- `Full room`
- `Announcements only`
- `Room off`

Every change requires an explicit confirmation and produces both an Ops event and admin audit event.

### 12.2 Announcement composer

Fields:

- announcement text
- optional park/stop context
- `Pin this announcement`
- `Also email this announcement to N eligible activators`
- recipient criteria preview
- final confirmation

Creating the room announcement must succeed independently of email delivery.

Editing an announcement does not automatically send another email. A resend requires another explicit action.

### 12.3 Message moderation

For every message, organizers can:

- remove
- resolve/reopen when applicable
- open the associated activator plan
- mute author
- ban author

Removal requires a short moderation reason.

### 12.4 Participant management

Show:

- callsign
- membership status
- accepted rules version
- recent message count/time
- related plan link
- actions:
  - mute
  - unmute
  - ban
  - unban
  - disconnect active Ops sockets
  - revoke portal sessions
  - replace secure links

These actions must remain distinct. Banning from the room must not silently revoke plan editing.

### 12.5 Immediate enforcement

On mute:

- update membership
- send a targeted control event to member-tagged sockets
- disable/reject posting immediately

On ban:

- update membership
- close all `member:<activator-id>` sockets with a policy close code
- reject all subsequent room reads, writes, and upgrades
- leave plan-edit access intact

On unmute/unban:

- update membership
- require the browser to reconnect or refresh authoritative state

### 12.6 Audit

Write existing `activate_ri_activity_events` entries for:

```text
ops-room-mode-changed
ops-message-removed
ops-message-resolved
ops-message-reopened
ops-member-muted
ops-member-unmuted
ops-member-banned
ops-member-unbanned
ops-announcement-email-requested
ops-announcement-email-sent
ops-announcement-email-partial
ops-announcement-email-failed
activator-sessions-revoked
activator-secure-links-replaced
```

Audit details may contain IDs, callsigns, counts, timestamps, status, recipient hashes, and reasons. They must not copy message bodies, session tokens, secure-link tokens, phone numbers, or raw participant email lists.

---

## 13. Announcement Email Broadcasts

Yes: this is intentionally a small **admin-initiated email blast** attached to an important organizer announcement.

It is not:

- a notification for every chat message
- a digest
- a participant-to-participant email system
- an automatic side effect of pinning
- a replacement for the room

### 13.1 Eligible recipients

Include memberships in:

```text
active
muted
```

Exclude:

```text
banned
pending/unapproved
rejected
```

A participant who withdrew after prior approval remains eligible while their membership remains active.

### 13.2 Privacy

Never place participant addresses together in `To` or `CC`.

Use either:

- individual sends, or
- BCC batches that stay within the provider’s combined-recipient limit

For the current expected group, BCC batches are adequate. Use an event address as `To` and at most 49 activator addresses as BCC so the combined address count remains at most 50.

### 13.3 Delivery state

Add:

```sql
CREATE TABLE activate_ri_ops_email_broadcasts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE
    REFERENCES activate_ri_ops_messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'sending', 'sent', 'partial', 'failed')),
  requested_by TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE activate_ri_ops_email_recipients (
  broadcast_id TEXT NOT NULL
    REFERENCES activate_ri_ops_email_broadcasts(id) ON DELETE CASCADE,
  activator_id TEXT NOT NULL
    REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (broadcast_id, activator_id)
);
```

Flow:

1. commit announcement and room event
2. snapshot eligible recipient IDs
3. create broadcast/recipient rows
4. return the posted announcement
5. send BCC batches in `ctx.waitUntil`
6. update batch recipient status
7. display broadcast progress/result in admin
8. permit retry of failed recipients/batches only

The room announcement remains valid even when email fails.

### 13.4 Email content

Include:

- clear event announcement subject
- announcement text
- organizer identity
- timestamp
- link to the tokenless activator portal
- access-recovery instructions if the session has expired
- reminder that the room/email is not for emergencies
- RI POTA unofficial-site language

Do not generate a new private access token for every broadcast.

---

## 14. Validation, Abuse Controls, and Security

### 14.1 Origin and CSRF

For every state-changing participant request:

- require valid session cookie
- require exact matching `Origin`
- optionally verify `Sec-Fetch-Site` as defense in depth
- reject cross-origin requests before parsing sensitive payloads

For every WebSocket upgrade:

- require exact matching `Origin`
- require valid session/Access identity
- validate membership and room mode before obtaining the Durable Object

### 14.2 Message validation

Server-side:

- maximum 1,000 Unicode code points
- trim outer whitespace
- normalize CRLF/CR to LF
- reject disallowed control characters
- allow a small number of line breaks
- plain text only
- render using `textContent`, never `innerHTML`
- reject browser-supplied author/event/timestamp fields
- validate context according to kind
- validate stop ownership
- validate RI park references
- reject posts while muted, banned, unapproved, room-off, or announcements-only

### 14.3 Idempotency

Require UUID `clientNonce` for all participant/admin message creation.

Enforce:

```text
UNIQUE(event_id, author_key, client_nonce)
```

A duplicate request returns the existing canonical message/event and does not create another row.

### 14.4 Rate limiting

Use Cloudflare Workers Rate Limiting bindings keyed by stable actor identity, not IP:

```text
5 mutations per 10 seconds
20 mutations per 60 seconds
```

Use separate namespaces for the burst and sustained limits.

The Durable Object and membership controls remain authoritative; rate limiting is an abuse brake, not the sole defense.

Do not put Turnstile on each room post. The participant is already secure-link authenticated, origin-checked, rate-limited, and moderator-controlled. Keep Turnstile on public signup and recovery paths.

### 14.5 Logging

Never log:

- raw edit token
- raw session token
- Cookie header
- participant email/phone in Ops logs
- message body
- unsent draft
- full WebSocket URL if it could contain credentials

Log only:

- request/operation ID
- actor type and opaque actor ID
- message/event ID
- event sequence
- operation result
- authorization/rate-limit reason category
- duration
- exception message after sanitization

### 14.6 Local storage

Store only:

- last event cursor
- UI filter choice
- unsent draft text/context/nonce if the user attempted to send while offline

Clear drafts and room-local state on logout. Do not store session or secure-link tokens in local storage.

---

## 15. Repository Implementation Map

### Migrations and schema

```text
migrations/0009_activator_sessions.sql
migrations/0010_activator_ops_room.sql
schema/activate-ri-2026.sql
```

### Worker/auth

```text
src/worker/activator-session.ts
src/worker/private-response.ts
src/worker/origin.ts
src/worker/edit-token.ts
src/worker/db.ts
src/worker/env.ts
src/worker/index.ts
```

### Ops domain

```text
src/lib/activate-ri/ops-types.ts
src/lib/activate-ri/ops-validation.ts
src/lib/activate-ri/ops-events.ts
src/worker/ops-db.ts
src/worker/routes/activate-ri-ops.ts
src/worker/routes/activate-ri-admin-ops.ts
src/worker/durable-objects/activate-ri-ops-room.ts
```

### Participant UI

```text
src/pages/activate-ri-2026/access.astro
src/pages/activate-ri-2026/activators/index.astro
src/pages/activate-ri-2026/activators/plan.astro

src/components/activate-ri/ActivatorPortalNav.astro
src/components/activate-ri/ActivatorOpsRoom.astro
src/components/activate-ri/OpsPinnedAnnouncement.astro
src/components/activate-ri/OpsUpcomingStops.astro
src/components/activate-ri/OpsFeed.astro
src/components/activate-ri/OpsComposer.astro
src/components/activate-ri/OpsConnectionStatus.astro
```

Migrate/reuse:

```text
src/components/activate-ri/ActivatorEditForm.astro
src/pages/activate-ri-2026/edit-shell.astro
```

### Admin UI

```text
src/components/activate-ri/AdminOpsRoom.astro
src/components/activate-ri/AdminOpsAnnouncement.astro
src/components/activate-ri/AdminOpsMembers.astro
src/components/activate-ri/AdminOpsModeration.astro
src/components/activate-ri/AdminOpsBroadcasts.astro
```

Integrate with:

```text
src/components/activate-ri/AdminDashboard.astro
```

### Email

Extend:

```text
src/worker/email.ts
```

Add support for:

- BCC recipients
- announcement broadcast content
- provider recipient limits
- broadcast result tracking
- failed-recipient retry

### Cloudflare configuration

Update:

```text
wrangler.jsonc
```

Add:

- Durable Object binding and SQLite class migration
- two Rate Limiting bindings
- environment hard-disable variable
- trusted site origin
- Worker-first private portal routes

### Tasks and documentation

```text
mise/tasks/activate-ri-2026/purge-ops-room
docs/activate-ri-2026/activator-ops-room-design.md
docs/activate-ri-2026/data-flow.md
docs/activate-ri-2026/email-flow-and-setup.md
docs/activate-ri-2026/database-reset.md
docs/activate-ri-2026/worker-logging-debugging.md
```

The purge task must support a dry-run and print counts before destructive execution.

Update backup-retention documentation because production SQL exports will include room messages.

---

## 16. Implementation Sequence

### PR 1 — Private portal and authentication hardening

Ship independently before the Ops Room.

- add activator sessions
- add fragment-token access route
- add tokenless activator portal and plan route
- migrate edit UI to session APIs
- retain legacy link/API compatibility
- remove legacy `magic_token_hash` authentication
- add trusted origin
- add private response headers and private layout mode
- add session/security controls
- tests for session exchange, expiry, logout, revocation, legacy links, origin checks, headers, and plan editing
- deploy and verify existing plan editing before proceeding

### PR 2 — Ops domain, schema, and room modes

Deploy with `room_mode = off`.

- add membership, settings, messages, events, and broadcast tables
- backfill approved memberships
- hook future approval into membership creation
- add validation/authorization domain helpers
- add bootstrap and event-sync APIs
- add admin room-mode APIs
- add idempotent message mutation domain
- add transactional D1 tests
- update reset and data-flow documentation

### PR 3 — Durable Object and realtime transport

Keep participant room disabled during deployment.

- add SQLite-backed Durable Object namespace
- add event-room object
- route message and room mutations through it
- add hibernating WebSocket endpoint
- add connection tags and serialized attachments
- broadcast complete sanitized events
- implement reconnect high-water protocol
- implement targeted mute/ban/room-off controls
- add Workers Vitest integration for Durable Object tests

Once the Durable Object migration is deployed, retain the class export and binding in future rollback builds. Operational rollback should use room mode and the hard-disable flag rather than trying to remove the Durable Object namespace.

### PR 4 — Participant Ops Room UI

- mobile-first room page
- rules acknowledgement
- pinned announcement
- next-stop cards with friendly labels
- context-aware quick updates
- feed and filters
- composer and idempotent sends
- WebSocket lifecycle
- event catch-up
- offline/reconnecting state
- unsent draft review
- no periodic polling
- accessible keyboard/focus/screen-reader behavior

### PR 5 — Admin moderation and announcements

- room mode control
- announcement composer and pin
- optional email broadcast
- message remove
- resolve/reopen
- member mute/ban/unmute/unban
- targeted socket disconnect
- broadcast status and retry
- separate session and secure-link security actions
- activity-event audit integration

### PR 6 — Verification and launch preparation

- full unit, SQL acceptance, Worker, and browser suites
- multi-client real-time tests
- mobile viewport tests
- offline/online and page-visibility tests
- failure injection
- security review
- soft launch to selected activators
- verify `announcements` mode before enabling `full`
- document moderator responsibilities and incident response

---

## 17. Test Plan

### 17.1 Unit tests

- session-cookie parsing and generation
- token hashing and revocation
- trusted-origin validation
- eligibility/membership matrix
- room-mode permissions
- message-kind/context rules
- stop ownership
- Unicode length and control-character validation
- idempotency
- event materialization after removal/resolution
- email recipient selection and batching
- private response headers

### 17.2 Real D1 acceptance tests

Apply every migration to temporary SQLite/D1-compatible storage and verify:

- existing edit tokens still exchange successfully
- legacy token column is no longer independently authoritative
- session expiry and revocation
- approved membership backfill
- approval creates membership without clearing a moderation status
- message plus change event commit atomically
- duplicate nonce returns the original message
- removed body is cleared
- event catch-up includes removals and mode/pin changes
- mute and ban permissions
- room-mode transitions
- email broadcast recipient snapshot and retry state
- D1 failure creates no partial visible mutation

### 17.3 Durable Object tests

Use the Cloudflare Workers Vitest integration.

Verify:

- authenticated upgrade succeeds
- invalid Origin/session/membership fails before object access
- `hello` contains current high-water mark
- committed event reaches multiple sockets
- sender deduplicates HTTP and socket copies
- hibernation preserves connection attachment data
- object restart still catches clients up from D1
- ban closes only the targeted activator’s sockets
- room `off` closes participant sockets but preserves admin control
- no message is broadcast before D1 commit
- idempotent retry can recover from commit-before-response failure
- unexpected client WebSocket messages are handled safely

### 17.4 Playwright tests

- new fragment link becomes tokenless portal URL
- legacy edit link becomes tokenless portal URL
- plan editing still works after session migration
- approved activator enters; pending/rejected cannot
- first-visit rules acknowledgement
- two browsers exchange a live message
- context picker displays park/time labels rather than IDs
- owned-stop checks
- hide page, close socket, return, reconnect, catch up
- simulate offline post; draft remains unsent
- reconnect does not auto-send stale draft
- admin changes mode
- admin pins announcement
- admin removes message
- admin mutes and bans; participant UI changes immediately
- email confirmation and status
- mobile viewport and accessibility basics

### 17.5 Security/failure tests

- XSS strings
- oversized Unicode
- control characters
- malformed JSON
- cross-origin POST
- cross-origin WebSocket
- expired/revoked session
- banned member
- replayed nonce
- forged author and stop ownership fields
- D1 unavailable
- Durable Object retryable failure
- socket drop during commit
- partial email-batch failure
- hard-disable override
- no token/message body/private fields in logs or error responses

### 17.6 Load test

Simulate at least:

- 75 connected visible clients
- normal idle room
- burst of 10–20 messages
- mode transition
- pin change
- one ban/disconnect
- reconnect/catch-up wave

The test should assert delivery correctness and duplication behavior, not merely throughput.

---

## 18. Acceptance Criteria

### Authentication and isolation

- approved activators can enter through an existing or new private link without another account
- successful exchange leaves no raw token in the final URL
- pending, rejected, invalid-token, expired-session, and banned users cannot read or post
- plan editing uses the session and remains functional independently of the Ops Room
- revoking all sessions takes effect on the next request/upgrade
- replacing secure links invalidates all old tokens and sessions
- no participant can see another participant’s email, phone, secure token, session, or organizer notes

### Realtime and catch-up

- two connected clients normally receive a committed event within two seconds
- no periodic polling occurs while connected
- hidden pages close their socket after the configured grace period
- reconnect after network loss applies every missing event exactly once
- a removed, resolved, pinned, or mode-changed state catches up correctly
- no message is shown as sent until the server returns a canonical committed event
- failed/offline drafts are never automatically replayed

### Context and schedule safety

- users select stops by friendly park/date/time labels
- the server verifies stop ownership
- general park notes do not require a stop
- chat text never mutates the public schedule
- explicit links/actions take users to plan editing for actual schedule changes

### Administration

- organizers can set `full`, `announcements`, or `off` from the admin panel
- organizers can pin an announcement
- organizers can remove messages
- organizers can mute, ban, unmute, and unban participants
- a ban immediately disconnects that participant from the Ops Room
- banning does not remove plan-edit access
- security controls can separately revoke portal sessions and secure links
- moderation and room changes are audited without copying message bodies

### Email

- email delivery occurs only after explicit organizer selection and confirmation
- participant addresses are never exposed to other recipients
- recipient batching respects provider limits
- failed batches are visible and retryable
- room announcement creation is not rolled back by email failure

### Privacy and resilience

- all private HTML/JSON is non-cacheable and non-indexable
- message content is rendered only as text
- removed bodies are absent from subsequent API reads and audit records
- raw credentials and message bodies do not appear in application logs
- room failure or hard-disable does not impair signup, plan editing, public schedule, or official POTA resources
- the unofficial-community-site disclaimer remains visible

---

## 19. Rollout and Rollback

### Rollout

1. deploy and verify the tokenless portal/authentication prerequisite
2. deploy Ops schema and admin controls with room `off`
3. deploy Durable Object and realtime code with room `off`
4. enable `announcements` for organizer testing
5. soft-launch to selected activators
6. exercise offline/reconnect, moderation, and email broadcast
7. enable `full` only after the go/no-go checklist passes

### Rollback

Operational rollback is:

1. set room to `announcements` or `off` in admin
2. if necessary, deploy with `ACTIVATE_RI_OPS_HARD_DISABLED=true`
3. leave private plan editing operational
4. retain additive D1 tables
5. retain the Durable Object class export and binding after its first migration
6. deploy corrective code without attempting destructive schema rollback

Do not make public schedule or edit flows depend on room availability.

---

## 20. Retention and Post-Event Work

Default:

- keep messages through the event and for 90 days after the event
- immediately clear bodies of participant- or organizer-removed messages
- delete expired/revoked sessions on maintenance
- purge remaining message bodies after the retention date
- retain only minimal non-content audit metadata when operationally necessary
- document and enforce a corresponding retention period for exported D1 backups

Add:

```text
mise run activate-ri-2026:purge-ops-room --dry-run
mise run activate-ri-2026:purge-ops-room --execute
```

The task must require an explicit execute flag and print affected counts.

After the event, review:

- activator entry/support failures
- important announcements delivered
- backup/access problems resolved
- moderation interventions
- reconnection failures
- email broadcast delivery
- confusion between room status and official POTA data
- whether structured handoffs or push notifications are justified for a future event

---

## 21. Issue #6 Update

Keep issue #6 as the implementation tracker rather than placing this entire design in the issue body.

Recommended issue-body structure:

```markdown
## Outcome

Implement the private Activate All RI 2026 Activator Ops Room described in:

`docs/activate-ri-2026/activator-ops-room-design.md`

## Resolved decisions

- [x] Approved membership only; membership survives later plan withdrawal
- [x] Token-to-session private portal is a prerequisite
- [x] One event-wide room
- [x] D1 authoritative history and change-event cursor
- [x] Durable Object WebSockets from initial release
- [x] No periodic polling; HTTP bootstrap/catch-up remains
- [x] Friendly park/stop context; internal stop IDs never user-facing
- [x] Admin-controlled full/announcements/off modes
- [x] Organizer remove, mute, and ban controls
- [x] Optional explicit email broadcast for announcements
- [x] 90-day retention

## Implementation

- [ ] PR 1 — private portal/session authentication
- [ ] PR 2 — Ops schema/domain/sync APIs
- [ ] PR 3 — Durable Object realtime transport
- [ ] PR 4 — participant UI and offline/reconnect behavior
- [ ] PR 5 — admin moderation and announcement email
- [ ] PR 6 — verification and launch preparation

## Required checks

- [ ] `mise run test`
- [ ] `mise run check`
- [ ] `mise run build`
- [ ] production D1 backup before deploy
- [ ] soft-launch checklist
- [ ] moderator runbook
- [ ] rollback/hard-disable drill
```
