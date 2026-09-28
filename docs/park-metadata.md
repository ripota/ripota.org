# Park metadata

The `/parks/` directory and individual guides use the main `@ripota/parks` API:

```ts
import { parks, getPark } from "@ripota/parks";

const park = getPark("US-2878");
park?.type;
park?.amenities;
park?.access.parking;
park?.orange.season;
```

Each park includes its type, manager, official visitor website, documented
amenities, practical access notes, activation tips, and fluorescent-orange
guidance. These are best-effort planning notes. A missing amenity means it has
not been documented, rather than that it is unavailable.

The same records are available without JavaScript as the standalone
[`parks.json` release download](https://github.com/ripota/parks/releases/download/v4.1.0/parks.json).
It is a plain array, suitable for static-site builds or any JSON consumer.

The directory filters by name/manager, county, type, and a documented amenity.
Filters apply to the list and are preserved in its URL. The map continues to
show all references. Each guide presents the full notes in “Plan your visit.”

Each guide shows the official POTA GPS coordinates in its header and near the
top of “Plan your visit.” Google Maps and Apple Maps icons link directly to
those coordinates, with no platform detection or JavaScript required. These
coordinates come from the POTA identity record, not the local map's display
point or boundary center. Icon sources are recorded in
[`public/assets/icons/README.md`](../public/assets/icons/README.md).

Orange badges describe seasonal guidance, not whether orange is required at
this instant. The state rule covers the second Saturday in September through
February and the third Saturday in April through May, with a larger amount
during shotgun deer season. Park notes explain exceptions, recommendations,
and places where different parts of the park have different guidance.

Prominent orange reminders appear August 15 through May 31, giving visitors
time to prepare before fall hunting season. From June 1 through August 14,
the directory banner and orange badges are hidden; each park's full guidance
remains in a quiet, expandable section. Parks without a visitor orange
requirement always use that quieter presentation. The browser checks the
current Rhode Island date, including while a page remains open, so a static
build does not lock the site into the season when it was published. This is
a display window; it does not change the actual seasons in the park notes.

## Park photos

The v4.1.0 package includes optional `heroImageId` and `summary` fields. The
build-only adapter in `src/lib/parks/images.ts` resolves selections through
`@ripota/parks/images.json` and reads the checked-in image through its package
export. It verifies the master checksum and dimensions, then emits WebP
variants up to 480, 800, 1280, and 1920 pixels wide without enlargement.
The `/assets/parks/` static routes use hashes of the output bytes and immutable
caching; browsers load photos from this site, without contacting source hosts.
Generated renditions live in the build output, not in the repository.

`ParkHeroPhoto.astro` shows the photo, supplied title, credit, source, license,
and a disclosure of package and site transformations. The detail page uses
photo + map panels on desktop and stacks them on mobile. A park without a
selected photo renders only the map. There is no placeholder or inherited photo
from a related park.

Show my location moves the existing map into a full-viewport native dialog,
hiding the photo and credit until Exit location mode or Escape. Permission
errors stay in that view so the error and exit control remain available. Exit
stops location tracking, restores the original map layout and scroll position,
and returns keyboard focus to the location button. Exact boundary data remains
lazy-loaded for location checks; responsive photos do not change classification.

## Park share cards

Every park guide uses its own 1200 × 630 PNG for Open Graph and Twitter previews.
The card includes the reference, name, county, grid, map, and unofficial-site
label. Parks with a selected photo use a photo/map split; other parks use a
full-width map. Photo crops respect the selected focal point and include credit
and license text. Full source and license links remain on the park page.

`src/lib/parks/share-cards.ts` composes the cards with Sharp during the normal
Astro build, and `/assets/parks/share/[filename].png.ts` emits the static files.
No browser or runtime image endpoint is needed. Names hash the emitted PNG bytes,
and metadata includes the absolute image URL, dimensions, type, and alt text.

`share-map.ts` uses the same reviewed web geometry, display point, boundary colors,
and OpenStreetMap layer as the interactive map. It fits the complete bounds with
padding, preserves polygon holes, and includes visible map attribution. Tile
requests identify RI POTA and run sequentially with timeouts and bounded retries.
A missing tile fails generation instead of publishing a blank map.

Generated cards and tiles are cached under ignored `tmp/park-share-cards/`.
Cards are reused until their metadata, photo, geometry, renderer, or Sharp version
changes; ordinary repeat builds do not fetch tiles. Tile downloads are cached for
at least a week. Removing the `cards/` subdirectory forces card regeneration;
removing the full cache also refreshes the basemap. Generated images live in
`dist/`, not in the repository. Fresh build environments need network access to
the tile server; preserve the cache between builds when possible.

## Updating information

Edit `config/park-metadata.json` in [ripota/parks](https://github.com/ripota/parks).
Keep notes short and useful to someone planning an activation, and include the
park or land manager's source URL. Use reasonable judgment for classifications;
there is no field-by-field approval or expiry process. Follow that repository's
contribution guide to package, test, and release the changes.

Then update the immutable release tarball in this site's package manifest and
lockfile, as well as `rwjblue/rwjblue.com`. Run the existing park/event regression
gate. Reference identity and geometry have their own package artifacts; adding
visitor notes does not require a network boundary refresh.

The site keeps display labels in `src/lib/parks/metadata.ts` and renders visit
details in `ParkVisitInfo.astro`. Event data uses explicit identity projections
so park notes do not expand event payloads.
