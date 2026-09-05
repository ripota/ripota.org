# Parks v3.1.1 geometry adoption

Issue [#33](https://github.com/ripota/ripota.org/issues/33) adopts the exact
[v3.1.1 release](https://github.com/ripota/parks/releases/tag/v3.1.1).
The release tarball SHA256 is
`574d4987d7f9ce76d062e243ce4a9607a7c3498b1f3f545c1af74e700a0db825`.
The release checksum and all 318 packaged artifact checksums were verified.
The signed release commit is
`a4a5b204ebca50d8311e87487f3dc8f9193a4a5d`; its
[main CI](https://github.com/ripota/parks/actions/runs/33967276635) and
[release verification](https://github.com/ripota/parks/actions/runs/33967334655)
both passed.

## Data paths

- Root `references` retains official metadata and the public event-data
  publishing contract. All 61 records match the preceding release.
- `/display` supplies marker points, bounds, review status, geometry kind,
  artifact paths, attribution, and the dataset disclaimer. Directory markers
  use display points; other reference-map variants use published bounds
  centers. The trail's reviewed Rhode Island point remains distinct from its
  official multi-state coordinate.
- Map rendering explicitly resolves package `boundaries-web/*.geojson`
  files at build time. Each initial map embeds only its web geometry. Event
  marker maps do not read or serialize geometry to place their markers.
- The canonical v2 catalog remains a build-time source for source provenance
  and existing same-source relationship calculations. Public readonly
  package types describe these inputs.
- Location mode requests canonical detailed files from the versioned
  `/data/parks/3.1.1/` static endpoints. Detail pages request their own and
  related references; the statewide directory requests `all.geojson`.
  `_headers` gives these immutable package assets a one-year browser cache.
- Canonical loading validates geometry and expected references before caching,
  rejects web responses, retries errors, and keeps location claims neutral
  until ready. Session/request generations discard late callbacks after a
  newer fix, stop, failure, or navigation. Real near-edge regression fixtures
  demonstrate why web geometry cannot replace canonical classification.

## Verification commands

The [Activate RI regression gate](activate-ri-2026/park-change-regression-gate.md)
remains required, including synthetic local D1/auth/email/Ops Room checks:

```sh
mise run check
mise run test-unit -- --run
mise run build
mise run e2e:activate-ri
mise run e2e:parks
node scripts/measure-parks-payload.mjs
```

The park browser suite covers the six requested directory/detail routes at
1440×1000 and 390×844, plus the US-2878/US-5483 overlap. It checks parcels,
holes, fitting/reset, related toggles, location permission/load/retry/exit,
return state, attribution, browser errors, and the public event matrix.
Its live-phase check uses a running browser clock set to the event date and
synthetic intercepted POTA responses. Synthetic analytics interactions are
intercepted after checking their privacy contract; normal assets and canonical
geometry responses remain real. Settled screenshots require visible basemap
tiles so a clock or animation issue cannot pass as a rendered map.
Local browser builds always use the Turnstile test key, even when Mise loads
a production key for normal builds.

After the documented `mise run deploy`, run the same public browser checks
against the live origin:

```sh
RIPOTA_PARKS_BASE_URL=https://ripota.org mise run e2e:parks
```

The live mode performs public reads and browser-local synthetic scenarios.
Authenticated volunteer, email, account, admin, and Ops Room regression tests
use local fixtures as required by #16.

## Payload measurements

The measurement script reports UTF-8 HTML bytes and gzip bytes, then separately
serializes and compresses the array of initial GeoJSON FeatureCollections.
Geometry is a subset of HTML, not an additional download. Zero means no
initial geometry. Deferred canonical downloads are excluded from initial
payloads. Initial baseline checks ran on main
`32c216d3489906ed9d2d3db27eab04bf5fbfe841`. The comparison below uses fetched
main `228d0af9` after its concurrent event-phase/activity changes, isolating
this adoption from those changes. The park geometry baseline is identical.

Local verification after rebasing: `mise run check` reports no errors,
warnings, or hints; 580 tests across 93 unit files pass; all 20 Activate RI
browser tests pass; build and production deployment dry run pass. No D1
migrations are pending. The public park suite adds 30 desktop/mobile cases.
Deployment evidence and the final signed commits are recorded on #33.

Bytes are **raw / gzip**.

| Route | HTML before | HTML after | Geometry before | Geometry after |
| --- | ---: | ---: | ---: | ---: |
| `/` | 1,927,368 / 674,088 | 653,552 / 230,680 | 1,882,448 / 662,266 | 613,419 / 219,997 |
| `/parks/` | 1,967,319 / 676,451 | 693,558 / 233,176 | 1,882,448 / 662,266 | 613,419 / 219,997 |
| `/parks/us-2870/` | 544,440 / 176,121 | 37,483 / 13,813 | 530,034 / 170,099 | 23,254 / 8,814 |
| `/parks/us-6979/` | 116,153 / 45,032 | 76,282 / 30,099 | 101,212 / 39,006 | 62,031 / 24,412 |
| `/parks/us-6992/` | 25,091 / 9,003 | 19,022 / 6,539 | 10,728 / 4,157 | 4,829 / 2,006 |
| `/parks/us-0513/` | 30,422 / 10,766 | 20,106 / 6,811 | 15,643 / 5,808 | 5,590 / 2,249 |
| `/parks/us-4582/` | 51,475 / 19,478 | 51,180 / 19,454 | 35,879 / 13,735 | 36,062 / 13,851 |
| `/activate-ri-2026/` | 152,001 / 19,164 | 132,377 / 18,275 | 0 / 0 | 0 / 0 |
| `/activate-ri-2026/volunteer/` | 94,674 / 15,132 | 84,862 / 14,801 | 0 / 0 | 0 / 0 |

US-2870 initial geometry gzip falls **94.8%** (170,099 → 8,814 bytes),
exceeding the 30% requirement. Statewide embedded geometry gzip falls
**66.8%** (662,266 → 219,997 bytes). Event maps remain at zero geometry.
US-4582 is deliberately an identity simplification; its small byte increase
is additive web metadata, with the original 100-foot zone intact.

For comparison, the packaged aggregate files measure 4,858,867 / 728,316
bytes detailed and 1,479,220 / 239,496 bytes web (raw / gzip). The site
embeds minified per-reference collections, so its measurements differ from
the formatted package files.
