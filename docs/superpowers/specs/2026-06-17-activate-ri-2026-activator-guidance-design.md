# Activate RI 2026 Activator Guidance Design

## Goal

Improve Activate All RI 2026 guidance for a mixed audience: experienced POTA
activators who want a fast path, and newer event participants who need the
purpose, workflow, and field meanings explained. The guidance should make the
volunteer flow self-explanatory without turning the form into a long instruction
page.

## Current State

The event overview explains that the Rhode Island POTA community is trying to
cover all 61 Rhode Island references during one coordinated weekend. The
volunteer page explains that activators can submit one planned activation or a
multi-park plan for organizer review. The form collects identity, park, date,
time block, bands, modes, public notes, and organizer notes.

The magic-link edit flow exists and activators can request a resend, but the
public-facing explanation is thin. Activators may not understand that the email
address owns their private edit link, that the link manages all plans attached
to that email, or which changes can be made after approval.

## Recommended Approach

Use layered guidance:

- Regular page prose for event purpose, workflow, and next steps.
- Inline help text for form details that are essential to successful
  submission.
- Compact question-mark help affordances for field-specific definitions and
  examples.
- A dedicated event help page for magic links, edits, approval, publication,
  and common issues.

This keeps the primary flow scannable for experienced activators while giving
newer participants clear places to learn more.

## Overview Page

Add a "How this works" section on `/activate-ri-2026/`, after the event nav and
before the coverage summary. The section should explain:

- The event goal is coordinated coverage of all 61 Rhode Island POTA references.
- Coverage means a planned activation window, not an official reservation,
  guaranteed operation, or guaranteed QSO count.
- Three-hour blocks exist so hunters and organizers can scan the schedule
  consistently; they are not a requirement to operate exactly three hours.
- Activators should pick parks they can reasonably attempt, submit a plan,
  watch the public schedule, and update the plan if circumstances change.
- Official POTA systems remain the source of truth for rules, references,
  accounts, spots, logs, awards, and activation validity.

The overview should remain event-focused. It should not add general POTA
training or homepage-level evergreen copy.

## Volunteer Page

Add a "Before you submit" content block above the form on
`/activate-ri-2026/volunteer/`. It should cover:

- One submission can be a single stop or a multi-park rove.
- Plans are reviewed by organizers before they appear on the public schedule.
- The email address is used for the private edit link and should be reachable.
- Frequencies are not collected; activators should spot normally when operating.
- Plans can be changed later with the private edit link.

Add a "What happens next" content block near the existing edit-link resend form.
It should explain:

- A private edit link is emailed after submission.
- The edit link can update or cancel plans tied to the same email address.
- Pending plans stay in review until approved.
- Approved plans can be edited by the activator; those edits are expected to
  update the public schedule through the event publishing flow.
- The resend form is for people who submitted but cannot find their edit link.

## Field Guidance

Use concise inline help where the user needs the explanation before submitting:

- Callsign: use the callsign that should appear on the public schedule.
- Email: used for the private edit link; it is not shown publicly.
- Park: choose from the suggestions so the correct POTA reference is saved.
- Time block: pick the closest planned operating window; update it later if
  plans change.
- Bands and modes: expected operating options, not a binding promise.
- Public notes for hunters: shown publicly; good for access notes, parking,
  QRP/portable context, approximate timing, or rove sequence.
- Notes for organizers: private coordinator context; not shown on the public
  schedule.

Use compact question-mark help affordances for field-specific definitions and
examples. These should be keyboard-accessible and should not hide information
that is required to submit correctly. If a tooltip would need more than a couple
sentences, move that content into page prose or the help page instead.

## Help Page

Add `/activate-ri-2026/help/` as a top-level event page and add it to
`EventNav`. Do not place the help page under the volunteer route because the
help applies to the full event flow, not only the signup form.

The help page should answer:

- What is Activate All RI 2026?
- What does "coverage" mean?
- How should I choose a time block?
- What should go in public notes?
- What is the private edit link?
- When is the private edit link emailed?
- What can I edit myself?
- Why does one email manage multiple plans?
- What happens before and after organizer approval?
- How do I request a new edit link?
- What should I do if I mistyped my email address?
- Are POTA rules, spots, logs, and awards handled here?

The help page should include a clear reminder that ripota.org is an unofficial
community coordination site and that official Parks on the Air resources remain
authoritative.

## Components

Add small reusable event guidance components only if they reduce duplication:

- A simple field-help or tooltip component for label-adjacent help.
- A compact content block style for overview, volunteer, and help page sections.

Avoid broad layout refactors. Existing `EventNav`, `EventHero`, `Notice`, and
form structure should remain in place.

## Accessibility

Field help must be accessible without a mouse. Prefer semantic text connected
with `aria-describedby` for critical instructions. Tooltip-style help should
support focus, hover, and screen-reader labels, and should not be the only place
where submission-critical information appears.

## Testing And Verification

- Run the project check task after implementation.
- Verify the new help route builds.
- Manually review the overview, volunteer page, and help page at desktop and
  mobile widths.
- Confirm the event nav still fits at mobile widths after adding Help.
- Confirm field help does not overlap form controls, combobox results, or
  multi-select menus.

## Out Of Scope

- Changing submission validation or review rules.
- Adding general POTA training content.
- Changing public schedule data semantics.
- Reworking the edit-token implementation.
- Sending additional emails beyond the existing magic-link flow.
