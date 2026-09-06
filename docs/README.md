# Documentation

The repository documentation was reviewed against the code, migrations, and
file-based mise tasks on 2026-09-06. Current runbooks describe the implemented
system; dated verification records describe checks performed at that time and
do not establish the state of a later production deployment.

## Development and operations

- [Project overview and local development](../README.md)
- [Contributing and checks](../CONTRIBUTING.md)
- [Deployment, backups, migrations, and rollback](deployment.md)
- [Cloudflare Access recovery configuration](cloudflare-access.md)
- [Authentication, account security, and recovery](activate-ri-2026/authentication.md)
- [Event data flow and public/private boundaries](activate-ri-2026/data-flow.md)
- [Email flow and setup](activate-ri-2026/email-flow-and-setup.md)
- [Database reset and restoration](activate-ri-2026/database-reset.md)
- [Ops Room launch and incident response](activate-ri-2026/ops-room-launch-and-incident-response.md)
- [Worker logging and browser error reports](activate-ri-2026/worker-logging-debugging.md)
- [Analytics collection and reporting](analytics.md)
- [Park-change regression checks](activate-ri-2026/park-change-regression-gate.md)

## Feature status and verification records

- [Requested-parks agenda](activate-ri-2026/requested-parks-agenda.md)
- [Final-week event review](activate-ri-2026/final-week-review.md)
- [Park package 3.1.1 adoption and measurements](parks-v311-adoption.md)
- [Live location: current behavior and original design](live-location-design.md)
- [Park pages: implemented features and future proposals](park-pages-design.md)

## Historical design records

These records retain original decisions and implementation sequences. Read
their current-status notes before using old commands, schemas, or route names.

- [Original activator magic-link design](activate-ri-2026/activator-magic-link-design.md)
- [Original Ops Room design](activate-ri-2026/activator-ops-room-design.md)
- [Plans and specifications archive](superpowers/README.md)

For current behavior, use the linked runbooks and the corresponding source,
`migrations/`, `package.json`, `wrangler.jsonc`, and `mise/tasks/`. In particular,
production authentication uses passkeys/unified accounts, public event stop
data comes from D1, and park metadata comes from the pinned `@ripota/parks`
package. Historical plans may describe earlier systems.
