# Unified Passkey Authentication Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Keep each task independently testable and deploy additive database changes before changing production routing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace routine Cloudflare Access and long-lived private-link authentication with one first-party identity and session system for Activate RI administrators and activators. Make passkeys the primary login method, retain email login for activators and recovery, preserve every existing private link, and give administrators safe passkey-reset and session-revocation controls.

**Architecture:** Add a site-wide identity layer backed by D1 and WebAuthn. A user owns verified email addresses, passkey credentials, and hashed browser sessions. Authorization remains separate: an event-scoped admin role grants organizer access, while an event membership links a user to the existing activator record. Passkey and email-link ceremonies both issue the same `__Host-ripota-session` cookie. Existing edit links and 14-day activator sessions become compatibility credentials that can create or upgrade to a unified session. Cloudflare Access remains only as a narrow bootstrap/break-glass path after the normal admin route moves to passkeys.

**Tech Stack:** TypeScript and ESM, Cloudflare Workers, D1/SQLite migrations, `@simplewebauthn/server`, `@simplewebauthn/browser`, Astro, Vitest, the existing SQLite-backed D1 acceptance harness, Playwright virtual authenticators, Cloudflare Email, Cloudflare rate-limit bindings, and mise file-based tasks.

---

## Executive Decisions

1. **One identity system, multiple credential methods.** Passkeys, email sign-in links, existing private links, and temporary Cloudflare Access bootstrap all resolve to the same user and session model.
2. **One session cookie.** Use `__Host-ripota-session` for both admins and activators. Authorization is derived server-side on every request; roles are never trusted from browser storage or unsigned cookie data.
3. **Passkeys are primary.** The normal sign-in screen leads with passkey authentication and supports discoverable credentials so Android, Apple, Windows, and hardware-key account selection work without typing an email.
4. **Email remains supported for activators.** Activators can always request a short-lived, single-use email sign-in link. Email authentication is sufficient for activator features but not for admin actions.
5. **Admin actions require a passkey.** A user with an admin role must have a current passkey-authenticated session. An email-authenticated session belonging to an admin may use activator features and account recovery, but `requireAdmin()` rejects it until passkey verification succeeds.
6. **Existing private links keep working.** Do not revoke or expire current `activate_ri_edit_tokens` as part of this migration. Both fragment links and legacy `/edit/<token>/` routes exchange into the unified session after rollout.
7. **Existing activator sessions age out naturally.** Accept `__Host-activate-ri-session` in compatibility mode for its existing lifetime. Offer an upgrade to the unified session and clear the legacy cookie after successful upgrade.
8. **No unsafe email-based auto-linking.** Supplying an email in a volunteer form does not prove ownership. Link an activator record to a user only after a passkey-authenticated existing account, a successfully consumed email/private link, an existing valid activator session, or an explicitly authorized admin recovery flow.
9. **Reset is non-destructive until completed.** “Send passkey reset” creates and emails a short-lived recovery grant but does not immediately revoke working credentials. When the user registers a replacement passkey, revoke the old passkeys and sessions atomically. Immediate emergency revocation is a distinct, clearly destructive action.
10. **Database migrations are forward-only.** Rollback means reverting Worker behavior and restoring the old Access route, not attempting to drop auth tables from production D1.

---

## Current State and Constraints

The current system has two unrelated authentication mechanisms:

- Administrators are authenticated by Cloudflare Access. The Worker validates `Cf-Access-Jwt-Assertion` in `src/worker/access.ts` and uses the Access email as the audit identity.
- Activators receive a reusable private edit token by email. The token is stored only as a hash, and a successful exchange creates a hashed 14-day `__Host-activate-ri-session` cookie in `src/worker/activator-session.ts`.

Protected pages are served by `src/worker/index.ts`. Admin, activator, Ops Room, and WebSocket APIs perform authentication in several route modules, but all eventually use one of the two existing helpers. This makes a centralized migration possible.

Relevant constraints:

- D1 remains authoritative for event-operational data.
- Existing links may be bookmarked or retained in old emails and must continue to work.
- The admin page and admin APIs must never become temporarily public during the Cloudflare Access cutover.
- State-changing requests must continue to require the exact configured site Origin.
- Production deploys must use `mise run deploy`, which applies remote D1 migrations before deploying the Worker.
- Admin emails, Access identifiers, tokens, and production credentials remain outside the repository.
- The unofficial community-site disclaimer and official POTA source-of-truth boundary are unaffected.

---

## Scope

### In Scope

- Site-wide user identities and a unified session cookie.
- Discoverable passkey registration and passwordless authentication.
- Passkey enrollment from existing trusted sessions and links.
- Activator email login as a supported alternative.
- Existing private-link and legacy-token compatibility.
- Event-scoped administrator roles and activator memberships.
- Self-service passkey naming, listing, adding, and removal.
- Session listing and revocation.
- Administrator-initiated passkey reset, session revocation, and emergency account disable controls.
- Auditing for authentication and recovery events.
- Rate limiting and enumeration-resistant responses.
- Production migration, staged routing changes, recovery, rollback, and operator documentation.
- Automated unit, D1 acceptance, browser WebAuthn, and legacy-compatibility tests.

### Non-Goals

- Password authentication.
- Social login or a third-party identity provider in the normal flow.
- Using a callsign as proof of identity.
- Removing email from signup or event communications.
- Deleting legacy edit-token APIs during the 2026 event.
- Requiring hardware-bound keys or attestation/AAGUID allowlists.
- Building organization-wide identity features unrelated to RI POTA participation.
- Publishing private authentication or account data in public APIs or generated files.

---

## Identity, Credentials, and Authorization

Authentication answers “which user is present?” Authorization answers “what may this user do?” Keep these concerns separate.

```text
Passkey assertion ───────────────┐
Short-lived email login ─────────┤
Existing private edit link ──────┼──> auth user ──> unified session
Existing activator session ──────┤                    │
Access bootstrap/recovery ───────┘                    ├── admin role
                                                       └── activator membership
```

### Identity

An auth user is a stable, site-wide principal. It is not event-specific and is not keyed by email. Email addresses are normalized, unique identity claims linked to a user and carry independent verification state.

### Passkey Credential

Store only the credential identifier, public key, WebAuthn user ID, signature counter, transports, device type, backup state, label, and timestamps. The private key never reaches the server.

Use the SimpleWebAuthn passkey recommendations:

- RP name: `RI POTA`
- Production RP ID: `ripota.org`
- Production expected origin: `https://ripota.org`
- `residentKey: "required"`
- `userVerification: "required"`
- `attestationType: "none"`
- Discoverable authentication with no username and no `allowCredentials` list.
- Verify the returned credential against the active credential row and update its signature counter after every successful assertion.

Local development uses `localhost` as the RP ID and the exact local Wrangler origin as the expected origin. Never allow arbitrary request Host or Origin values to become WebAuthn configuration.

References:

- <https://simplewebauthn.dev/docs/packages/server>
- <https://simplewebauthn.dev/docs/advanced/passkeys>
- <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>

### Session

Generate at least 256 bits of random session material. Store only its SHA-256 hash. The cookie is:

```text
__Host-ripota-session=<opaque token>; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600
```

Start with the existing 14-day duration. Sliding renewal is out of scope for the first release; issue a fresh session after reauthentication. Update `last_used_at` at a bounded cadence rather than on every request.

Each session stores:

- User ID.
- Purpose: `authenticated`, `enrollment`, or `recovery`.
- Authentication method: `passkey`, `email`, `legacy-link`, `legacy-session`, or `access-bootstrap`.
- Authentication timestamp.
- Most recent passkey verification timestamp, nullable.
- Expiry, last-use, and revocation timestamps.

`requireAdmin()` requires:

- Active authenticated session.
- Active event-scoped admin role.
- Non-disabled user.
- A non-null passkey verification timestamp within the configured admin reauthentication window, initially 12 hours.

`requireActivator()` requires:

- Active authenticated session.
- Non-disabled user.
- Active membership linking that user to the event activator row.

During the compatibility phase, `requireActivator()` may fall back to the legacy activator cookie. Admin APIs may fall back to Access only while `AUTH_ADMIN_MODE=dual`.

### Roles and Memberships

- Administrator privilege is an explicit row scoped to the Activate RI event.
- Activator authorization is a link to the existing `activate_ri_activators` row; it is not inferred from an email string on every request.
- One user may be both an administrator and an activator.
- One user may gain memberships in future events without registering another passkey.
- Disabling an auth user blocks every session and credential immediately without deleting event data.

---

## Proposed D1 Schema

Create `migrations/0012_unified_auth.sql`. Use constraints supported by both D1 and the repository’s `node:sqlite` test adapter.

```sql
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY,
  webauthn_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE auth_user_emails (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, email_normalized)
);

CREATE UNIQUE INDEX auth_user_emails_one_primary_idx
  ON auth_user_emails(user_id)
  WHERE is_primary = 1;

CREATE TABLE auth_passkey_credentials (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  transports_json TEXT NOT NULL DEFAULT '[]',
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX auth_passkeys_user_idx
  ON auth_passkey_credentials(user_id, revoked_at);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('authenticated', 'enrollment', 'recovery')),
  authentication_method TEXT NOT NULL CHECK (
    authentication_method IN ('passkey', 'email', 'legacy-link', 'legacy-session', 'access-bootstrap')
  ),
  authenticated_at TEXT NOT NULL,
  passkey_verified_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX auth_sessions_user_idx
  ON auth_sessions(user_id, revoked_at);

CREATE INDEX auth_sessions_expiry_idx
  ON auth_sessions(expires_at);

CREATE TABLE auth_webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL UNIQUE,
  ceremony TEXT NOT NULL CHECK (ceremony IN ('authentication', 'registration')),
  user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES auth_sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX auth_challenges_expiry_idx
  ON auth_webauthn_challenges(expires_at);

CREATE TABLE auth_email_tokens (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'account-claim', 'passkey-reset')),
  email_normalized TEXT NOT NULL,
  user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
  activator_id TEXT REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX auth_email_tokens_expiry_idx
  ON auth_email_tokens(expires_at);

CREATE TABLE auth_event_roles (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin')),
  granted_by_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (user_id, event_id, role)
);

CREATE TABLE auth_activator_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  activator_id TEXT NOT NULL REFERENCES activate_ri_activators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE UNIQUE INDEX auth_activator_membership_activator_idx
  ON auth_activator_memberships(event_id, activator_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX auth_activator_membership_user_idx
  ON auth_activator_memberships(event_id, user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE auth_audit_events (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  actor_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  subject_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX auth_audit_events_created_idx
  ON auth_audit_events(created_at);

CREATE INDEX auth_audit_events_subject_idx
  ON auth_audit_events(subject_user_id, created_at);
```

Implementation may split this into `0012_unified_auth.sql` and `0013_auth_memberships.sql` if reviewability or deployment testing benefits. Do not backfill users solely from submitted email addresses. Account creation and membership linking are lazy and require a trusted credential.

### Retention and Cleanup

- Authentication and registration challenges expire after 5 minutes and are single-use.
- Normal email login tokens expire after 15 minutes and are single-use.
- Admin-generated passkey-reset tokens expire after 30 minutes and are single-use.
- Expired challenges and email tokens may be deleted after 24 hours.
- Expired/revoked sessions may be deleted after 30 days.
- Revoked credential metadata and auth audit events should be retained through the event for incident review.
- Extend the existing scheduled Worker handler to perform bounded cleanup batches. Cleanup failure must not block scheduled POTA work.

---

## HTTP API

All auth JSON responses use `Cache-Control: private, no-store`. Mutation endpoints require the exact configured Origin except for top-level GET navigation and Cloudflare Access bootstrap callbacks. Never reflect detailed WebAuthn verification errors to the browser.

### Session and Identity

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `GET` | `/api/auth/session` | Optional | Returns signed-in state, display identity, available roles/memberships, authentication method, passkey assurance, and safe next routes. |
| `POST` | `/api/auth/logout` | Session | Revokes the current session and clears both unified and legacy cookies. |
| `GET` | `/api/auth/sessions` | Unified session | Lists safe session metadata for the current user. |
| `DELETE` | `/api/auth/sessions/<session-id>` | Passkey-authenticated session | Revokes one session. Never expose token hashes. |
| `POST` | `/api/auth/sessions/revoke-others` | Passkey-authenticated session | Revokes every other session for the current user. |

Use the session `id` for management routes. Never expose `token_hash`.

### Passkey Authentication

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/auth/passkey/authentication/options` | Public | Creates a 5-minute discoverable-authentication challenge. No email is required. |
| `POST` | `/api/auth/passkey/authentication/verify` | Public | Atomically consumes the challenge, verifies the assertion and active credential, updates the counter, and issues an authenticated unified session. |

Authentication options must use no `allowCredentials`, enabling the browser or authenticator to select an account. Verification finds the credential by returned credential ID, then finds its user. Return a generic authentication failure for unknown, revoked, disabled, wrong-origin, replayed, or invalid assertions.

### Passkey Registration and Management

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/auth/passkeys/registration/options` | Authenticated, enrollment, or recovery session | Creates a registration challenge for the current user and excludes that user’s active credential IDs. |
| `POST` | `/api/auth/passkeys/registration/verify` | Same session | Verifies and stores a new credential. Recovery completion atomically revokes replaced credentials and other sessions. |
| `GET` | `/api/auth/passkeys` | Unified session | Lists credential ID surrogate, label, type, backup state, and created/last-used timestamps. |
| `PATCH` | `/api/auth/passkeys/<passkey-id>` | Passkey-authenticated session | Renames a credential using its opaque management ID. |
| `DELETE` | `/api/auth/passkeys/<passkey-id>` | Passkey-authenticated session | Revokes a credential using its opaque management ID, preventing deletion of the final credential unless an active verified recovery method exists. |

Do not return public-key bytes, WebAuthn user IDs, counters, raw credential IDs where avoidable, challenge values after use, or transports that do not help the user identify a credential.

### Email Login and Claim

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/auth/email-login` | Public + Turnstile/rate limit | Accepts an email and always returns the same success-shaped response. If a matching activator/account exists, sends a short-lived fragment link. |
| `POST` | `/api/auth/email-login/consume` | Public | Atomically consumes a short-lived token, verifies/creates the email claim, links the matching activator if safe, and issues an authenticated email session. |
| `POST` | `/api/auth/legacy/upgrade-session` | Legacy activator session | Creates/links the auth user and membership, issues the unified session, and clears the legacy cookie. |
| `POST` | `/api/auth/legacy/consume-edit-token` | Public | Validates an existing reusable edit token and issues a unified legacy-link session without invalidating the edit token. |

Email-login links use `/account/access/#<raw-token>` so the bearer token is not sent in the initial HTTP request or server logs. The static page removes the fragment immediately and POSTs it to the consume endpoint, matching the current secure-fragment pattern.

The generic request response is:

```json
{
  "ok": true,
  "message": "If we found an account that can use email sign-in, we sent a link."
}
```

The email sender and API must not reveal whether an address belongs to an activator, admin, disabled user, or nonexistent account.

### Admin Account Security

Expose an event-scoped account list containing only users who have an event role or activator membership. Opaque auth user IDs are acceptable management identifiers; they are not credentials. Never allow an event admin to manage an account with no relationship to that event.

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `GET` | `/api/activate-ri-2026/admin/accounts` | Recent admin passkey | Lists safe auth status for event admins and claimed activators, plus unclaimed activator status. |
| `GET` | `/api/activate-ri-2026/admin/accounts/<user-id>` | Recent admin passkey | Returns roles/membership, passkey count, safe last-use date, and active-session count. |
| `POST` | `/api/activate-ri-2026/admin/accounts/<user-id>/passkey-reset` | Recent admin passkey + confirmation | Sends a non-destructive, short-lived passkey-reset link to the verified primary email and writes audit events. |
| `POST` | `/api/activate-ri-2026/admin/accounts/<user-id>/revoke-auth-sessions` | Recent admin passkey + confirmation | Immediately revokes unified and related legacy sessions but leaves passkeys intact. |
| `POST` | `/api/activate-ri-2026/admin/accounts/<user-id>/disable-auth` | Recent admin passkey + stronger confirmation | Disables the auth user and revokes all sessions and passkeys. This is emergency-only. |

“Send passkey reset” does not revoke existing passkeys when requested. The reset email establishes a recovery-purpose session. After the user successfully creates a replacement passkey, one transaction must:

1. Insert the replacement credential.
2. Revoke all older active credentials.
3. Revoke all other active unified and legacy sessions.
4. Promote or replace the recovery session with a passkey-authenticated session.
5. Mark the reset token and challenge used.
6. Write `passkey-reset-completed` audit events.

If email delivery fails, leave existing access untouched and report only delivery status to the administrator.

### Access Bootstrap and Break-Glass

Keep Cloudflare Access only on narrow paths such as:

- `/activate-ri-2026/admin/recovery*`
- `/api/auth/access-bootstrap/*`

The Worker continues to validate the Access JWT and also checks the normalized email against a dedicated bootstrap/recovery secret or existing admin role. A successful Access login creates only an enrollment/recovery session, not a directly admin-authorized session. The user must register and verify a passkey before `requireAdmin()` succeeds.

Do not reuse `ACTIVATE_RI_ADMIN_EMAILS` for authorization; it is a notification list. Add a separately managed secret such as `AUTH_BOOTSTRAP_ADMIN_EMAILS`, document its temporary or break-glass purpose, and never commit its value.

---

## User Experience

### Shared Sign-In Page

Create `/account/sign-in/` with:

1. Primary **Sign in with a passkey** button.
2. Optional conditional passkey/autofill initiation where browser support is reliable; the explicit button remains authoritative.
3. Secondary **Email me a sign-in link** disclosure and form.
4. Clear Android guidance: use the device passkey/fingerprint prompt; no app install is required.
5. Generic, enumeration-resistant email confirmation.
6. Graceful messages for cancellation, unsupported browsers, expired ceremonies, and missing credentials.

After authentication, honor only validated same-origin relative return paths. Default routing is:

- Admin-only user: admin workspace.
- Activator-only user: activator portal.
- Dual-role user: an account landing page with both destinations, or the originally requested destination.

### Account Security Page

Create `/account/security/` with:

- Passkey list and friendly labels.
- Add another passkey.
- Rename passkey.
- Remove passkey with last-credential protection.
- Session list and revoke controls.
- Verified primary email display.
- Email-login explanation for activators.
- Clear warning that email login alone does not authorize admin operations.

Recommend at least two recovery-capable credentials, but do not require a physical security key. Synced Android/iCloud passkeys count as backed-up credentials when reported by WebAuthn.

### Existing Activator

- If a valid unified session exists, enter the portal normally.
- If only a legacy activator session exists, continue to allow the portal and show a one-time passkey enrollment banner. Upgrade only after explicit action or successful passkey creation.
- If the user opens an existing private link, exchange it into a unified session and show the enrollment banner. The bookmarked link remains valid under its current revocation semantics.
- If the user prefers email login, the portal access page can send a new short-lived sign-in link.

### New Activator

The initial submitted email is not automatically trusted. After submission:

- Continue sending the current receipt/private-link email during migration.
- Present “Already have an RI POTA account? Sign in with a passkey” before or after submission so returning users can associate the plan without another email round trip.
- First-time users claim the plan through the delivered link, which verifies email control, creates the membership, and prompts for passkey enrollment.
- Once claimed, future plans/events can attach to the signed-in user without another authentication email.

Do not let an anonymous submission attach itself to an existing user merely because its entered email matches. This protects against account squatting and cross-user plan access.

### Activator Email Login

- Email login remains visible and supported indefinitely.
- The requested link is short-lived and single-use, unlike existing reusable private links.
- Consuming it verifies the email claim, creates a normal authenticated session, and permits activator access.
- If the user is also an admin, the same session does not satisfy admin passkey assurance.
- Prompt users without a passkey to create one, but do not require it for activator access.

### Administrator

- Normal admin navigation redirects an unauthenticated browser to the shared sign-in page.
- A passkey-authenticated admin enters the workspace directly.
- If admin passkey assurance is older than 12 hours, prompt for passkey reauthentication and return to the requested admin route.
- Account-security actions and user reset operations also require recent passkey assurance.
- Admins can view safe auth status for event administrators and activators, send a reset link, revoke sessions, or perform emergency disable. They cannot view public keys, raw tokens, or impersonate the user.

---

## Security Requirements

### WebAuthn Ceremony

- Generate every challenge server-side with approved library functions.
- Persist the challenge and ceremony context before returning options.
- Require exact RP ID and expected Origin.
- Require user verification for registration and authentication.
- Atomically mark challenges used; reject replay even if the assertion is otherwise valid.
- Reject expired, wrong-ceremony, wrong-session, unknown-credential, revoked-credential, and disabled-user responses uniformly.
- Store credential public keys as D1 BLOB values and convert retrieved data to `Uint8Array` before verification.
- Update signature counters after authentication using the verifier’s returned counter.
- Do not request direct attestation in the initial implementation.

### Session and CSRF

- Store only session hashes.
- Use the `__Host-` cookie prefix, `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`.
- Rotate the session token after every successful authentication, email-token consumption, legacy upgrade, passkey enrollment from recovery, and privilege transition.
- Require exact Origin on all state changes, including credential and session management.
- Use `Cache-Control: private, no-store` on private pages and auth responses.
- Never place session tokens in URLs or browser storage.

### Email Tokens

- Generate at least 256 random bits and store only SHA-256 hashes.
- Put raw tokens in URL fragments.
- Make new email login and reset tokens short-lived and single-use.
- Invalidate outstanding tokens of the same purpose when issuing a replacement where appropriate.
- Return identical request responses regardless of account existence.
- Rate-limit by a nonpersisted hash of normalized email and connecting network signal.
- Do not log email tokens, fragments, WebAuthn responses, session tokens, or credential public keys.

### Authorization

- Never infer admin authorization from `ACTIVATE_RI_ADMIN_EMAILS`.
- Never infer activator membership solely from an unverified submitted email.
- Check current database role/membership and disabled state on each protected request.
- Require passkey assurance for every admin API, admin WebSocket bootstrap, and admin page.
- Preserve exact-Origin checks on all current state-changing event APIs.
- Treat an email-authenticated dual-role user as an activator until passkey reauthentication.

### Recovery and Abuse

- Admin reset links are non-destructive until replacement registration succeeds.
- Immediate disable/revoke is separate, clearly labeled, confirmed, and audited.
- Self-service credential deletion cannot remove the last passkey unless another safe recovery path is confirmed.
- Add auth-specific rate-limit bindings instead of consuming Ops Room mutation quotas.
- Turnstile protects email-link request endpoints, not passkey assertions.
- Audit success and security-relevant failure categories without storing credential material or bearer values.

---

## Audit Events

At minimum, write these actions to `auth_audit_events`:

- `user-created`
- `email-verified`
- `activator-membership-linked`
- `admin-role-granted`
- `admin-role-revoked`
- `passkey-registered`
- `passkey-renamed`
- `passkey-revoked`
- `passkey-authenticated`
- `email-login-requested` using a non-identifying summary for nonexistent accounts
- `email-login-consumed`
- `legacy-link-consumed`
- `legacy-session-upgraded`
- `session-revoked`
- `all-other-sessions-revoked`
- `passkey-reset-requested`
- `passkey-reset-completed`
- `user-disabled`
- `user-enabled`
- `access-bootstrap-used`

For administrator actions involving an activator, also add a concise existing Activate RI activity event when a suitable plan/activator context exists so organizers can see the action in the current activity UI.

---

## Feature Flags and Runtime Configuration

Add typed Worker variables with safe legacy defaults:

```ts
AUTH_ADMIN_MODE?: "access" | "dual" | "passkey";
AUTH_ACTIVATOR_MODE?: "legacy" | "dual" | "unified";
AUTH_EMAIL_LOGIN_ENABLED?: "true" | "false";
AUTH_BOOTSTRAP_ADMIN_EMAILS?: string;
AUTH_ADMIN_REAUTH_SECONDS?: string;
```

Defaults when absent:

- `AUTH_ADMIN_MODE="access"`
- `AUTH_ACTIVATOR_MODE="legacy"`
- `AUTH_EMAIL_LOGIN_ENABLED="false"`
- Admin reauthentication: 12 hours

Add auth-specific rate-limit bindings, with final namespace IDs configured in `wrangler.jsonc`:

- `AUTH_RATE_LIMIT_BURST`
- `AUTH_EMAIL_RATE_LIMIT`

The implementation must fail closed if passkey mode is enabled without a valid production `SITE_ORIGIN`, RP ID derivation, D1 binding, or required rate-limit binding.

---

## File Structure

Expected files; adjust names only if implementation discovers a clearer boundary.

### Create

- `migrations/0012_unified_auth.sql`
- `src/worker/auth/types.ts`
- `src/worker/auth/config.ts`
- `src/worker/auth/db.ts`
- `src/worker/auth/session.ts`
- `src/worker/auth/authorization.ts`
- `src/worker/auth/passkeys.ts`
- `src/worker/auth/email-login.ts`
- `src/worker/auth/legacy.ts`
- `src/worker/auth/audit.ts`
- `src/worker/routes/auth.ts`
- `src/worker/auth/*.test.ts` for focused utility/data tests
- `src/worker/auth.acceptance.test.ts`
- `src/components/auth/SignInPanel.astro`
- `src/components/auth/PasskeyManager.astro`
- `src/components/auth/SessionManager.astro`
- `src/components/activate-ri/AdminAccountSecurity.astro`
- `src/pages/account/sign-in.astro`
- `src/pages/account/access.astro`
- `src/pages/account/security.astro`
- `src/pages/activate-ri-2026/admin/recovery.astro`
- `e2e/activate-ri-auth.spec.ts`
- `docs/activate-ri-2026/authentication.md`

### Modify

- `package.json` and `package-lock.json`
- `migrations` list in `src/worker/test-utils/sqlite-d1.ts`
- `src/worker/env.ts`
- `wrangler.jsonc`
- `src/worker/index.ts`
- `src/worker/routes/activate-ri.ts`
- `src/worker/routes/activate-ri-admin-ops.ts`
- `src/worker/routes/activate-ri-ops.ts`
- `src/worker/routes/activate-ri-ops-socket.ts`
- `src/worker/access.ts`
- `src/worker/activator-session.ts`
- `src/worker/db.ts`
- `src/worker/email.ts`
- `src/components/activate-ri/ActivatorPortalNav.astro`
- `src/components/activate-ri/EditLinkResendForm.astro`
- `src/components/activate-ri/AdminOpsMembers.astro`
- `src/pages/activate-ri-2026/access.astro`
- `src/pages/activate-ri-2026/activators/index.astro`
- `src/pages/activate-ri-2026/activators/plan.astro`
- `src/pages/activate-ri-2026/admin.astro`
- Existing unit, route, acceptance, and E2E tests.
- `docs/cloudflare-access.md`
- `docs/activate-ri-2026/data-flow.md`
- `docs/activate-ri-2026/email-flow-and-setup.md`
- `docs/deployment.md`
- `README.md`

Do not remove legacy files in this project. Mark compatibility-only code clearly and give it an explicit removal condition after the event and after telemetry confirms no use.

---

## Implementation Phases and Tasks

### Phase 0: Lock Security Contracts With Tests

#### Task 0.1: Add auth configuration tests

**Files:** Create `src/worker/auth/config.test.ts`; create `src/worker/auth/config.ts`; modify `src/worker/env.ts`.

- [ ] Test production RP ID and expected Origin derive only from the configured production site origin.
- [ ] Test localhost configuration uses `localhost` and the exact local origin.
- [ ] Test untrusted Host/Origin headers cannot alter RP settings.
- [ ] Test missing/invalid config fails closed when passkey mode is active.
- [ ] Add typed feature flags with legacy-safe defaults.

Run:

```bash
rtk mise run test-unit -- src/worker/auth/config.test.ts
```

#### Task 0.2: Add authorization contract tests

**Files:** Create `src/worker/auth/authorization.test.ts`; create `src/worker/auth/types.ts`.

- [ ] Pin that passkey + admin role authorizes admin access.
- [ ] Pin that email + admin role does not authorize admin access.
- [ ] Pin that email + activator membership authorizes activator access.
- [ ] Pin dual-role behavior.
- [ ] Pin disabled user, revoked role, revoked membership, stale admin assurance, enrollment session, and recovery session behavior.
- [ ] Pin safe `401`, `403`, and reauthentication responses.

### Phase 1: Additive Schema and Data Layer

#### Task 1.1: Add the D1 migration

**Files:** Create `migrations/0012_unified_auth.sql`; modify `src/worker/test-utils/sqlite-d1.ts`.

- [ ] Add all unified auth tables, constraints, and indexes.
- [ ] Append the migration to the real-SQL test migration list.
- [ ] Add a schema acceptance test covering foreign keys, unique email ownership, one active event membership per user, BLOB public-key round trips, and transaction rollback.
- [ ] Confirm the migration is additive and does not modify existing edit tokens or sessions.

#### Task 1.2: Implement auth data access

**Files:** Create `src/worker/auth/db.ts`, `audit.ts`, and focused tests.

- [ ] Implement user creation/lookup by ID and verified normalized email.
- [ ] Implement safe email verification and conflict handling.
- [ ] Implement passkey storage and active lookup by credential ID.
- [ ] Implement role and activator-membership lookup/grant/revoke.
- [ ] Implement session, challenge, email-token, reset, and audit operations.
- [ ] Use D1 batches or explicit atomic statements where ceremony replay or account linking could race.
- [ ] Never return raw token hashes through DTOs.

#### Task 1.3: Implement unified sessions

**Files:** Create `src/worker/auth/session.ts` and tests.

- [ ] Generate opaque tokens, hash before storage, and issue the strict `__Host-ripota-session` cookie.
- [ ] Look up active sessions with user disabled state.
- [ ] Implement current, selected, other, and all-session revocation.
- [ ] Implement bounded `last_used_at` updates.
- [ ] Implement rotation and cookie clearing.
- [ ] Add tests matching the security attributes already expected from activator cookies.

Verification:

```bash
rtk mise run test-unit -- src/worker/auth
rtk mise run check
```

### Phase 2: Passkey Ceremonies

#### Task 2.1: Add SimpleWebAuthn dependencies

**Files:** Modify `package.json` and `package-lock.json`.

- [ ] Add compatible pinned versions of `@simplewebauthn/server` and `@simplewebauthn/browser`.
- [ ] Confirm the server bundle works under the configured Cloudflare Workers compatibility date without broad `nodejs_compat` unless the library demonstrably requires it.
- [ ] Record any excluded algorithms only if Workers verification testing proves necessary.

#### Task 2.2: Implement authentication options and verification

**Files:** Create `src/worker/auth/passkeys.ts`, `src/worker/routes/auth.ts`, and tests; modify `src/worker/index.ts`.

- [ ] Create discoverable authentication options without accepting an email.
- [ ] Persist a five-minute challenge before returning it.
- [ ] Verify exact challenge, Origin, RP ID, user verification, active credential, and active user.
- [ ] Atomically consume challenge, update counter/last-use, audit, and issue the unified session.
- [ ] Return generic failures and private no-store responses.
- [ ] Add replay, wrong-origin, wrong-RP, unknown credential, revoked credential, disabled user, and counter tests.

#### Task 2.3: Implement registration options and verification

- [ ] Require an authenticated/enrollment/recovery session with a bound user.
- [ ] Exclude existing active credentials for that user.
- [ ] Generate a stable random WebAuthn user ID per user and reuse it across credentials.
- [ ] Require discoverable credential and user verification.
- [ ] Store public key BLOB, counter, transports, device type, and backup state.
- [ ] Rotate/promote the session after registration.
- [ ] Implement recovery completion atomically.
- [ ] Add cross-user, duplicate credential, challenge replay, and recovery transaction tests.

### Phase 3: Shared Account UI

#### Task 3.1: Build the sign-in and token-consumption pages

**Files:** Create `src/pages/account/sign-in.astro`, `src/pages/account/access.astro`, and `src/components/auth/SignInPanel.astro`; add component tests.

- [ ] Implement explicit passkey sign-in with `@simplewebauthn/browser`.
- [ ] Keep the explicit button even if conditional mediation is added.
- [ ] Add the secondary email-login form behind a clear disclosure.
- [ ] Remove bearer fragments from the address bar before token exchange.
- [ ] Validate return destinations as same-origin relative paths.
- [ ] Provide accessible progress, cancellation, expiration, unsupported-browser, and generic failure states.
- [ ] Ensure no auth payload reaches analytics, logs, or public cache.

#### Task 3.2: Build account security management

**Files:** Create `/account/security/` and passkey/session manager components and tests.

- [ ] List safe credential metadata.
- [ ] Add, rename, and revoke credentials.
- [ ] Prevent unsafe last-passkey deletion.
- [ ] List/revoke sessions without exposing hashes.
- [ ] Display verified email and current authentication method.
- [ ] Prompt an email-authenticated user to add a passkey without blocking activator access.
- [ ] Require passkey reauthentication for destructive account-security actions.

### Phase 4: Activator Email Login and Legacy Compatibility

#### Task 4.1: Implement enumeration-safe email login

**Files:** Create `src/worker/auth/email-login.ts`; modify `src/worker/email.ts`, `wrangler.jsonc`, and auth routes; add tests.

- [ ] Add Turnstile verification and dedicated email/auth rate limiting.
- [ ] Always return the same public response.
- [ ] Create only hashed, 15-minute, single-use tokens.
- [ ] Send fragment-based access links.
- [ ] On consume, verify or create the email claim, safely link the matching activator, issue an email-authenticated session, and audit.
- [ ] Verify that a matching admin role does not make the session admin-authorized.
- [ ] Test nonexistent, disabled, malformed, expired, replayed, and delivery-failure cases.

#### Task 4.2: Upgrade current activator sessions

**Files:** Create `src/worker/auth/legacy.ts`; modify `src/worker/activator-session.ts`, `src/worker/routes/activate-ri.ts`, and tests.

- [ ] Treat a valid legacy activator session as sufficient proof to create/link the corresponding auth user and membership.
- [ ] Issue the unified session and clear the legacy cookie only after success.
- [ ] Keep legacy session behavior unchanged if the upgrade fails.
- [ ] Show a passkey enrollment prompt to legacy-session users.
- [ ] Continue accepting legacy sessions while `AUTH_ACTIVATOR_MODE` is `legacy` or `dual`.

#### Task 4.3: Preserve every existing private link

**Files:** Modify `src/worker/index.ts`, `src/pages/activate-ri-2026/access.astro`, auth routes, and compatibility tests.

- [ ] Existing `/activate-ri-2026/access/#<token>` links continue to exchange successfully.
- [ ] Existing `/activate-ri-2026/edit/<token>/` links continue to redirect successfully.
- [ ] Do not consume, rotate, or revoke a reusable legacy token merely because it was used.
- [ ] In dual/unified mode, a successful exchange creates the auth user/membership as needed and issues the unified cookie.
- [ ] Keep legacy token API adapters operational.
- [ ] Ensure admin “replace secure links” retains its current explicit rotation semantics.
- [ ] Add tests proving old links created before the migration work after it.

#### Task 4.4: Update the activator portal

**Files:** Modify activator pages, portal navigation, resend form, Ops Room auth helpers, and tests.

- [ ] Route unauthenticated users to the shared sign-in page with an activator return path.
- [ ] Keep an obvious email-login option.
- [ ] Replace “reopen your private link” as the only recovery instruction with passkey/email choices.
- [ ] Resolve activator identity from unified membership first and legacy session second in dual mode.
- [ ] Update Ops HTTP and WebSocket authorization to accept unified membership.
- [ ] Preserve current plan editing, cancellation, room membership, mutation-origin, and rate-limit behavior.

### Phase 5: Administrator Passkeys and Authorization

#### Task 5.1: Implement Access-protected admin enrollment

**Files:** Modify `src/worker/access.ts`, create recovery page/API, modify docs and tests.

- [ ] Keep current Access JWT verification isolated as a bootstrap/break-glass credential.
- [ ] Require both valid Access identity and a dedicated bootstrap allowlist/existing admin role.
- [ ] Create/verify the auth email, grant the event admin role when explicitly allowed, and issue an enrollment session.
- [ ] Require passkey registration before granting normal admin access.
- [ ] Audit bootstrap and role grant.
- [ ] Test forged header, invalid JWT, wrong audience, absent allowlist, and already-enrolled behavior.

#### Task 5.2: Replace admin authorization helpers

**Files:** Create `src/worker/auth/authorization.ts`; modify all admin route modules, `src/worker/index.ts`, and tests.

- [ ] Replace direct `requireAccessIdentity()` calls with `requireAdmin()`.
- [ ] Preserve `identity.email` for current audit/email behavior by resolving the verified primary email from the auth user.
- [ ] Require recent passkey assurance for admin page, API, Ops Room, and WebSocket paths.
- [ ] In dual mode, accept Access for current production continuity, but prefer unified admin sessions.
- [ ] Return browser navigation redirects for pages and JSON `401`/reauthentication responses for APIs.
- [ ] Verify every current admin endpoint remains protected.

#### Task 5.3: Reconfigure Cloudflare Access safely

This is an operator step after code and passkey enrollment are verified.

- [ ] Confirm at least two administrators have working passkeys and a backup credential.
- [ ] Confirm the break-glass route works in a private browser.
- [ ] Change the Access application from `/activate-ri-2026/admin*` and `/api/activate-ri-2026/admin/*` to only the narrow recovery/bootstrap paths.
- [ ] Set `AUTH_ADMIN_MODE=dual` before removing the broad Access route.
- [ ] Verify an unauthenticated normal admin request reaches the Worker and redirects to `/account/sign-in/`, not the admin asset.
- [ ] Verify admin APIs return unauthorized without a unified session.
- [ ] Verify passkey login grants admin access.
- [ ] After a stabilization window, set `AUTH_ADMIN_MODE=passkey`.

There must be no interval in which broad Access protection is removed while the deployed Worker still serves the admin asset/API without `requireAdmin()`.

### Phase 6: Admin Reset and Emergency Controls

#### Task 6.1: Add account security status to the admin UI

**Files:** Create `AdminAccountSecurity.astro`; modify the admin workspace, `AdminOpsMembers.astro`, and admin APIs/tests.

- [ ] List every event administrator and claimed activator account, and show unclaimed state for activators without an account.
- [ ] Show roles/membership, active passkey count, last passkey use, and active-session count.
- [ ] Do not expose credential IDs, public keys, token state, or detailed device fingerprints.
- [ ] Add actions for send reset link, revoke sessions, and emergency disable.
- [ ] Use distinct confirmation language and visual severity.
- [ ] Ensure an admin cannot target an unrelated site-wide user lacking an Activate RI role or membership.

#### Task 6.2: Implement non-destructive passkey reset

- [ ] Require recent admin passkey assurance.
- [ ] Create one 30-minute, single-use reset token and invalidate older unused reset tokens.
- [ ] Send the link only to the verified primary email.
- [ ] Leave existing credentials and sessions working until reset completion.
- [ ] On completion, atomically install the replacement and revoke old credentials/sessions.
- [ ] If delivery fails, leave access untouched and allow retry.
- [ ] Audit request, delivery status, and completion.
- [ ] Test cross-user use, token replay, challenge replay, failure rollback, and concurrent completion.

#### Task 6.3: Implement session revocation and emergency disable

- [ ] Session revocation invalidates unified and legacy sessions for the activator but leaves credentials usable for a new login.
- [ ] Emergency disable marks the auth user disabled and revokes every unified session and credential, plus legacy sessions and outstanding email/reset tokens.
- [ ] Keep event plans, stops, messages, and audit history intact.
- [ ] Require a typed callsign or similarly strong confirmation for emergency disable.
- [ ] Warn if the account also carries an admin role.
- [ ] Provide a separately audited re-enable flow requiring an admin passkey and subsequent user recovery.

### Phase 7: Volunteer and Returning-User Integration

#### Task 7.1: Allow optional sign-in before submission

**Files:** Modify volunteer page/form and tests.

- [ ] Show current account state and an optional “Sign in with a passkey” action.
- [ ] If signed in as a verified matching user, associate the submitted/upserted activator safely.
- [ ] If anonymous, preserve the current submission and email-link behavior.
- [ ] Never attach to an existing account based only on the submitted email string.
- [ ] Test matching signed-in user, mismatched email, existing unclaimed activator, existing claimed activator, and anonymous submission.

#### Task 7.2: Update transactional email copy

- [ ] Explain that the existing private link still works.
- [ ] Encourage passkey setup after claim without implying it is mandatory for activators.
- [ ] Add the shared sign-in URL for users who already created a passkey.
- [ ] Preserve event help, schedule, unofficial-site disclaimer, and official POTA source-of-truth language.

### Phase 8: Cleanup, Observability, and Operator Tasks

#### Task 8.1: Add bounded scheduled cleanup

- [ ] Delete expired challenges and old consumed email tokens in bounded batches.
- [ ] Delete old expired/revoked sessions according to retention.
- [ ] Preserve credential and audit history through the event.
- [ ] Ensure cleanup errors are logged with categories and do not stop existing POTA scheduled work.

#### Task 8.2: Add operator documentation and mise tasks

**Files:** Create `docs/activate-ri-2026/authentication.md`; update deployment/data-flow/email/Access docs; add file-based tasks only where automation is justified.

- [ ] Document enrollment, normal login, activator email login, reset, emergency disable, Access break-glass, and logout.
- [ ] Document all feature-flag transitions and exact Cloudflare Access path changes.
- [ ] Document how to inspect auth health without displaying secrets.
- [ ] Add a safe task for local auth-data reset if needed; it must target local data by default and require an explicit `--remote` plus confirmation for production.
- [ ] Add a bounded auth cleanup task only if the scheduled path is insufficient for incident response.
- [ ] Do not place admin email values in task files or repository configuration.

### Phase 9: Full Verification and Production Rollout

#### Task 9.1: Add D1 acceptance coverage

**Files:** Create `src/worker/auth.acceptance.test.ts`; modify current acceptance tests.

- [ ] Apply every real migration.
- [ ] Claim an existing activator with an old edit link.
- [ ] Upgrade an old activator session.
- [ ] Register/authenticate a passkey through an injectable verifier boundary for deterministic API tests.
- [ ] Exercise email login, replay rejection, membership authorization, admin assurance, reset, revocation, and disable transactions.
- [ ] Prove existing volunteer, approval, edit, Ops Room, and public-data flows remain unchanged.

#### Task 9.2: Add real browser WebAuthn coverage

**Files:** Create `e2e/activate-ri-auth.spec.ts`; modify the E2E server helper.

- [ ] Use Chromium’s virtual authenticator support for a real WebAuthn registration and assertion.
- [ ] Test admin passkey login after Access bootstrap fixture setup.
- [ ] Test activator claim → passkey enrollment → logout → passkey login.
- [ ] Test activator email-only login.
- [ ] Test an existing private link after unified auth is enabled.
- [ ] Test reset completion revokes the previous credential/session.
- [ ] Test dual-role email login cannot open admin APIs until passkey verification.
- [ ] Keep existing browser suites passing.

#### Task 9.3: Manual device matrix

- [ ] Android 9+ with Chrome and Google Password Manager synced passkey.
- [ ] Current iOS Safari/iCloud Keychain.
- [ ] Current macOS Safari or Chrome.
- [ ] Current Windows Edge/Chrome with Windows Hello where available.
- [ ] External FIDO2 security key.
- [ ] Cross-device/hybrid QR authentication.
- [ ] Email fallback in Android Gmail and at least one non-Gmail client.
- [ ] Private/incognito browser behavior.

#### Task 9.4: Final automated verification

Run:

```bash
rtk mise run test-unit
rtk mise run check
rtk mise run e2e:activate-ri
rtk mise run build
rtk mise run deploy -- --dry-run
```

Expected: all unit, real-SQL acceptance, Astro/type, browser, build, and deployment dry-run checks pass.

---

## Production Rollout Runbook

### Stage A: Additive Foundation

1. Back up production with `rtk mise run backup-production`.
2. Deploy migration and dormant auth code with legacy defaults.
3. Verify migration state and existing admin/activator behavior.
4. Confirm no public routing or cookie behavior changed.

### Stage B: Admin Enrollment Behind Access

1. Configure the dedicated bootstrap-admin secret outside the repository.
2. Set `AUTH_ADMIN_MODE=dual`; keep broad Access protection in place.
3. Enroll at least two administrators.
4. Require each administrator to add a second credential or verify the break-glass path.
5. Exercise account security, session revocation, and reauthentication.

### Stage C: Activator Opt-In

1. Set `AUTH_ACTIVATOR_MODE=dual` and `AUTH_EMAIL_LOGIN_ENABLED=true`.
2. Keep all legacy links and sessions enabled.
3. Let current activators upgrade and enroll passkeys.
4. Verify email fallback and Ops Room behavior.
5. Monitor auth audit events and categorized failures.

### Stage D: Normal Admin Cutover

1. Confirm the deployed Worker requires unified admin authorization independently of Access.
2. Narrow the Cloudflare Access application to recovery/bootstrap paths.
3. Verify unauthenticated page, API, and WebSocket requests fail safely.
4. Verify passkey admin login on desktop and Android.
5. Keep `AUTH_ADMIN_MODE=dual` during the stabilization window.
6. Move to `AUTH_ADMIN_MODE=passkey` only after successful verification.

### Stage E: Unified Activator Default

1. Change portal navigation to the shared sign-in page.
2. Set `AUTH_ACTIVATOR_MODE=unified` while keeping explicit legacy-link consumption enabled.
3. Continue accepting existing private links and legacy token APIs for the event.
4. Stop issuing new long-lived private links only after new short-lived email login is proven reliable; existing links remain valid.

### Stage F: Stabilization

1. Review failed/replayed ceremony counts, email delivery status, reset events, and Access break-glass use.
2. Confirm no admin is operating solely through Access fallback.
3. Confirm activator support requests can be resolved through email login or admin reset.
4. Document any browser-specific behavior discovered in the manual matrix.

---

## Rollback Plan

Rollback does not reverse D1 migrations.

### Before Access Cutover

- Set `AUTH_ADMIN_MODE=access` and `AUTH_ACTIVATOR_MODE=legacy`.
- Disable email login if needed.
- Redeploy the previous-compatible Worker.
- Unified auth tables remain unused and harmless.

### After Access Cutover

1. Restore the broad Cloudflare Access paths before or at the same time as reverting the Worker.
2. Set `AUTH_ADMIN_MODE=access`.
3. Keep legacy activator authentication enabled.
4. Redeploy through `mise run deploy`.
5. Verify private-browser admin Access and legacy activator links.

### Partial Feature Failure

- Passkey failure: leave email login enabled for activators; restore Access for admins.
- Email delivery failure: passkeys continue; existing private links continue.
- Membership-linking failure: legacy sessions/links continue in dual mode.
- Reset-flow failure: existing passkeys remain active because reset is non-destructive until completion.
- Cleanup failure: expired records remain inert because every lookup checks expiry and used/revoked state.

---

## Acceptance Criteria

### Unified Identity

- [ ] One user can have admin and activator authorization simultaneously.
- [ ] Both roles use the same `__Host-ripota-session` cookie.
- [ ] Authorization is resolved server-side from current D1 state.
- [ ] A disabled user cannot use any session or passkey.

### Passkeys

- [ ] A user can register multiple discoverable credentials.
- [ ] Android can register and use a synced passkey without an email round trip after enrollment.
- [ ] Passkey login requires no email/username entry.
- [ ] Wrong Origin/RP, replay, revoked credential, and disabled-user assertions fail.
- [ ] Credential counters and safe last-use metadata update.

### Activators

- [ ] Every existing private link still opens the correct activator portal.
- [ ] Existing 14-day sessions continue until expiry or explicit upgrade/revocation.
- [ ] A current activator can enroll a passkey without requesting another email.
- [ ] An activator can always choose a short-lived email sign-in link.
- [ ] Email request responses do not reveal account existence.
- [ ] Plan editing, cancellation, Ops Room, and WebSocket access work through unified membership.

### Administrators

- [ ] Normal admin access no longer requires an email OTP/link.
- [ ] Every admin page/API/WebSocket requires an active role and recent passkey assurance.
- [ ] Email authentication alone never authorizes an admin action.
- [ ] At least two admins and a break-glass recovery path are verified before broad Access removal.
- [ ] Admins can send a passkey reset, revoke sessions, and emergency-disable access.
- [ ] Reset email failure does not destroy existing access.
- [ ] Completed reset atomically revokes previous credentials and sessions.

### Security and Operations

- [ ] Raw passkey private material, session tokens, email tokens, and credential public keys never appear in logs or API DTOs.
- [ ] Auth responses are private/no-store and mutations require exact Origin.
- [ ] Email and challenge endpoints are rate-limited and replay-resistant.
- [ ] Auth and administrator recovery actions are auditable.
- [ ] Full unit, D1 acceptance, browser, type, build, and dry-run deploy checks pass.
- [ ] Rollback restores Access/legacy behavior without database rollback.

---

## Definition of Done

The work is complete when administrators and enrolled activators can use passkeys as their normal sign-in, activators can still choose email login, every previously issued private link remains functional, current legacy sessions migrate without interruption, administrators have safe reset/revocation controls, Access is narrowed to a tested break-glass path, and all security, compatibility, browser, migration, deployment, and rollback acceptance criteria above are verified in production.
