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
  secure-link replacement as separate security controls.
- Direct emergencies to 911 or the appropriate local authority.
- Never copy message bodies, raw email addresses, secure links, tokens, or
  cookies into logs or incident notes.

## Prelaunch sequence

1. Deploy with the D1 room mode `off`. Keep the deployment hard-disable
   available as the last-resort brake rather than the normal launch control.
2. Confirm `SITE_ORIGIN`, Cloudflare Access coverage for admin routes, the D1,
   Durable Object, assets, rate-limit, and email bindings, and current secrets.
3. Verify fragment-link exchange and the legacy edit-link bootstrap without
   exposing a credential in a request path after exchange.
4. Verify an activator can edit a plan while the room is off.
5. Set the rules and opening announcement before admitting participants.
6. Soft-launch to selected mobile and desktop participants. Exercise reconnect,
   pin, remove, mute, ban, session revoke, and secure-link replacement.
7. Test one explicit announcement email, its recipient count, BCC batching, and
   failed-recipient retry.
8. Move to `announcements` or `full` only after the soft launch succeeds.

## Incident controls

| Need | Control |
| --- | --- |
| Give participants current guidance | Post and optionally pin an announcement |
| Pause participant access gracefully | Set the room mode to `off` |
| Stop all participant room access at deployment level | Enable `ACTIVATE_RI_OPS_HARD_DISABLED` and deploy |
| Stop one participant from posting | Mute the room membership |
| Stop one participant from entering the room | Ban the room membership |
| End currently open room connections | Disconnect active sockets |
| End current portal browser sessions | Revoke portal sessions |
| Invalidate both distributed private links and all sessions | Replace secure links |
| Remove exposed or inappropriate content | Remove the message; its body is cleared in D1 |
| Recover a partial announcement send | Retry failed recipients only |

A room ban affects only Ops Room access. Secure-link replacement is the broader
control: it invalidates both plan links and all existing portal sessions.

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
backup, clears retained message bodies, records retention removal metadata, and
deletes expired activator sessions. Keep the command output with the operational
record, but do not add message or recipient data to it.
