# Activate RI Fully Live D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make event-dynamic public Activate RI 2026 schedule and coverage data come from live D1 only, with short browser/shared-cache headers and local Worker Cache API caching for the public stops endpoint.

**Architecture:** D1 remains the only source of truth for event-dynamic schedule state. Static JSON remains only for stable event and park/reference data; generated `schedule.json` and `coverage.json` are removed. The public D1 endpoint returns cacheable JSON and uses `caches.default` as a short-lived per-data-center cache when available.

**Tech Stack:** Astro, TypeScript, Cloudflare Workers, D1, Workers Cache API, Vitest, mise tasks.

---

## File Map

- Modify `src/worker/index.ts`: accept the Worker `ExecutionContext` and pass it into Activate RI API routing.
- Modify `src/worker/routes/activate-ri.ts`: add short-lived public API cache headers and Cache API wrapping for `GET /api/activate-ri-2026/public/stops`.
- Modify `src/worker/routes/activate-ri.test.ts`: test cache headers, cache miss behavior, cache hit behavior, and D1 fallback when Cache API is unavailable.
- Modify `src/components/activate-ri/ScheduleTable.astro`: remove static schedule import; render a live-loading shell; populate rows and filter options from the public D1 API.
- Modify `src/components/activate-ri/ParkCoverageTable.astro`: remove static schedule import; derive coverage and filter options from live public stops.
- Modify `src/components/activate-ri/CoverageSummary.astro`: remove static schedule import; fetch public stops and derive summary client-side.
- Modify `src/components/ReferenceMap.astro`: remove static schedule import; initialize event maps with no scheduled stops and rely on the existing live refresh.
- Modify `scripts/activate-ri-2026/publish-public-data.mjs`: stop writing event-dynamic `schedule.json` and `coverage.json`.
- Modify `src/lib/activate-ri/paths.ts`: remove `schedule` and `coverage` from generated public-data keys if no code still needs them.
- Modify `src/lib/activate-ri/event.test.ts`: update public-data path expectations.
- Delete `public/data/activate-ri-2026/schedule.json`.
- Delete `public/data/activate-ri-2026/coverage.json`.
- Modify `docs/activate-ri-2026/data-flow.md`: update the architecture description so it says event-dynamic public data is live D1, not static JSON fallback.

---

### Task 1: Add Worker Cache API Support For Public Stops

**Files:**
- Modify: `src/worker/index.ts`
- Modify: `src/worker/routes/activate-ri.ts`
- Test: `src/worker/routes/activate-ri.test.ts`

- [ ] **Step 1: Write failing tests for public stops cache behavior**

Add these tests near the existing `"returns public live stops without private plan fields"` test in `src/worker/routes/activate-ri.test.ts`:

```ts
it("stores public live stops in the Worker cache on a cache miss", async () => {
  const testEnv = env();
  testEnv.DB = adminDb();
  const put = vi.fn(async () => undefined);
  const match = vi.fn(async () => undefined);
  vi.stubGlobal("caches", {
    default: { match, put },
  });
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });

  const response = await handleActivateRiApi(
    adminRequest("/api/activate-ri-2026/public/stops"),
    testEnv,
    { waitUntil } as unknown as ExecutionContext,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
  );
  expect(match).toHaveBeenCalledOnce();
  expect(put).toHaveBeenCalledOnce();
  expect(waitUntil).toHaveBeenCalledOnce();
  expect(testEnv.DB.prepare).toHaveBeenCalledOnce();
});

it("returns cached public live stops without querying D1", async () => {
  const testEnv = env();
  const cachedBody = {
    ok: true,
    generatedAt: "2026-06-17T12:00:00.000Z",
    stops: [],
  };
  const cachedResponse = new Response(JSON.stringify(cachedBody), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    },
  });
  const put = vi.fn(async () => undefined);
  const match = vi.fn(async () => cachedResponse);
  vi.stubGlobal("caches", {
    default: { match, put },
  });

  const response = await handleActivateRiApi(
    adminRequest("/api/activate-ri-2026/public/stops"),
    testEnv,
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(cachedBody);
  expect(match).toHaveBeenCalledOnce();
  expect(put).not.toHaveBeenCalled();
  expect(testEnv.DB.prepare).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify the cache tests fail**

Run:

```bash
rtk npm test -- src/worker/routes/activate-ri.test.ts
```

Expected: the new tests fail because `handleActivateRiApi` does not accept `ExecutionContext`, does not call `caches.default`, and still uses the older cache header.

- [ ] **Step 3: Pass `ExecutionContext` from the Worker entrypoint**

Change the default export in `src/worker/index.ts` from:

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
```

to:

```ts
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
```

Then change the Activate RI API routing branch from:

```ts
return handleActivateRiApi(request, env);
```

to:

```ts
return handleActivateRiApi(request, env, ctx);
```

- [ ] **Step 4: Implement public stops Cache API wrapping**

In `src/worker/routes/activate-ri.ts`, change the handler signature to:

```ts
export async function handleActivateRiApi(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
```

Replace the current public JSON cache header constant with:

```ts
const publicJsonCacheHeaders = {
  "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
};
```

Change the public stops branch to:

```ts
  if (
    request.method === "GET" &&
    url.pathname === "/api/activate-ri-2026/public/stops"
  ) {
    return cachedPublicJson(request, ctx, async () =>
      json({
        ok: true,
        stops: planRowsToPublicStops(await listPublicStopRows(env)),
        generatedAt: new Date().toISOString(),
      }, { headers: publicJsonCacheHeaders }),
    );
  }
```

Add this helper near the bottom of the file, before small validation helpers:

```ts
async function cachedPublicJson(
  request: Request,
  ctx: ExecutionContext | undefined,
  load: () => Promise<Response>,
): Promise<Response> {
  if (typeof caches === "undefined") {
    return load();
  }

  const url = new URL(request.url);
  url.search = "";
  const cacheKey = new Request(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await load();
  if (response.ok) {
    const put = cache.put(cacheKey, response.clone());
    if (ctx) {
      ctx.waitUntil(put);
    } else {
      await put;
    }
  }

  return response;
}
```

- [ ] **Step 5: Verify Worker cache tests pass**

Run:

```bash
rtk npm test -- src/worker/routes/activate-ri.test.ts
```

Expected: all route tests pass.

- [ ] **Step 6: Commit Worker cache changes**

Commit only the Worker and route test files:

```bash
git add src/worker/index.ts src/worker/routes/activate-ri.ts src/worker/routes/activate-ri.test.ts
git commit -m "Cache Activate RI public stops API"
```

---

### Task 2: Make The Public Schedule Table Fully Live

**Files:**
- Modify: `src/components/activate-ri/ScheduleTable.astro`

- [ ] **Step 1: Remove static schedule dependency**

In `src/components/activate-ri/ScheduleTable.astro`, remove:

```ts
import schedule from "../../../public/data/activate-ri-2026/schedule.json";
```

Remove the `visibleSchedule`, `modeOptions`, and `bandOptions` constants that depend on `schedule`.

- [ ] **Step 2: Render only a live shell and stable county options**

In the filter markup, replace the mode and band options with only the default option:

```astro
<option value="all">Any mode</option>
```

and:

```astro
<option value="all">Any band</option>
```

Replace the `<tbody>` static schedule rendering with:

```astro
<tbody>
  <tr data-live-loading>
    <td colspan="7" data-label="Schedule">Loading approved activation windows...</td>
  </tr>
  <tr data-filter-empty hidden>
    <td colspan="7" data-label="Schedule">No scheduled activation windows match these filters.</td>
  </tr>
</tbody>
```

- [ ] **Step 3: Add dynamic filter option population**

Inside the `<script>`, add:

```ts
function updateSelectOptions(
  filters: HTMLFormElement,
  filterName: "mode" | "band",
  values: string[],
): void {
  const control = filters.querySelector<HTMLSelectElement>(
    `[data-filter="${filterName}"]`,
  );
  if (!control) {
    return;
  }

  const current = control.value;
  control.replaceChildren(new Option(filterName === "mode" ? "Any mode" : "Any band", "all"));
  for (const value of values) {
    control.appendChild(new Option(value, value));
  }
  control.value = values.includes(current) ? current : "all";
}

function uniqueSortedValues(values: string[][]): string[] {
  return [...new Set(values.flat().filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}
```

- [ ] **Step 4: Update live schedule rendering to refresh filters and show failures**

In `setupLiveSchedule`, after `visibleStops` is computed and before `setupEventFilters(...)`, add:

```ts
const filters = document.querySelector("[data-event-filters]") as HTMLFormElement | null;
if (filters) {
  updateSelectOptions(filters, "mode", uniqueSortedValues(visibleStops.map((stop) => stop.modes)));
  updateSelectOptions(filters, "band", uniqueSortedValues(visibleStops.map((stop) => stop.bands)));
}
```

Change the `catch` block from:

```ts
} catch {
  return;
}
```

to:

```ts
} catch {
  renderScheduleUnavailable(body);
  return;
}
```

Add this helper:

```ts
function renderScheduleUnavailable(body: HTMLTableSectionElement): void {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 7;
  cell.textContent = "Live schedule is unavailable. Try refreshing this page.";
  row.appendChild(cell);
  body.replaceChildren(row);
}
```

- [ ] **Step 5: Verify schedule page type-checks**

Run:

```bash
rtk npm run check
```

Expected: Astro check reports `0 errors`.

- [ ] **Step 6: Commit schedule table changes**

```bash
git add src/components/activate-ri/ScheduleTable.astro
git commit -m "Load Activate RI schedule from live D1 data"
```

---

### Task 3: Make Park Coverage Fully Live

**Files:**
- Modify: `src/components/activate-ri/ParkCoverageTable.astro`

- [ ] **Step 1: Remove static schedule dependency**

In `src/components/activate-ri/ParkCoverageTable.astro`, remove:

```ts
import schedule from "../../../public/data/activate-ri-2026/schedule.json";
```

Remove `visibleSchedule`, `visibleCoverage`, `modeOptions`, and `bandOptions` constants that depend on static schedule data.

- [ ] **Step 2: Render coverage rows initially as uncovered**

Add this server-side constant:

```ts
const visibleCoverage = deriveParkCoverage(publicParks, []);
```

Keep county options derived from `publicParks`.

In filter markup, keep only:

```astro
<option value="all">Any mode</option>
```

and:

```astro
<option value="all">Any band</option>
```

- [ ] **Step 3: Add dynamic mode/band filter options**

Add the same `updateSelectOptions` and `uniqueSortedValues` helpers from Task 2 inside this component script.

- [ ] **Step 4: Populate filters after live coverage fetch**

In `setupLiveCoverage`, after filtering out sample stops, use a named variable:

```ts
const visibleStops = data.stops.filter((stop) => !stop.id.startsWith("sample-"));
renderLiveCoverage(body, parks, visibleStops);
const filters = document.querySelector("[data-event-filters]") as HTMLFormElement | null;
if (filters) {
  updateSelectOptions(filters, "mode", uniqueSortedValues(visibleStops.map((stop) => stop.modes)));
  updateSelectOptions(filters, "band", uniqueSortedValues(visibleStops.map((stop) => stop.bands)));
  setupParkFilters(filters);
}
```

Replace the old call:

```ts
renderLiveCoverage(body, parks, data.stops.filter((stop) => !stop.id.startsWith("sample-")));
setupParkFilters(document.querySelector("[data-event-filters]") as Element);
```

- [ ] **Step 5: Show explicit live coverage failure**

Change the `catch` block to:

```ts
} catch {
  renderCoverageUnavailable(body, parks);
  return;
}
```

Add:

```ts
function renderCoverageUnavailable(
  body: HTMLTableSectionElement,
  parks: PublicPark[],
): void {
  body.replaceChildren(
    ...deriveCoverage(parks, []).map(createCoverageRow),
    createCoverageEmptyRow(),
  );
}
```

This keeps the parks visible as uncovered when live D1 data cannot be loaded.

- [ ] **Step 6: Verify coverage page type-checks**

Run:

```bash
rtk npm run check
```

Expected: Astro check reports `0 errors`.

- [ ] **Step 7: Commit park coverage changes**

```bash
git add src/components/activate-ri/ParkCoverageTable.astro
git commit -m "Load Activate RI coverage from live D1 data"
```

---

### Task 4: Make Homepage Coverage Summary Fully Live

**Files:**
- Modify: `src/components/activate-ri/CoverageSummary.astro`

- [ ] **Step 1: Remove static schedule dependency**

In `src/components/activate-ri/CoverageSummary.astro`, remove:

```ts
import schedule from "../../../public/data/activate-ri-2026/schedule.json";
```

Remove `visibleSchedule`, `visibleCoverage`, `scheduled`, and `gaps`.

Keep:

```ts
import parks from "../../../public/data/activate-ri-2026/parks.json";
import { deriveParkCoverage } from "../../lib/activate-ri/coverage";
import type { PublicActivationStop, PublicParkSummary } from "../../lib/activate-ri/types";

const publicParks = parks as PublicParkSummary[];
```

- [ ] **Step 2: Render a live summary shell**

Replace the `<dl>` body with:

```astro
<dl
  class="coverage-summary"
  aria-label="Activate All RI coverage summary"
  data-live-coverage-summary
  data-parks={JSON.stringify(publicParks)}
>
  <div>
    <dt>Parks scheduled</dt>
    <dd data-summary-scheduled>Loading...</dd>
  </div>
  <div>
    <dt>Coverage gaps</dt>
    <dd data-summary-gaps>Loading...</dd>
  </div>
</dl>
```

- [ ] **Step 3: Add client-side live summary script**

Add this script below the `<dl>`:

```astro
<script>
  import { deriveParkCoverage } from "../../lib/activate-ri/coverage";
  import type { PublicActivationStop, PublicParkSummary } from "../../lib/activate-ri/types";

  document
    .querySelectorAll<HTMLElement>("[data-live-coverage-summary]")
    .forEach(setupLiveCoverageSummary);

  async function setupLiveCoverageSummary(root: HTMLElement): Promise<void> {
    const scheduled = root.querySelector<HTMLElement>("[data-summary-scheduled]");
    const gaps = root.querySelector<HTMLElement>("[data-summary-gaps]");
    if (!scheduled || !gaps) {
      return;
    }

    let parks: PublicParkSummary[] = [];
    try {
      parks = JSON.parse(root.dataset.parks ?? "[]") as PublicParkSummary[];
    } catch {
      parks = [];
    }

    try {
      const response = await fetch("/api/activate-ri-2026/public/stops", {
        headers: { accept: "application/json" },
      });
      const data = (await response.json()) as {
        ok?: boolean;
        stops?: PublicActivationStop[];
      };
      if (!response.ok || !data.ok || !Array.isArray(data.stops)) {
        throw new Error("Live coverage summary failed.");
      }

      const visibleStops = data.stops.filter((stop) => !stop.id.startsWith("sample-"));
      const coverage = deriveParkCoverage(parks, visibleStops);
      const scheduledCount = coverage.filter((park) =>
        ["scheduled", "multiple-scheduled", "completed"].includes(park.status),
      ).length;
      const gapCount = coverage.filter((park) =>
        ["uncovered", "cancelled-needs-replacement"].includes(park.status),
      ).length;

      scheduled.textContent = `${scheduledCount} / ${coverage.length}`;
      gaps.textContent = String(gapCount);
    } catch {
      scheduled.textContent = "Unavailable";
      gaps.textContent = "Unavailable";
    }
  }
</script>
```

- [ ] **Step 4: Verify homepage type-checks**

Run:

```bash
rtk npm run check
```

Expected: Astro check reports `0 errors`.

- [ ] **Step 5: Commit coverage summary changes**

```bash
git add src/components/activate-ri/CoverageSummary.astro
git commit -m "Load coverage summary from live D1 data"
```

---

### Task 5: Stop The Reference Map From Using Static Schedule Data

**Files:**
- Modify: `src/components/ReferenceMap.astro`

- [ ] **Step 1: Remove static schedule import and type**

In `src/components/ReferenceMap.astro`, remove:

```ts
import schedule from "../../public/data/activate-ri-2026/schedule.json";
```

Change:

```ts
import type { PublicActivationStop, PublicParkSummary } from "../lib/activate-ri/types";
```

to:

```ts
import type { PublicParkSummary } from "../lib/activate-ri/types";
```

- [ ] **Step 2: Initialize event maps without scheduled stops**

Remove:

```ts
const visibleSchedule = (schedule as PublicActivationStop[]).filter(
  (stop) => !stop.id.startsWith("sample-"),
);
```

Change the `buildReferenceMapItems` call from:

```ts
stops: isEventMap ? visibleSchedule : undefined,
```

to:

```ts
stops: isEventMap ? [] : undefined,
```

The existing `refreshLiveCoverage(...)` function will populate map coverage from D1 after page load.

- [ ] **Step 3: Verify map type-checks**

Run:

```bash
rtk npm run check
```

Expected: Astro check reports `0 errors`.

- [ ] **Step 4: Commit map changes**

```bash
git add src/components/ReferenceMap.astro
git commit -m "Initialize Activate RI map from live schedule data"
```

---

### Task 6: Remove Generated Schedule And Coverage JSON Artifacts

**Files:**
- Modify: `scripts/activate-ri-2026/publish-public-data.mjs`
- Modify: `src/lib/activate-ri/paths.ts`
- Modify: `src/lib/activate-ri/event.test.ts`
- Delete: `public/data/activate-ri-2026/schedule.json`
- Delete: `public/data/activate-ri-2026/coverage.json`

- [ ] **Step 1: Update the public-data path test for remaining generated keys**

In `src/lib/activate-ri/event.test.ts`, change the public-data path assertion from:

```ts
expect(publicDataPath("coverage")).toBe("/data/activate-ri-2026/coverage.json");
```

to:

```ts
expect(publicDataPath("parks")).toBe("/data/activate-ri-2026/parks.json");
```

Remove any test expectation that calls `publicDataPath("schedule")` or `publicDataPath("coverage")`.

- [ ] **Step 2: Verify the updated path test passes before cleanup**

Run:

```bash
rtk npm test -- src/lib/activate-ri/event.test.ts
```

Expected: the test passes. This confirms the public-data path test no longer asserts `schedule` or `coverage` generated file paths before the type is narrowed.

- [ ] **Step 3: Narrow generated public-data keys**

In `src/lib/activate-ri/paths.ts`, change:

```ts
export type PublicDataKey = "event" | "parks" | "schedule" | "coverage";
```

to:

```ts
export type PublicDataKey = "event" | "parks";
```

Keep `publicDataPath(...)` unchanged:

```ts
export function publicDataPath(key: PublicDataKey): string {
  return `/data/activate-ri-2026/${key}.json`;
}
```

- [ ] **Step 4: Stop publishing static schedule and coverage JSON**

In `scripts/activate-ri-2026/publish-public-data.mjs`, remove these imports:

```js
const { deriveParkCoverage } = await server.ssrLoadModule(
  "/src/lib/activate-ri/coverage.ts",
);
const { routeRowsToPublicStopsStrict } = await server.ssrLoadModule(
  "/src/lib/activate-ri/public-export.ts",
);
```

Remove these lines:

```js
const publicStopExport = await readPublicStopRows(publicStopRowsPath);
const publicActivationStops = routeRowsToPublicStopsStrict(publicStopExport.rows);
const coverage = deriveParkCoverage(parks, publicActivationStops);
```

Remove these writes:

```js
await writeJson("schedule.json", publicActivationStops);
await writeJson("coverage.json", coverage);
```

Remove the now-unused `readPublicStopRows`, `logPublicStopRowsSource`, `formatAge`, and `isRecord` helper functions.

After the cleanup, the script should still write:

```js
await writeJson("event.json", activateRi2026Event);
await writeJson("parks.json", parks);
```

- [ ] **Step 5: Delete the generated schedule and coverage files**

Run:

```bash
rm public/data/activate-ri-2026/schedule.json public/data/activate-ri-2026/coverage.json
```

- [ ] **Step 6: Verify no source imports removed files**

Run:

```bash
rtk rg -n 'public/data/activate-ri-2026/(schedule|coverage)\\.json|schedule\\.json|coverage\\.json' src public scripts docs/activate-ri-2026 README.md
```

Expected: no source code imports the deleted files. Documentation may mention that these files were removed only in the data-flow document update performed in Task 7.

- [ ] **Step 7: Verify cleanup tests pass**

Run:

```bash
rtk npm test -- src/lib/activate-ri/event.test.ts
rtk npm run check
```

Expected: the event path test passes and Astro check reports `0 errors`.

- [ ] **Step 8: Commit static artifact cleanup**

```bash
git add scripts/activate-ri-2026/publish-public-data.mjs src/lib/activate-ri/paths.ts src/lib/activate-ri/event.test.ts public/data/activate-ri-2026/schedule.json public/data/activate-ri-2026/coverage.json
git commit -m "Remove generated static schedule artifacts"
```

---

### Task 7: Update Data Flow Documentation

**Files:**
- Modify: `docs/activate-ri-2026/data-flow.md`
- Modify: `README.md` if the data-flow link is not already present

- [ ] **Step 1: Update static/live architecture language**

In `docs/activate-ri-2026/data-flow.md`, change the `Static Versus Live Data` table row for static JSON so it says:

```md
| Static JSON under `/data/activate-ri-2026/event.json` and `/data/activate-ri-2026/parks.json` | Files generated into `public/data/activate-ri-2026/` before deploy | Event and park/reference data changes only when regenerated and deployed. | Stable public event metadata and park/reference details. |
```

Change the live row to:

```md
| `GET /api/activate-ri-2026/public/stops` | Short-cached live D1 query over approved plans and public stop statuses | Yes. It reflects D1 after approval or approved activator edits, subject to the public cache TTL. | Public schedule, park coverage, coverage summary, and map coverage. |
```

- [ ] **Step 2: Document removed schedule artifacts**

In the `Static Public Data` section, make the generated file list contain only:

```md
- `public/data/activate-ri-2026/event.json`
- `public/data/activate-ri-2026/parks.json`
```

Then add:

```md
This project no longer generates static `schedule.json` or `coverage.json`
files. Public schedule and coverage state comes from
`GET /api/activate-ri-2026/public/stops`.
```

- [ ] **Step 3: Update freshness boundaries**

Replace the current behavior bullets with:

```md
- Admin queue: live D1.
- Activator edit pages: live D1.
- Public schedule table with JavaScript: live D1 through the public stops API.
- Public park coverage table with JavaScript: live D1 through the public stops API.
- Public reference map with JavaScript: stable park/reference data first, then live D1 coverage through the public stops API.
- Homepage coverage summary with JavaScript: live D1 through the public stops API.
- No-JavaScript public schedule and coverage: no dynamic schedule data; visitors need JavaScript for live event schedule state.
```

- [ ] **Step 4: Verify docs diff**

Run:

```bash
rtk git diff -- docs/activate-ri-2026/data-flow.md README.md
```

Expected: the doc clearly states that dynamic public schedule state is live D1 and static schedule JSON is not authoritative.

- [ ] **Step 5: Commit docs**

```bash
git add docs/activate-ri-2026/data-flow.md README.md
git commit -m "Document fully live Activate RI data flow"
```

---

### Task 8: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run full unit tests**

```bash
rtk npm test -- --run
```

Expected: all Vitest test files pass.

- [ ] **Step 2: Run Astro check**

```bash
rtk npm run check
```

Expected: `0 errors`, `0 warnings`, `0 hints`.

- [ ] **Step 3: Run local production-style build**

```bash
rtk npm run build:local
```

Expected: Astro builds all pages successfully.

- [ ] **Step 4: Manually inspect generated pages in local dev or preview**

Run:

```bash
rtk mise run dev
```

Open:

```text
http://127.0.0.1:4321/activate-ri-2026/
http://127.0.0.1:4321/activate-ri-2026/schedule/
http://127.0.0.1:4321/activate-ri-2026/parks/
```

Expected:

- The schedule page no longer shows stale static rows before live data loads.
- The parks page initially shows stable park/reference rows and updates coverage from live data.
- The homepage coverage summary changes from `Loading...` to live counts or `Unavailable`.
- Browser devtools show `GET /api/activate-ri-2026/public/stops` returning `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300`.

- [ ] **Step 5: Final status check**

```bash
rtk git status --short
```

Expected: only intentional changes are present.

---

## Self-Review

- Spec coverage: The plan makes public schedule, park coverage, coverage summary, and map coverage fully live from D1; keeps stable parks/event data static; adds browser/shared cache headers; adds local Worker Cache API caching; and updates docs.
- Placeholder scan: No `TBD`, `TODO`, or undefined implementation placeholders remain.
- Type consistency: Public stop field names match `PublicActivationStop`; Worker cache code uses `ExecutionContext`, `Response`, `Request`, and `caches.default` as available in Workers types.
