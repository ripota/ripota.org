# Cloudflare Access for Activate RI Admin

The Activate RI admin UI and admin API are intended to be protected by
Cloudflare Access:

- `/activate-ri-2026/admin*`
- `/api/activate-ri-2026/admin/*`

The Worker also validates Access JWTs for admin requests when these production
vars are configured:

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`

Do not commit account IDs, API tokens, Access app IDs, admin email addresses, or
local `.env` files.

## Cloudflare Zero Trust Setup

In the Cloudflare dashboard:

1. Go to **Zero Trust** > **Access controls** > **Applications**.
2. Select **Create new application**.
3. Choose **Self-hosted and private**.
4. Add a public hostname for the admin page:
   - Domain: `ripota.org`
   - Path: `/activate-ri-2026/admin*`
5. Add a second public hostname/path to the same application:
   - Domain: `ripota.org`
   - Path: `/api/activate-ri-2026/admin/*`
6. Add an **Allow** policy for the admin users.
   - For a small admin list, use an email rule with the exact admin email
     addresses.
   - Keep the application deny-by-default; do not add an allow rule for a whole
     domain unless every account on that domain should be an admin.
7. Configure the identity provider the admins should use.
   - One-time PIN is fine for a small external admin list.
   - If there is only one IdP, enable instant authentication.
8. Save the application.

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

## Verify

After deployment:

1. Open `https://ripota.org/activate-ri-2026/admin/` in a private browser.
2. Confirm Cloudflare Access prompts for authentication.
3. Sign in as an allowed admin and confirm the admin dashboard loads.
4. Sign out or use a different private browser and confirm this returns
   unauthorized:

```bash
curl -i https://ripota.org/api/activate-ri-2026/admin/routes
```

5. If a signed-in admin sees the dashboard but the API shows unauthorized,
   re-check `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.

## Local Development

Local tests can enable `ALLOW_ADMIN_HEADER_AUTH=true` and send
`Cf-Access-Authenticated-User-Email`. Do not enable that bypass in production.
