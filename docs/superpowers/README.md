# Historical designs and implementation plans

The documents in `plans/` and `specs/` record decisions made while building the
site. Each has a dated status note that identifies the implementation now in
the repository and assumptions that have since changed. The original narrative,
example code, and checkboxes are retained as history. An unchecked box does not
mean the feature is absent, and a checked box does not prove a current test or
production verification passed.

Read the current status note before consulting an old plan. Do not replay its
scaffold, database creation, deployment, authentication cutover, or commit
commands against an existing installation. Historical file paths may refer to
files that have been moved or replaced; the current status note links to their
replacements where relevant.

For current development and operations, start with:

- [Project README](../../README.md) and [contribution guide](../../CONTRIBUTING.md).
- [Deployment guide](../deployment.md).
- [Activate RI data flow](../activate-ri-2026/data-flow.md).
- [Authentication runbook](../activate-ri-2026/authentication.md) and
  [Cloudflare Access recovery guide](../cloudflare-access.md).
- [Parks package adoption](../parks-v311-adoption.md).

The September 6, 2026 documentation review checked these records against local
source, configuration, and task definitions. It does not establish the live
state of Cloudflare resources, external accounts, or the completion of old
manual QA checklists.
