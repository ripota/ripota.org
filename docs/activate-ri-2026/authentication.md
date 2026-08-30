# Activate RI Authentication

Activate RI uses one D1-backed identity and session system for administrators
and activators. Passkeys are the durable sign-in method. Existing activator
private links and Cloudflare Access remain compatibility and recovery paths
during rollout.

This is an RI POTA community service, not an official Parks on the Air system.
POTA accounts and credentials are never used here.

## Authentication Model

- A user has one or more verified email addresses and zero or more passkeys.
- A user may have an event-scoped `admin` role, an activator membership, or both.
- Passkeys are discoverable credentials with user verification required. The
  relying-party ID is derived from the exact configured `SITE_ORIGIN`.
- Authentication challenges, email tokens, sessions, and legacy edit tokens are
  stored only as hashes or server-side records. Raw secrets are never logged.
- Unified sessions last 14 days. Administrator authorization and destructive
  account-security actions require a passkey verification no older than
  `AUTH_ADMIN_REAUTH_SECONDS` (12 hours by default).
- Security pages and APIs send private/no-store headers. State-changing requests
  require the exact trusted Origin.

## Sign-in and Recovery Paths

### Passkey

`/account/sign-in/` starts a discoverable WebAuthn ceremony. The Worker verifies
the exact origin, RP ID, challenge, credential, signature counter, and user
verification before issuing a unified session.

### Activator email fallback

Eligible activators can request a 15-minute sign-in link. The response is the
same for known and unknown addresses. Requests are protected by Turnstile and
auth-specific network/email rate limits. Only a hash is stored, the token is
single-use, and the secret stays in the URL fragment. Delivery failure
invalidates the token.

The message identifies RI POTA as unofficial, links to official POTA resources
as the rules/account source of truth, and does not ask for a password.

### Existing activator private links

Existing `/activate-ri-2026/access/#<token>` and `/edit/<token>/` links continue
to work. In `dual` and `unified` modes, a valid link also claims or restores the
matching unified activator account and session. The link is not consumed,
rotated, or revoked by that upgrade. Existing legacy browser sessions can be
upgraded in `dual` mode.

New long-lived private links are issued only when
`AUTH_LEGACY_LINK_ISSUANCE_ENABLED=true`. Production keeps acceptance enabled
but issuance disabled: new submissions and recovery use 15-minute, single-use
email links. This separates rollback from compatibility and avoids putting new
reusable bearer credentials in email.

### Administrator bootstrap and recovery

`/activate-ri-2026/admin/recovery/` stays behind Cloudflare Access. Starting a
bootstrap session requires a valid Access identity and either:

- an existing event admin role, or
- an exact address in the external `AUTH_BOOTSTRAP_ADMIN_EMAILS` allowlist.

An allowlisted administrator receives an event admin role and a short
enrollment session. The allowlist may remain during rollout for specifically
named administrators who have not enrolled yet. While it remains, keep
Cloudflare Access on the full admin surface. Remove each bootstrap address
after that administrator has enrolled and tested a passkey.

From the admin **Account security** tab, a passkey-authenticated administrator
can inspect event accounts, send a 30-minute passkey replacement link, revoke
unified and related legacy sessions, disable an account after typing its callsign/email, or
re-enable it for a subsequent recovery. Passkey replacement revokes old
passkeys and unified/legacy sessions in one transaction. These controls do not revoke legacy private links;
an explicit **Revoke legacy access** operation remains separate. It revokes
legacy private links and browser sessions without minting a replacement.

## Feature Flags

The first column lists rollback-safe values; current production has advanced
through the verified transitions shown below:

| Variable | Safe value | Transition | Final value |
| --- | --- | --- | --- |
| `AUTH_ADMIN_MODE` | `access` | `dual` | `passkey` |
| `AUTH_ACTIVATOR_MODE` | `legacy` | `dual` | `unified` |
| `AUTH_EMAIL_LOGIN_ENABLED` | `false` | `true` after delivery checks | `true` |
| `AUTH_LEGACY_LINK_ISSUANCE_ENABLED` | `true` | `false` after email checks | `false` |

`access` and `legacy` preserve the previous production behavior. `dual` accepts
the old path while enrolling and exercising the new path. `passkey` and
`unified` require unified role sessions for protected pages and APIs, while old
activator links remain account bootstrap credentials.

The Worker refuses the unsafe combination of email login disabled and new
legacy-link issuance disabled.

Production reached unified activator mode on 2026-08-30 after the final
legacy-only browser session was explicitly revoked. Previously issued private
links remain valid account-bootstrap credentials, and activator email fallback
remains enabled.

Flags are top-level production vars in `wrangler.jsonc`. Change them in a
reviewed commit and deploy the whole configuration; do not use ad-hoc CLI
`--var` overrides that could omit other production vars.

## Staged Rollout

Do not skip gates.

1. **Dormant deploy:** deploy additive migrations `0012_unified_auth.sql` and
   `0013_auth_ceremony_sessions.sql` plus code with
   `access` / `legacy` / email `false`. Confirm old Access admin, private links,
   browser sessions, submissions, and email still work.
2. **Admin canary:** configure `AUTH_BOOTSTRAP_ADMIN_EMAILS` outside git and
   enroll the first administrator through Access. Keep Access on the full admin
   surface, set `AUTH_ADMIN_MODE=dual`, and verify the passkey session, admin
   page/API, and account listing while Access remains the fallback. Enroll at
   least one more administrator on a separate device, then verify sign-in,
   session revocation, one reset-link replacement, and a break-glass
   bootstrap/recovery path. Observe `dual` mode before proceeding.
3. **Activator dual mode:** set `AUTH_ACTIVATOR_MODE=dual`. Verify an existing
   private link, an existing legacy browser session, new passkey enrollment,
   and passkey sign-in without rotating the link.
4. **Email fallback:** set `AUTH_EMAIL_LOGIN_ENABLED=true`. Verify known and
   unknown requests have indistinguishable public responses, eligible delivery,
   fragment consumption, replay rejection, and audit records.
5. **Stop durable-link issuance:** set
   `AUTH_LEGACY_LINK_ISSUANCE_ENABLED=false`. Verify a new submission creates
   no edit-token row, sends a single-use claim link, and lands on My Plan.
   Verify a previously issued private link still works.
6. **Unified activators (complete):** after support readiness and telemetry
   review, set `AUTH_ACTIVATOR_MODE=unified`. Keep legacy links enabled as
   bootstrap. Production completed this transition on 2026-08-30 after safe
   aggregate checks showed no legacy-only activators.
7. **Passkey administrators:** only after at least two real administrators have
   tested passkeys and break-glass recovery is proven, set
   `AUTH_ADMIN_MODE=passkey`. A specifically named pending administrator may
   still enroll through the Access-protected recovery page while their address
   remains in `AUTH_BOOTSTRAP_ADMIN_EMAILS`. Keep Access on the full admin
   surface until the pending administrator has enrolled and the bootstrap
   allowlist has been removed; narrow Access to the recovery page only after
   this gate.

At each stage, verify the public site, volunteer submission, activator portal,
admin dashboard, Ops Room HTTP/WebSocket authorization, and recent Worker logs
before continuing.

## Operational Checks

Check migration state:

```bash
npx wrangler d1 migrations list ripota-org --remote --env ""
```

Inspect safe aggregate state without selecting tokens or credential material:

```bash
npx wrangler d1 execute ripota-org --remote --env "" --command="
SELECT
  (SELECT COUNT(*) FROM auth_users WHERE disabled_at IS NULL) AS enabled_users,
  (SELECT COUNT(*) FROM auth_passkey_credentials WHERE revoked_at IS NULL) AS active_passkeys,
  (SELECT COUNT(*) FROM auth_sessions
   WHERE revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS active_sessions,
  (SELECT COUNT(*) FROM auth_event_roles
   WHERE event_id='activate-ri-2026' AND role='admin' AND revoked_at IS NULL) AS admins;
"
```

Review action counts without displaying private metadata:

```bash
npx wrangler d1 execute ripota-org --remote --env "" --command="
SELECT action, COUNT(*) AS count
FROM auth_audit_events
WHERE created_at >= datetime('now', '-1 day')
GROUP BY action ORDER BY action;
"
```

## Rollback

Roll flags back before rolling code back:

1. Set `AUTH_ADMIN_MODE=access`.
2. Set `AUTH_ACTIVATOR_MODE=legacy`.
3. Set `AUTH_LEGACY_LINK_ISSUANCE_ENABLED=true` before disabling email.
4. Set `AUTH_EMAIL_LOGIN_ENABLED=false` if email fallback itself is implicated.
5. Deploy and verify Access, existing private links, and existing legacy
   sessions.

These changes do not delete users, passkeys, unified sessions, roles, links, or
event data. Migrations `0012` and `0013` are additive and should remain applied. If needed,
roll back the Worker version only after restoring the safe flags. Never delete
authentication tables as a rollback mechanism.

If administrator passkey access fails, keep or restore Cloudflare Access on the
full admin surface, use the Access-protected recovery page, and leave
`AUTH_ADMIN_MODE=access` until two administrators have completed the device and
recovery checks. Do not narrow Access during an incident.

Scheduled cleanup deletes expired challenges and email tokens in bounded
batches. It does not delete audit history, passkeys, users, roles, event data,
or legacy links.
