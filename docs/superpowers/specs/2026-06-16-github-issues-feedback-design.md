# GitHub Issues Feedback Link Design

Date: 2026-06-16

## Context

`ripota.org` does not currently provide a public path for visitors to suggest site improvements, report broken links, or propose local-resource corrections. The public repository is `https://github.com/ripota/ripota.org`, and the preferred destination is GitHub Issues rather than the repository homepage.

The site already separates official Parks on the Air resources from community-site resources. That distinction should remain clear: official POTA resources continue to be the source of truth for rules, accounts, spots, logs, awards, and current reference status.

## Goals

- Add a low-friction public feedback path for `ripota.org`.
- Make the path visible from every page without adding homepage weight.
- Guide visitors into submitting useful site suggestions or corrections.
- Avoid implying that GitHub Issues are an official POTA support channel.

## Non-Goals

- Do not add a general contribution workflow or developer-oriented call to action.
- Do not add GitHub links to the official POTA links list.
- Do not create multiple issue templates until there is a demonstrated need.
- Do not change the existing unofficial community-site disclaimer.

## Proposed Approach

Add a footer link labeled `Suggest a site improvement` that points to a dedicated GitHub issue form for site suggestions and corrections.

The link should be modeled separately from `officialLinks` in `src/data/site.ts`, for example as site or feedback metadata. `Footer.astro` can render it near the existing `Assets` link so it is available globally but does not compete with primary homepage actions.

## Issue Form

Create a single GitHub issue form at `.github/ISSUE_TEMPLATE/site-suggestion.yml`.

The form should collect:

- The page URL involved, when applicable.
- What should change.
- Why the change would help.
- Supporting source or context, especially for local-resource corrections.
- Optional contact information or callsign.

The form introduction should clarify that GitHub Issues are for `ripota.org` site suggestions and corrections. It should direct official POTA matters, including rules, accounts, spots, logs, awards, and current reference status, back to official POTA resources.

## User Flow

1. A visitor notices a site issue, missing local note, broken link, or possible content correction.
2. They select `Suggest a site improvement` from the footer.
3. GitHub opens the `site-suggestion` issue form.
4. The visitor provides the page URL and relevant details.
5. Maintainers triage the issue as site feedback rather than official POTA support.

## Implementation Notes

- Use the repository issue form URL as the footer link target: `https://github.com/ripota/ripota.org/issues/new?template=site-suggestion.yml`.
- Keep footer copy concise so it fits alongside existing links.
- Do not add the feedback link to the primary header for the first iteration.
- Preserve existing styling patterns in the footer.

## Testing

- Run the existing project checks after implementation:
  - `mise run test`
  - `mise run check`
  - `mise run build`
- Confirm the rendered footer includes the new link.
- Confirm the issue form YAML is valid enough for GitHub issue forms and includes the page URL field.

## Open Decisions

No open decisions remain for this design. The label and destination are intentionally narrow: `Suggest a site improvement` routes visitors to a single site suggestion issue form.
