# Cloudflare Access for Activate RI Admin and Recovery

Cloudflare Access protects the Activate RI admin UI and API during the passkey
rollout:

- `/activate-ri-2026/admin*`
- `/api/activate-ri-2026/admin/*`

The recovery page posts to
`/api/activate-ri-2026/admin/auth/access-bootstrap/start`, which deliberately
stays beneath the protected admin API prefix. The older
`/api/auth/access-bootstrap/start` route remains a compatibility alias, but the
site does not depend on a separate Access application path for it.

The Worker also validates Access JWTs for admin requests when these production
vars are configured:

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`

Do not commit account IDs, API tokens, Access app IDs, admin email addresses, or
local `.env` files.

With `AUTH_ADMIN_MODE=access` (the production-safe default), Access remains the
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

## Cloudflare Zero Trust Setup

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
6. Keep the protected admin API hostname/path in step 5 while recovery is
   available. It includes the recovery bootstrap endpoint at
   `/api/activate-ri-2026/admin/auth/access-bootstrap/start`.
7. Add an **Allow** policy for the admin users.
   - For a small admin list, use an email rule with the exact admin email
     addresses.
   - Keep the application deny-by-default; do not add an allow rule for a whole
     domain unless every account on that domain should be an admin.
8. Configure the identity provider the admins should use.
   - One-time PIN is fine for a small external admin list.
   - If there is only one IdP, enable instant authentication.
9. Save the application.

Cloudflare's current docs say Access applications are deny-by-default, and a
user must match an Allow policy before access is granted. They also document
using public hostnames with paths for self-hosted applications.

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
2. Confirm Cloudflare Access prompts for authentication.
3. Sign in as an allowed admin and confirm the admin dashboard loads.
4. Sign out or use a different private browser and confirm this returns
   unauthorized:

```bash
curl -i https://ripota.org/api/activate-ri-2026/admin/plans
```

5. If a signed-in admin sees the dashboard but the API shows unauthorized,
   re-check `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.

## Local Development

Local tests can enable `ALLOW_LOCAL_ADMIN_AUTH=true` and send
`Cf-Access-Authenticated-User-Email`. That setting is restricted to localhost
requests. Do not enable it in the top-level production vars.
