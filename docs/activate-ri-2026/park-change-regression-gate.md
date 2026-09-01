# Activate All RI park-change regression gate

Issue [#16](https://github.com/ripota/ripota.org/issues/16) is a release
blocker for every park field-guide issue. Park work may add links and reuse
shared infrastructure, but it must not remove, demote, redirect, or reinterpret
an Activate All RI feature.

All checks use checked-in or synthetic data and local D1 databases. Never put
real volunteer names, email addresses, phone numbers, private messages, tokens,
or production exports in fixtures, snapshots, logs, or issue output.

## Compatibility matrix

The paths below are relative to the repository root. A row is covered only when
the listed automated checks pass or its explicit browser check is completed.

| Critical contract | Automated evidence | Browser evidence |
| --- | --- | --- |
| Event home, FAQ, parks/coverage/results, schedule, and hunter routes render with event navigation | `src/components/SiteHeader.test.ts`, `src/components/activate-ri/HelpPage.test.ts`, `src/components/activate-ri/PotaParkProgress.test.ts`, and `mise run build` | Open `/activate-ri-2026/`, `/help/`, `/parks/`, `/schedule/`, and `/hunter/` under the event prefix; confirm the page title, event nav, and main content render. |
| Shared header/layout changes retain the Activate All RI entry point and do not demote event actions | `src/components/SiteHeader.test.ts`, `src/layouts/BaseLayout.test.ts`, `src/lib/activate-ri/event.test.ts`, and `src/components/activate-ri/ParkCoverageTable.test.ts` | From every route above, use the site header to return to the event. Confirm **Volunteer to activate** remains the primary hero/coverage action during planning. |
| Event maps remain lightweight and keep marker, coverage-filter, status-text, volunteer, live-spot, and POTA-evidence behavior | `src/components/ReferenceMap.test.ts`, `src/components/activate-ri/ParkCoverageTable.test.ts`, `src/components/activate-ri/PotaParkProgress.test.ts`, `src/lib/activate-ri/coverage.test.ts`, and the volunteer/edit Playwright specs | On event home and parks, open a marker, use **Only show parks needing coverage**, and follow **Volunteer for this park**. In a live/results preview, confirm textual status and official-POTA evidence remain available without boundary geometry loading. |
| Public stops, schedule data, live spots, and POTA status preserve API projections and fallback states | `src/lib/activate-ri/public-stops-client.test.ts`, `src/lib/activate-ri/public-export.test.ts`, `src/worker/routes/activate-ri.test.ts`, `src/lib/pota/live-spots-client.test.ts`, `src/worker/routes/pota.test.ts`, `src/lib/activate-ri/pota-status-store.test.ts`, and `src/worker/pota-event-routes.test.ts` | With Astro dev only, confirm schedule/coverage use the checked-in stops fallback. With local Wrangler, confirm unavailable live data produces status text rather than a blank or broken map. |
| Hunter CSV import, remaining-parks planner, manual overrides, persistence, reset, and invalid-input handling work locally in the browser | `src/lib/activate-ri/hunter-checklist.test.ts`, `src/components/activate-ri/HunterChecklist.test.ts`, and `e2e/activate-ri-hunter.spec.ts` | Import a synthetic POTA CSV, toggle one manual override, filter the schedule to remaining parks, reload, reset, and confirm no CSV content leaves the browser. |
| Volunteer submission, delivery, claim/access, duplicate handling, and public publication retain current behavior | `src/worker/activate-ri.acceptance.test.ts`, `src/worker/routes/activate-ri.test.ts`, `src/worker/ownership.acceptance.test.ts`, `src/worker/volunteer-auth.test.ts`, and `e2e/activate-ri-volunteer.spec.ts` | Covered by the local Playwright email sink and synthetic D1 flow; do not substitute a real address or production submission. |
| Unknown and eligible email claims remain enumeration-safe and single use | `src/worker/auth/email-login.test.ts` and `src/worker/auth.acceptance.test.ts` | Covered by the local Playwright/email-sink flow; compare only public response shape, never account existence from production. |
| Passkey and 15-minute email sign-in resolve the same account and event registration | `src/worker/auth.acceptance.test.ts`, `src/worker/auth/passkeys.test.ts`, `src/worker/auth/email-login.test.ts`, `src/worker/ownership.acceptance.test.ts`, and `e2e/activate-ri-auth.spec.ts` | The auth Playwright spec uses a virtual authenticator and local email sink; it is the required browser check. |
| Activator plan read/edit, stop management, account security, sessions, passkeys, and sign-out continue to work | `src/worker/index.test.ts`, `src/worker/routes/activate-ri.test.ts`, `src/worker/auth/session.test.ts`, `src/worker/auth/passkeys.test.ts`, `src/worker/auth/admin-recovery.test.ts`, `e2e/activate-ri-edit.spec.ts`, and `e2e/activate-ri-auth.spec.ts` | In the local specs, edit a synthetic stop, manage a passkey/session, sign out, and verify the old session no longer works. |
| Activator Ops Room membership, rules, messages, announcements, moderation, email, and live updates continue to work | `src/worker/activate-ri-ops.acceptance.test.ts`, `src/worker/durable-objects/activate-ri-ops-room.test.ts`, `src/worker/ops-email.test.ts`, and `e2e/activate-ri-ops-room.spec.ts` | The Ops Room Playwright spec must show two local clients receiving live state plus the organizer announcement and sign-out flow. |
| Admin sign-in and event-scoped authorization remain independent from park/site roles | `src/worker/auth/authorization.test.ts`, `src/worker/auth.acceptance.test.ts`, `src/worker/index.test.ts`, and `src/worker/park-change-regression.acceptance.test.ts` | The auth Playwright spec proves an email-authenticated dual-role account cannot call admin APIs; admin actions require a current passkey or the documented Access fallback mode. |
| A site moderator or role for another scope never grants Activate RI admin or activator capability | `src/worker/park-change-regression.acceptance.test.ts` seeds a synthetic future park moderator and an out-of-event role, then expects admin `403` and activator `401` | No production role inspection is permitted. The synthetic real-SQL test is authoritative. |
| Admin review, activity, Ops Room, account recovery/security, and POTA reconciliation remain protected and usable | `src/worker/routes/activate-ri.test.ts`, `src/worker/activate-ri-ops.acceptance.test.ts`, `src/worker/auth/admin-recovery.test.ts`, `src/worker/pota-event.test.ts`, `src/worker/pota-event-routes.test.ts`, `src/components/activate-ri/PotaParkProgress.test.ts`, and the auth/Ops Playwright specs | Use only the local admin identity. Confirm pending review, activity, account recovery controls, Ops state, and deep reconciliation are present; do not trigger remote reconciliation. |
| Park/auth migrations are additive and preserve event sessions, roles, memberships, and operational rows | `src/worker/park-change-regression.acceptance.test.ts`, `src/worker/auth/schema.test.ts`, `src/worker/auth.acceptance.test.ts`, `src/worker/ownership.acceptance.test.ts`, and `src/worker/activate-ri-ops.acceptance.test.ts` | Apply migrations only to an ephemeral/local D1 database. Never use `--remote` for this gate. |
| Backup, reset, migration discovery, and deployment tasks still cover the live schema | `src/mise-tasks.test.ts` and automatic ordered discovery in `src/worker/test-utils/sqlite-d1.ts`; `mise run deploy -- --dry-run` is an optional non-mutating configuration check | Review `docs/activate-ri-2026/database-reset.md` whenever a live operational table is added. Do not run reset, backup, migrate, or deploy tasks against production for a park PR check. |
| Public projections, analytics, logging, and POTA evidence do not leak event PII | `src/lib/activate-ri/public-export.test.ts`, `src/worker/routes/activate-ri.test.ts`, `src/worker/logging.test.ts`, `src/worker/client-errors.test.ts`, `src/components/activate-ri/analytics-instrumentation.test.ts`, and `src/worker/pota-event.test.ts` | Inspect browser network payloads with synthetic values and confirm no email, phone, token, private note, message, or imported CSV row appears in public/analytics responses. |

## Required checks for every park field-guide pull request

Run from a clean working copy with local dependencies installed:

```bash
mise run check
mise run test-unit -- --run
mise run build
mise run e2e:activate-ri
```

The Playwright suite creates an ephemeral local Wrangler database, applies all
checked-in migrations, uses synthetic fixtures, and deletes the database on
completion. If the browser runtime is unavailable, record
`mise run e2e:activate-ri` as **not run**, include the exact setup error, and
complete the public manual procedure below. Do not claim authenticated browser
coverage passed based on unit tests alone.

### Targeted checks by shared surface

Run the matching line before the full suite when a change touches that surface:

| Touched surface | Targeted command |
| --- | --- |
| `ReferenceMap`, event maps, coverage/actions, or results | `mise run test-unit -- --run src/components/ReferenceMap.test.ts src/components/activate-ri/ParkCoverageTable.test.ts src/components/activate-ri/PotaParkProgress.test.ts src/lib/activate-ri/coverage.test.ts` then `npx playwright test e2e/activate-ri-volunteer.spec.ts e2e/activate-ri-edit.spec.ts --workers=1` |
| Header/footer, `BaseLayout`, or event navigation | `mise run test-unit -- --run src/components/SiteHeader.test.ts src/layouts/BaseLayout.test.ts src/lib/activate-ri/event.test.ts src/components/activate-ri/HelpPage.test.ts` then `mise run build` |
| Shared auth, account UI, sessions, or passkeys | `mise run test-unit -- --run src/worker/auth.acceptance.test.ts src/worker/auth/authorization.test.ts src/worker/auth/admin-recovery.test.ts src/worker/auth/email-login.test.ts src/worker/auth/passkeys.test.ts src/worker/park-change-regression.acceptance.test.ts` then `npx playwright test e2e/activate-ri-auth.spec.ts e2e/activate-ri-activator-access.spec.ts --workers=1` |
| D1 migrations or event role/membership queries | `mise run test-unit -- --run src/worker/park-change-regression.acceptance.test.ts src/worker/auth/schema.test.ts src/worker/auth.acceptance.test.ts src/worker/ownership.acceptance.test.ts src/worker/activate-ri.acceptance.test.ts src/worker/activate-ri-ops.acceptance.test.ts` |
| Public stops, schedule, live spots, or fallback clients | `mise run test-unit -- --run src/lib/activate-ri/public-stops-client.test.ts src/lib/activate-ri/public-export.test.ts src/worker/routes/activate-ri.test.ts src/lib/pota/live-spots-client.test.ts src/worker/routes/pota.test.ts` |
| Event results or POTA reconciliation | `mise run test-unit -- --run src/lib/activate-ri/pota-event.test.ts src/worker/pota-event.test.ts src/worker/pota-event-routes.test.ts src/components/activate-ri/PotaParkProgress.test.ts` |
| Activator/admin Ops Room | `mise run test-unit -- --run src/worker/activate-ri-ops.acceptance.test.ts src/worker/durable-objects/activate-ri-ops-room.test.ts src/worker/ops-email.test.ts` then `npx playwright test e2e/activate-ri-ops-room.spec.ts --workers=1` |

## Public manual browser procedure

Use this only as the explicit fallback when Playwright cannot launch:

1. Run `mise run dev` and use the printed localhost origin.
2. Visit the five public routes in the first matrix row. Confirm the shared
   header, event nav, headings, unofficial-site notice, and official POTA links.
3. On event home and parks, open a map marker, toggle the coverage filter, and
   follow the volunteer action. Confirm the selected synthetic park reaches the
   volunteer form and remains the primary action.
4. On schedule, exercise its filters and the remaining-parks link. On hunter,
   import a synthetic CSV, set and clear a manual override, reload, then reset.
5. In browser network tools, confirm an unavailable live API uses visible
   fallback/unavailable text and does not expose imported CSV data or private
   fields.

Astro dev proves public rendering and static fallback behavior only. It does
not prove D1 writes, email delivery, WebAuthn, protected admin routes, or live
Ops Room sockets. Those remain explicitly **not run** until the local Wrangler
Playwright suite succeeds.

## Schema and lifecycle boundary

- The current park-write boundary is absence: #16 adds no park pages, APIs,
  persistence, enrollment, moderation, or account fields. A later issue may add
  a write path only behind an off-by-default flag or an equivalent server-side
  deny boundary until that phase explicitly opens it.
- Park migrations must add new tables, columns, indexes, or role rows. While the
  event is live they must not rename, drop, narrow, repurpose, or backfill new
  meanings into `activate_ri_*`, unified auth, Ops Room, or POTA evidence data.
- A park/site role is never an input to `requireAdmin` or `requireActivator`.
  Activate RI capability comes only from an active role or membership scoped to
  `ACTIVATE_RI_EVENT_ID`.
- Post-event archive/cleanup belongs to
  [#8](https://github.com/ripota/ripota.org/issues/8), legacy-link retirement to
  [#11](https://github.com/ripota/ripota.org/issues/11), identity/registration
  normalization to [#13](https://github.com/ripota/ripota.org/issues/13), and
  schema consolidation to [#14](https://github.com/ripota/ripota.org/issues/14).
  Park work must coordinate with those issues and must not implement their
  contraction, retention, or reinterpretation decisions early.
- Issues #17 through #29 in the **Rhode Island park field guides** milestone
  link to #16 as their release blocker. Recheck that relationship when milestone
  issues are added or reorganized.

## Pull-request sign-off

- [ ] Every affected matrix row has passing automated evidence or a recorded
      manual check and limitation.
- [ ] Shared navigation keeps Activate All RI discoverable; event volunteer and
      coverage actions remain primary.
- [ ] Shared map changes retain lightweight markers, filters, status text,
      volunteer links, and POTA evidence behavior.
- [ ] Auth/schema changes pass the synthetic park-role isolation and additive
      migration tests; no site role grants event capability.
- [ ] New park writes are absent or fail closed behind the phase's explicit gate.
- [ ] Fixtures and output contain only synthetic data and no event PII.
- [ ] Full check, unit, build, and Playwright results (or exact browser
      limitation) are recorded.
