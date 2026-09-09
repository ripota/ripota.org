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
[`parks.json` release download](https://github.com/ripota/parks/releases/download/v4.0.0/parks.json).
It is a plain array, suitable for static-site builds or any JSON consumer.

The directory filters by name/manager, county, type, and a documented amenity.
Filters apply to the list and are preserved in its URL. The map continues to
show all references. Each guide presents the full notes in “Plan your visit.”

Orange badges describe seasonal guidance, not whether orange is required at
this instant. The state rule covers the second Saturday in September through
February and the third Saturday in April through May, with a larger amount
during shotgun deer season. Park notes explain exceptions, recommendations,
and places where different parts of the park have different guidance.

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
