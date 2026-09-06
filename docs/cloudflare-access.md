# Cloudflare Access for Activate RI Admin and Recovery

The administrator passkey rollout completed on 2026-09-06. All three enabled
administrators had enrolled and used passkeys, production already selected
`AUTH_ADMIN_MODE=passkey`, and `AUTH_BOOTSTRAP_ADMIN_EMAILS` was removed.
Cloudflare Access now protects only emergency recovery:

- `/activate-ri-2026/admin/recovery*`
- `/api/activate-ri-2026/admin/auth/access-bootstrap/start`

Normal admin navigation goes directly to the site's passkey sign-in page.
Unauthenticated admin API requests return `401`. Keep the existing Access
application, admin Allow policy, and email-code login method for recovery.

The recovery page posts to
`/api/activate-ri-2026/admin/auth/access-bootstrap/start`, which deliberately
is protected explicitly by the second path above. The older
`/api/auth/access-bootstrap/start` route remains a compatibility alias, but the
site does not depend on a separate Access application path for it.

The Worker validates Access JWTs for recovery requests using these production
secrets (also used for admin authorization in rollback modes):

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`

Do not commit account IDs, API tokens, Access app IDs, admin email addresses, or
local `.env` files.

With `AUTH_ADMIN_MODE=access` (the initial rollout and rollback mode), Access is the
administrator authorization mechanism. With `dual`, a current passkey admin
session is preferred and Access remains the compatibility fallback. Sensitive
account recovery controls always require a passkey administrator session.

Do not narrow Access when switching to `dual`. The first enrolled administrator
may act as the passkey canary because Access remains the compatibility fallback
across the full admin surface. Only after at least two real administrators have
enrolled and tested passkeys plus break-glass recovery may `AUTH_ADMIN_MODE`
move to `passkey`. At that point, keep Access on at least:

- `/activate-ri-2026/admin/recovery*`
- `/api/activate-ri-2026/admin/auth/access-bootstrap/start`

See `docs/activate-ri-2026/authentication.md` for the required safety gates and
rollback sequence.

## Cloudflare Zero Trust Setup During Rollout or Rollback

The broad paths below are for initial enrollment or rollback. Current production
uses the two recovery-only paths above. When narrowing an existing application,
edit its destinations in place to preserve its audience and policy.

In the Cloudflare dashboard:

1. Go to **Zero Trust** > **Access controls** > **Applications**.
2. Select **Create new application**.
3. Choose **Self-hosted and private**.
4. Add a public hostname for the admin page during rollout:
   - Domain: `ripota.org`
   - Path: `/activate-ri-2026/admin*`
5. Add a second public hostname/path to the same application during rollout:
   - Domain: `ripota.org`
   - Path: `/api/activate-ri-2026/admin/*`
6. During rollout, the protected API prefix includes the recovery bootstrap
   endpoint. After enrollment is complete and the bootstrap allowlist is
   removed, replace both broad paths with the recovery-only paths above.
7. Add an **Allow** policy for the admin users.
   - For a small admin list, use an email rule with the exact admin email
     addresses.
   - Keep the application deny-by-default; do not add an allow rule for a whole
     domain unless every account on that domain should be an admin.
8. Configure the identity provider the admins should use.
   - One-time PIN is fine for a small external admin list.
   - If there is only one IdP, enable instant authentication.
9. Save the application.

Cloudflare documents public hostnames, application paths, and the default-deny
Allow policy requirement in its
[self-hosted application setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).

## Worker Configuration

After the Access application exists, copy the app audience value from the
application's **Overview** or **Application token** settings.

Set production Worker vars/secrets:

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

Use the Zero Trust team domain for `CF_ACCESS_TEAM_DOMAIN`, either as the short
team name or the full domain:

```text
your-team.cloudflareaccess.com
```

Use the Access application audience value for `CF_ACCESS_AUD`.

## Bootstrap Allowlist

Production no longer has this secret. The following instructions apply when
deliberately enrolling a new administrator.

The Access-protected recovery page only creates a first-time admin when the
verified Access email is in `AUTH_BOOTSTRAP_ADMIN_EMAILS`. Configure the
comma-separated list outside git:

```bash
npx wrangler secret put AUTH_BOOTSTRAP_ADMIN_EMAILS
```

After each specifically named administrator has enrolled and tested a passkey,
remove their address from the allowlist. The allowlist may remain temporarily
for a pending administrator after `AUTH_ADMIN_MODE=passkey`, provided Access
continues to protect the full admin surface. Once all intended administrators
have enrolled, replace the value with an empty allowlist or remove the secret.
Existing event admin roles can still use Access-protected recovery.

## Verify

After deployment:

1. Open `https://ripota.org/activate-ri-2026/admin/` in a private browser.
2. Confirm it redirects to `/account/sign-in/` without a Cloudflare Access
   prompt. The email sign-in disclosure starts collapsed.
3. Sign in with an administrator passkey and confirm the dashboard loads.
4. Sign out or use a different private browser and confirm this returns
   unauthorized:

```bash
curl -i https://ripota.org/api/activate-ri-2026/admin/plans
```

5. Open `/activate-ri-2026/admin/recovery/` in a fresh private browser and
   confirm Cloudflare Access prompts for authentication. An unauthenticated
   request to `/api/activate-ri-2026/admin/auth/access-bootstrap/start` must
   also be intercepted by Access.
6. If normal admin APIs return unauthorized, check the current passkey session,
   admin role, and reauthentication age. If Access-authenticated recovery fails,
   re-check `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.

## Local Development

`env.local` enables `ALLOW_LOCAL_ADMIN_AUTH=true`. On localhost, when Access JWT
secrets are absent, the Worker uses `LOCAL_ADMIN_EMAIL` (default
`local-admin@ripota.org`) without requiring an email header. Local `dual` mode
allows that identity to open the admin dashboard and begin passkey enrollment
through recovery. Use `http://localhost:8787/` when testing passkeys.

The separate `ALLOW_ADMIN_HEADER_AUTH` switch accepts the
`Cf-Access-Authenticated-User-Email` header in controlled test fixtures; it is
not the localhost development mechanism. Do not enable either bypass in
production. If local recovery unexpectedly requires a JWT, check whether your
untracked `.dev.vars` supplies `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`:
configured JWT validation takes precedence over the local identity.
