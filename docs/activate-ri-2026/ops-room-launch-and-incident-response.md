# Activator Ops Room Launch and Incident Response

The Activator Ops Room is an unofficial, event-scoped coordination aid. It is
not an emergency service, and it does not replace official Parks on the Air
rules, references, accounts, spots, or logs. Volunteer signup, activator plan
editing, and the public schedule operate independently of the room.

## Moderator responsibilities

- Check the room during announced operating hours without promising continuous
  monitoring.
- Use announcements for operational guidance and email only when the update is
  important enough to reach activators away from the room.
- Remove private, abusive, or unsafe content. Record a concise reason for
  removal, mute, or ban actions.
- Resolve completed operational requests and reopen them when coordination is
  still needed.
- Treat room moderation, socket disconnect, portal-session revocation, and
  legacy-access revocation as separate security controls.
- Direct emergencies to 911 or the appropriate local authority.
- Never copy message bodies, raw email addresses, secure links, tokens, or
  cookies into logs or incident notes.

## Prelaunch sequence

1. Deploy with the D1 room mode `off`. Keep the deployment hard-disable
   available as the last-resort brake rather than the normal launch control.
2. Confirm `SITE_ORIGIN`, passkey authorization for admin HTTP and WebSocket
   access, Cloudflare Access coverage for the recovery page and bootstrap
   endpoint, the D1, Durable Object, assets, rate-limit, and email bindings,
   and current secrets. See `authentication.md` for recovery and rollback.
3. Verify fragment-link exchange and the legacy edit-link bootstrap without
   exposing a credential in a request path after exchange.
4. Verify an activator can edit a plan while the room is off.
5. Set the rules and opening announcement before admitting participants.
6. Test-drive with fellow organizers in the admin console's **Live room** first.
   Use separate mobile and desktop browsers, open the room in `full` mode, and
   exercise realtime chat, reconnect, park context, announcements, pin, remove,
   mute, ban, session revoke, and legacy-access revocation. Then invite a small
   set of activators through normal passkey or email sign-in to validate their
   view. Previously issued private links remain supported.
7. Test one explicit announcement email, its recipient count, BCC batching, and
   failed-recipient retry.
8. Move to `announcements` or `full` only after the soft launch succeeds.

## Prelaunch test cleanup

The organizer Live room uses the real room and deliberately does not create fake
activators or memberships. After the rehearsal, set the room mode to `off` and
preview the cleanup locally or in production:

```bash
mise run activate-ri-2026:reset-ops-room
mise run activate-ri-2026:reset-ops-room -- --remote
```

The task prints candidate counts and makes no changes without `--confirm`. A
confirmed production reset first creates a D1 backup and refuses to run unless
the room is already off. It deletes Ops messages, events, broadcasts, recipients,
Ops audit activity, and legacy activator sessions; clears rule acceptance and test
moderation state; and leaves the room off. It preserves activators, plans, stops,
edit tokens, secure links, and unified accounts/passkeys/sessions. This task does
not sign out current unified-authentication users; use **Account security →
Revoke sessions** when that is required.

To perform the production cleanup after reviewing the preview:

```bash
mise run activate-ri-2026:reset-ops-room -- --remote --confirm
```

Ask testers to close or refresh their room tabs afterward. Device-local drafts
are intentionally not server records and can be discarded in the room composer.

## Incident controls

| Need | Control |
| --- | --- |
| Give participants current guidance | Post and optionally pin an announcement |
| Pause participant access gracefully | Set the room mode to `off` |
| Stop all participant room access at deployment level | Enable `ACTIVATE_RI_OPS_HARD_DISABLED` and deploy |
| Stop one participant from posting | Mute the room membership |
| Stop one participant from entering the room | Ban the room membership |
| End currently open room connections | Disconnect active sockets |
| End unified and related legacy browser sessions | Account security → Revoke sessions |
| End legacy portal browser sessions only | Ops members → Revoke portal sessions |
| Invalidate previously distributed private links and legacy sessions | Ops members → Revoke legacy access |
| Invalidate private links and all browser sessions | Revoke legacy access, then Account security → Revoke sessions |
| Remove exposed or inappropriate content | Remove the message; its body is cleared in D1 |
| Recover a partial announcement send | Retry failed recipients only |

A room ban affects only Ops Room access. Legacy-access revocation invalidates
previously issued links and legacy sessions without generating another reusable
link. It leaves unified sessions and passkeys usable; use Account security's
session revocation or emergency disable when account access is implicated.

## Emergency rollback

1. Set the room mode to `off` if the admin control plane is healthy.
2. Enable `ACTIVATE_RI_OPS_HARD_DISABLED` and run `mise run deploy` when a
   deployment-level stop is needed.
3. Verify volunteer signup, plan editing, the public schedule, and official POTA
   links continue to work independently.
4. Leave the additive D1 tables and Durable Object binding in place during the
   incident; disabling access does not require destructive rollback.
5. Preserve only sanitized identifiers, sequence numbers, timestamps, and
   errors needed for investigation.

## Post-event retention

The event retention cutoff is December 13, 2026 at 05:00 UTC. Before that date,
the purge task refuses to make changes. Preview local candidates with:

```bash
mise run activate-ri-2026:purge-ops-room
```

After the cutoff, preview production candidates with `--remote`, then run with
both `--remote --confirm`. The confirmed production task first creates a D1
backup, clears message bodies created before the cutoff, records retention
removal metadata, and deletes expired legacy activator sessions. Unified session
cleanup runs separately through the minute cron. Keep the command output with the operational
record, but do not add message or recipient data to it.
